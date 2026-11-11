// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Habit, JournalData } from "../../src/collections/journal";
import { journalHabitDetails } from "../../src/ui/journalHabitDetails";

const at = "2026-01-01T00:00:00.000Z";
function habit(
  id = "habit",
  createdOn = "2026-01-01",
  archivedOn: string | null = null,
): Habit {
  return {
    id,
    name: "Private habit",
    order: 0,
    createdAt: at,
    createdOn,
    archivedAt: archivedOn ? at : null,
    archivedOn,
    revision: 1,
  };
}
function completion(date: string, done = true, habitId = "habit") {
  return { date, done, habitId, updatedAt: at };
}
type Source = Pick<JournalData, "habits" | "completions">;
function source(dates: string[], selectedHabit = habit()): Source {
  return {
    habits: [selectedHabit],
    completions: dates.map((day) => completion(day, true, selectedHabit.id)),
  };
}

describe("Journal habit details", () => {
  it("counts a consecutive run ending on the selected completed date", () => {
    const data = source(["2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(journalHabitDetails(data, "2026-01-03").get("habit")).toEqual({
      days: 3,
      through: "2026-01-03",
      completed: true,
    });
  });
  it("reproduces checked then unchecked streak carry without counting an undone day", () => {
    const data = source([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
      "2026-01-05",
    ]);
    data.completions.push(completion("2026-01-06", true));
    expect(journalHabitDetails(data, "2026-01-06").get("habit")?.days).toBe(6);
    data.completions[5]!.done = false;
    expect(journalHabitDetails(data, "2026-01-06").get("habit")).toEqual({
      days: 5,
      through: "2026-01-05",
      completed: false,
    });
  });
  it("starts the first eligible completion at one and an empty run at zero", () => {
    expect(journalHabitDetails(source([]), "2026-01-01").get("habit")).toEqual({
      days: 0,
      through: null,
      completed: false,
    });
    expect(
      journalHabitDetails(source(["2026-01-01"]), "2026-01-01").get("habit"),
    ).toEqual({ days: 1, through: "2026-01-01", completed: true });
  });
  it("does not search past a missing or explicitly undone day for an older run", () => {
    const data = source(["2026-01-01", "2026-01-02", "2026-01-04"]);
    expect(journalHabitDetails(data, "2026-01-05").get("habit")?.days).toBe(1);
    expect(journalHabitDetails(data, "2026-01-06").get("habit")).toEqual({
      days: 0,
      through: null,
      completed: false,
    });
    data.completions.push(completion("2026-01-03", false));
    expect(journalHabitDetails(data, "2026-01-04").get("habit")?.days).toBe(1);
  });
  it("uses selected history rather than future completions or the machine date", () => {
    const data = source([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
    expect(journalHabitDetails(data, "2026-01-02").get("habit")).toEqual({
      days: 2,
      through: "2026-01-02",
      completed: true,
    });
  });
  it("respects creation/archive inclusively and does not count out-of-interval records", () => {
    const data = source(
      ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"],
      habit("habit", "2026-01-02", "2026-01-03"),
    );
    expect(journalHabitDetails(data, "2026-01-01").size).toBe(0);
    expect(journalHabitDetails(data, "2026-01-02").get("habit")?.days).toBe(1);
    expect(journalHabitDetails(data, "2026-01-03").get("habit")?.days).toBe(2);
    expect(journalHabitDetails(data, "2026-01-04").size).toBe(0);
  });
  it("keeps histories by identity across renames, and never crosses habits", () => {
    const data = source(["2026-01-01", "2026-01-02"]);
    data.habits.push(habit("other"));
    data.completions.push(completion("2026-01-03", true, "other"));
    data.habits[0]!.name = "Renamed private habit";
    const details = journalHabitDetails(data, "2026-01-03");
    expect(details.get("habit")).toEqual({
      days: 2,
      through: "2026-01-02",
      completed: false,
    });
    expect(details.get("other")).toEqual({
      days: 1,
      through: "2026-01-03",
      completed: true,
    });
  });
  it.each([
    ["2024-02-28", "2024-02-29", "2024-03-01"],
    ["2025-12-30", "2025-12-31", "2026-01-01"],
    ["2026-03-07", "2026-03-08", "2026-03-09"],
    ["2026-10-03", "2026-10-04", "2026-10-05"],
  ])(
    "uses civil UTC components across leap/year/DST boundaries: %s",
    (a, b, c) => {
      expect(
        journalHabitDetails(source([a, b, c], habit("habit", a)), c).get(
          "habit",
        )?.days,
      ).toBe(3);
    },
  );
  it("handles the supported year boundaries without wrapping", () => {
    expect(
      journalHabitDetails(
        source([], habit("habit", "1000-01-01")),
        "1000-01-01",
      ).get("habit"),
    ).toEqual({ days: 0, through: null, completed: false });
    expect(
      journalHabitDetails(
        source(["9999-12-30", "9999-12-31"], habit("habit", "9999-12-30")),
        "9999-12-31",
      ).get("habit")?.days,
    ).toBe(2);
  });
  it.each([
    "2026-02-29",
    "2026-04-31",
    "0999-12-31",
    "10000-01-01",
    "2026-1-01",
    "not-a-date",
  ])("rejects an invalid selected civil date: %s", (day) => {
    expect(() => journalHabitDetails(source([]), day)).toThrow(RangeError);
  });
  it("returns only fresh scalar projections without mutating the protected input", () => {
    const data = source(["2026-01-01"]);
    Object.freeze(data.habits[0]);
    Object.freeze(data.completions[0]);
    Object.freeze(data.habits);
    Object.freeze(data.completions);
    Object.freeze(data);
    const first = journalHabitDetails(data, "2026-01-01"),
      detail = first.get("habit")!;
    expect(Object.keys(detail).sort()).toEqual([
      "completed",
      "days",
      "through",
    ]);
    expect(Object.isFrozen(detail)).toBe(true);
    expect(journalHabitDetails(data, "2026-01-01")).not.toBe(first);
  });
  it("derives all hundred habits from the maximum legal completion count", () => {
    const start = Date.UTC(2020, 0, 1);
    const day = (i: number) =>
      new Date(start + i * 86400000).toISOString().slice(0, 10);
    const data: Source = {
      habits: Array.from({ length: 100 }, (_, i) => habit(String(i), day(0))),
      completions: Array.from({ length: 100000 }, (_, i) =>
        completion(day(Math.floor(i / 100)), true, String(i % 100)),
      ),
    };
    const details = journalHabitDetails(data, day(999));
    expect(details.size).toBe(100);
    for (const detail of details.values())
      expect(detail).toEqual({
        days: 1000,
        through: day(999),
        completed: true,
      });
  });
});
