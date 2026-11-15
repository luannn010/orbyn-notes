import { expect, it } from "vitest";
import {
  confirmedTagPrefix,
  formatTagText,
  parseTagText,
} from "../../src/ui/tagText";
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

it("confirms newly entered delimiters outside quoted fields and preserves old suffixes", () => {
  expect(confirmedTagPrefix("trip", "trip,")).toBeNull();
  expect(confirmedTagPrefix("trip,", "trip, ")).toEqual({
    text: "trip, ",
    rest: "",
  });
  expect(confirmedTagPrefix('"work,', '"work, ')).toBeNull();
  expect(confirmedTagPrefix('"work, play"', '"work, play", ')).toEqual({
    text: '"work, play", ',
    rest: "",
  });
  expect(confirmedTagPrefix("trip, planning", "trips, planning")).toBeNull();
  expect(
    confirmedTagPrefix("planning, ideas", "trip, planning, ideas"),
  ).toBeNull();
});
