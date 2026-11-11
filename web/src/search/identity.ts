import type { WorkEvent } from "./work";

/** Native Map string hashing/comparison can consume a legal opaque identity in
 * one uninterruptible operation. Hash it in admitted chunks instead, bucket by
 * a fixed-size integer, then verify every collision against exact UTF16 units.
 * FNV is only an index accelerator, never an identity or authorization proof. */
export class SearchIdentityMap<T> {
  private readonly buckets = new Map<number, { key: string; value: T }[]>();
  private generation = 0;

  clear(): void {
    this.generation++;
    this.buckets.clear();
  }

  private guard(generation: number): void {
    if (generation !== this.generation) throw new Error("Search identities were released.");
  }

  private *hash(key: string, generation: number): Generator<WorkEvent, number, void> {
    let hash = 0x811c9dc5;
    for (let from = 0; from < key.length; ) {
      const to = Math.min(key.length, from + 4096);
      const units = to - from;
      yield { type: "reserve", bytes: units * 3, visits: 1, scalars: units };
      this.guard(generation);
      for (let i = from; i < to; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193);
      from = to;
      yield { type: "settle", bytes: units * 3, visits: 1, scalars: units };
    }
    return hash >>> 0;
  }

  private *equal(a: string, b: string, generation: number): Generator<WorkEvent, boolean, void> {
    yield { type: "reserve", bytes: 8, visits: 1, scalars: 0 };
    this.guard(generation);
    const sameLength = a.length === b.length;
    yield { type: "settle", bytes: 8, visits: 1, scalars: 0 };
    if (!sameLength) return false;
    for (let from = 0; from < a.length; ) {
      const to = Math.min(a.length, from + 4096);
      const units = to - from;
      yield { type: "reserve", bytes: units * 6, visits: 1, scalars: units };
      this.guard(generation);
      let checked = 0, equal = true;
      for (let i = from; i < to; i++) {
        checked++;
        if (a.charCodeAt(i) !== b.charCodeAt(i)) { equal = false; break; }
      }
      yield { type: "settle", bytes: checked * 6, visits: 1, scalars: checked };
      if (!equal) return false;
      from = to;
    }
    return true;
  }

  *get(key: string): Generator<WorkEvent, T | undefined, void> {
    const generation = this.generation;
    const hash = yield* this.hash(key, generation);
    yield { type: "reserve", bytes: 32, visits: 1, scalars: 0 };
    this.guard(generation);
    const bucket = this.buckets.get(hash);
    yield { type: "settle", bytes: 32, visits: 1, scalars: 0 };
    if (!bucket) return undefined;
    for (const entry of bucket) {
      if (yield* this.equal(entry.key, key, generation)) {
        this.guard(generation);
        return entry.value;
      }
    }
    return undefined;
  }

  *set(key: string, value: T): Generator<WorkEvent, void, void> {
    const generation = this.generation;
    const hash = yield* this.hash(key, generation);
    yield { type: "reserve", bytes: 32, visits: 1, scalars: 0 };
    this.guard(generation);
    const existing = this.buckets.get(hash);
    yield { type: "settle", bytes: 32, visits: 1, scalars: 0 };
    if (existing) {
      for (const entry of existing) {
        if (yield* this.equal(entry.key, key, generation)) {
          this.guard(generation);
          entry.value = value;
          return;
        }
      }
    }
    yield { type: "reserve", bytes: 48, visits: 1, scalars: 0 };
    this.guard(generation);
    if (existing) existing.push({ key, value });
    else this.buckets.set(hash, [{ key, value }]);
    yield { type: "settle", bytes: 48, visits: 1, scalars: 0 };
  }
}
