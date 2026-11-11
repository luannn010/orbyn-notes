/** A producer must reserve before touching a source chunk, then settle its
 * actual work before requesting another chunk. Limits apply to one deliberate
 * round; the iterator itself survives a pause. */
export type WorkCost = Readonly<{ bytes: number; visits: number; scalars: number }>;
export type WorkEvent = WorkCost & Readonly<{ type: "reserve" | "settle" }>;
export type WorkLimit = Readonly<{ bytes: number; visits: number }>;
export type WorkResult<T> =
  | Readonly<{ status: "paused"; used: WorkCost }>
  | Readonly<{ status: "done"; value: T; used: WorkCost }>;

const defaultLimit: WorkLimit = Object.freeze({ bytes: 64 * 1024 * 1024, visits: 250000 });
const zero = (): WorkCost => ({ bytes: 0, visits: 0, scalars: 0 });
const validCost = (cost: WorkCost): boolean =>
  [cost.bytes, cost.visits, cost.scalars].every(value => Number.isSafeInteger(value) && value >= 0);

/** A task boundary, rather than a resolved Promise/microtask: native input and
 * cancellation can run between chunks. Ports are closed after each yield. */
export function searchTaskBoundary(): Promise<void> {
  if (typeof MessageChannel === "undefined")
    return new Promise(resolve => setTimeout(resolve, 0));
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

export class SearchWork<T> {
  private iterator: Generator<WorkEvent, T, void> | null;
  private event: IteratorResult<WorkEvent, T> | null = null;
  private running = false;
  private closed = false;
  private result: { value: T } | null = null;

  constructor(
    iterator: Generator<WorkEvent, T, void>,
    private readonly limit: WorkLimit = defaultLimit,
    private readonly yieldTask: () => Promise<void> = searchTaskBoundary,
    private readonly assertCurrent: () => void = () => {},
  ) {
    if (!Number.isSafeInteger(limit.bytes) || limit.bytes <= 0 ||
        !Number.isSafeInteger(limit.visits) || limit.visits <= 0)
      throw new Error("Invalid search work limits.");
    this.iterator = iterator;
  }

  close(): void {
    this.closed = true;
    const iterator = this.iterator;
    this.iterator = null;
    this.event = null;
    this.result = null;
    iterator?.return(undefined as T);
  }

  async round(signal?: AbortSignal): Promise<WorkResult<T>> {
    if (this.running) throw new Error("Search work is already running.");
    const assert = () => {
      if (signal?.aborted || this.closed)
        throw new DOMException("Search stopped.", "AbortError");
      this.assertCurrent();
    };
    assert();
    if (this.result) return { status: "done", value: this.result.value, used: zero() };
    this.running = true;
    let bytes = 0, visits = 0, scalars = 0;
    let batchVisits = 0, batchScalars = 0, started = performance.now();
    const used = (): WorkCost => Object.freeze({ bytes, visits, scalars });
    try {
      this.event ??= this.iterator!.next();
      while (!this.event.done) {
        assert();
        const reserve = this.event.value;
        if (reserve.type !== "reserve" || !validCost(reserve))
          throw new Error("Search work requires a valid reservation.");
        if (reserve.bytes > this.limit.bytes || reserve.visits > this.limit.visits ||
            reserve.scalars > 4096 || reserve.visits > 2048)
          throw new Error("Search work has an oversized indivisible reservation.");
        if (reserve.bytes > this.limit.bytes - bytes || reserve.visits > this.limit.visits - visits)
          return { status: "paused", used: used() };

        // Grant only this reservation. next() runs one bounded synchronous
        // producer operation and must immediately report its actual cost.
        const settled = this.iterator!.next();
        if (settled.done || settled.value.type !== "settle" || !validCost(settled.value) ||
            settled.value.bytes > reserve.bytes || settled.value.visits > reserve.visits ||
            settled.value.scalars > reserve.scalars)
          throw new Error("Search work exceeded or omitted its reservation settlement.");
        bytes += settled.value.bytes;
        visits += settled.value.visits;
        scalars += settled.value.scalars;
        batchVisits += settled.value.visits;
        batchScalars += settled.value.scalars;
        if (batchScalars >= 4096 || batchVisits >= 2048 || performance.now() - started >= 8) {
          await this.yieldTask();
          assert();
          batchVisits = 0;
          batchScalars = 0;
          started = performance.now();
        }
        assert();
        this.event = this.iterator!.next();
      }
      assert();
      const value = this.event.value;
      this.result = { value };
      this.iterator = null;
      this.event = null;
      return { status: "done", value, used: used() };
    } catch (error) {
      this.close();
      throw error;
    } finally {
      this.running = false;
    }
  }
}
