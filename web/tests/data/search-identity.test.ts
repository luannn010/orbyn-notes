import { describe, expect, it } from "vitest";
import { SearchIdentityMap } from "../../src/search/identity";
import { SearchWork, type WorkEvent } from "../../src/search/work";

async function complete<T>(generator: Generator<WorkEvent, T, void>): Promise<T> {
  const work = new SearchWork(generator, undefined, async () => {});
  let result = await work.round();
  while (result.status === "paused") result = await work.round();
  return result.value;
}
describe("budgeted opaque search identities", () => {
  it("charges every collision candidate even when its length differs", async () => {
    const map = new SearchIdentityMap<number>();
    await complete(map.set("costarring", 1));
    await complete(map.set("liquid", 2));
    const work = new SearchWork(map.get("liquid"), { bytes: 100000, visits: 3 }, async () => {});
    expect(await work.round()).toMatchObject({ status: "paused", used: { visits: 3 } });
    expect(await work.round()).toMatchObject({ status: "done", value: 2 });
  });
  it("cannot return a retained value after release at the final comparison settlement", async () => {
    const map = new SearchIdentityMap<number>();
    await complete(map.set("foo", 42));
    const read = map.get("foo");
    let event = read.next();
    while (!event.done && !(event.value.type === "settle" && event.value.bytes === 18)) event = read.next();
    expect(event.done).toBe(false);
    map.clear();
    expect(() => read.next()).toThrow(/released/);
  });
  it("uses exact original identity after hash collision, including lone UTF16 and punctuation", async () => {
    const map = new SearchIdentityMap<number>();
    // These distinct UTF16 strings collide under FNV1a32. A hash is never an ID.
    await complete(map.set("costarring", 1));
    await complete(map.set("liquid", 2));
    await complete(map.set("\ud800/[x]", 3));
    expect(await complete(map.get("costarring"))).toBe(1);
    expect(await complete(map.get("liquid"))).toBe(2);
    expect(await complete(map.get("\ud800/[x]"))).toBe(3);
    expect(await complete(map.get("\ufffd/[x]"))).toBeUndefined();
  });
  it("pauses inside an enormous identity rather than hashing it before admission", async () => {
    const map = new SearchIdentityMap<number>();
    const key = "a".repeat(50000);
    const work = new SearchWork(map.set(key, 1), { bytes: 16000, visits: 10 }, async () => {});
    expect(await work.round()).toMatchObject({ status: "paused" });
    // No partially admitted value is visible after cancelling the unfinished set.
    work.close();
    expect(await complete(map.get(key))).toBeUndefined();
    await complete(map.set(key, 2));
    expect(await complete(map.get(key))).toBe(2);
    map.clear();
    expect(await complete(map.get(key))).toBeUndefined();
  });
});
