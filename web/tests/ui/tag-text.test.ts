import { expect, it } from "vitest";
import { formatTagText, parseTagText } from "../../src/ui/tagText";
it("splits commas, strips optional hash and removes exact duplicates", () =>
  expect(parseTagText("trip, #planning, trip, , ideas")).toEqual([
    "trip",
    "planning",
    "ideas",
  ]));
it("preserves comma names, quotes, case and Unicode", () => {
  const tags = [
    "Trip",
    "trip",
    "café",
    "cafe\u0301",
    "work, play",
    'a"b',
    "#literal",
  ];
  expect(parseTagText(formatTagText(tags))).toEqual(tags);
});
it("admits removing all tags", () => expect(parseTagText(" , , ")).toEqual([]));
it("rejects malformed quotes and limits", () => {
  expect(() => parseTagText('"open')).toThrow();
  expect(() => parseTagText("x".repeat(101))).toThrow();
  expect(() =>
    parseTagText(Array.from({ length: 101 }, (_, i) => String(i)).join(",")),
  ).toThrow();
});
