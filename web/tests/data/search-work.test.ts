import { describe, expect, it } from "vitest";
import { SearchWork, type WorkEvent } from "../../src/search/work";

describe("resumable search work accounting", () => {
  it("reserves before running, refunds unused cost and resumes the exact iterator", async () => {
    const executed: number[] = [];
    function* source(): Generator<WorkEvent, number, void> {
      for (let i = 0; i < 3; i++) {
        yield { type: "reserve", bytes: 8, visits: 1, scalars: 2 };
        executed.push(i);
        yield { type: "settle", bytes: 4, visits: 1, scalars: 2 };
      }
      return 42;
    }
    const work = new SearchWork(source(), { bytes: 12, visits: 5 });
    expect(await work.round()).toMatchObject({ status: "paused", used: { bytes: 8, visits: 2 } });
    expect(executed).toEqual([0, 1]);
    expect(await work.round()).toMatchObject({ status: "done", value: 42, used: { bytes: 4, visits: 1 } });
    expect(executed).toEqual([0, 1, 2]);
    expect(await work.round()).toMatchObject({ status: "done", value: 42 });
  });
  it("yields at the scalar bound, rejects overlapping Continue, and fences abort after await", async () => {
    let release!: () => void;
    const controller = new AbortController();
    let afterYield = false;
    function* source(): Generator<WorkEvent, void, void> {
      yield { type: "reserve", bytes: 4096, visits: 1, scalars: 4096 };
      yield { type: "settle", bytes: 4096, visits: 1, scalars: 4096 };
      afterYield = true;
    }
    const work = new SearchWork(source(), undefined, () => new Promise(resolve => { release = resolve; }));
    const pending = work.round(controller.signal);
    await expect(work.round()).rejects.toThrow(/already running/i);
    controller.abort(); release();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(afterYield).toBe(false);
  });
  it("treats scalars separately from the structural budget and closes released iterators", async () => {
    let released = false;
    function* source(): Generator<WorkEvent, string, void> {
      try {
        for (let i = 0; i < 4; i++) {
          yield { type: "reserve", bytes: 4096, visits: 1, scalars: 4096 };
          yield { type: "settle", bytes: 4096, visits: 1, scalars: 4096 };
        }
        return "done";
      } finally { released = true; }
    }
    const work = new SearchWork(source(), { bytes: 16384, visits: 4 }, async () => {});
    expect(await work.round()).toMatchObject({ status: "done", value: "done" });
    expect(released).toBe(true);
  });
  it("rejects under-accounting and an impossible indivisible reservation", async () => {
    function* bad(): Generator<WorkEvent, void, void> {
      yield { type: "reserve", bytes: 1, visits: 1, scalars: 1 };
      yield { type: "settle", bytes: 2, visits: 1, scalars: 1 };
    }
    await expect(new SearchWork(bad()).round()).rejects.toThrow(/reservation/i);
    function* oversized(): Generator<WorkEvent, void, void> {
      yield { type: "reserve", bytes: 3, visits: 0, scalars: 1 };
    }
    await expect(new SearchWork(oversized(), { bytes: 2, visits: 1 }).round()).rejects.toThrow(/indivisible/i);
  });
});
