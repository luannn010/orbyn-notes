import { describe, expect, it } from "vitest";
import { initialSchedule, nextSchedule, studyDay } from "../../src/study/scheduler";

const now = new Date("2026-11-11T12:00:00Z");
describe("versioned Study scheduling", () => {
  it("uses the same deterministic grade intervals for preview and commit", () => {
    const initial = initialSchedule(now);
    expect(initial.state).toBe("new");
    for (const [grade, minutes] of [["again", 1], ["hard", 10], ["good", 1440], ["easy", 5760]] as const) {
      const result = nextSchedule(initial, grade, now);
      expect(Date.parse(result.due) - +now).toBe(minutes * 60_000);
      expect(result).toEqual(nextSchedule(initial, grade, now));
      expect(initial).toEqual(initialSchedule(now));
    }
    expect(nextSchedule(initial, "hard", now).state).toBe("learning");
  });
  it("repeated lapses reset intervals and never create invalid ease or past due times", () => {
    let schedule = nextSchedule(initialSchedule(now), "easy", now);
    for (let i = 0; i < 30; i++) schedule = nextSchedule(schedule, "again", now);
    expect(schedule.lapses).toBe(30);
    expect(schedule.intervalDays).toBe(0);
    expect(schedule.state).toBe("learning");
    expect(schedule.ease).toBeGreaterThanOrEqual(1.3);
    expect(Date.parse(schedule.due)).toBeGreaterThan(+now);
  });
  it("groups by local four AM through midnight and daylight-saving transitions", () => {
    expect(studyDay(new Date("2026-10-03T16:30:00Z"), "Australia/Sydney", 4)).toBe("2026-10-03");
    expect(studyDay(new Date("2026-10-03T17:00:00Z"), "Australia/Sydney", 4)).toBe("2026-10-04");
    expect(studyDay(new Date("2026-11-11T02:59:00Z"), "UTC", 4)).toBe("2026-11-10");
    expect(studyDay(new Date("2026-11-11T04:00:00Z"), "UTC", 4)).toBe("2026-11-11");
  });
  it("rejects invalid inputs instead of storing NaN or unsupported schedules", () => {
    expect(() => nextSchedule(initialSchedule(now), "wrong" as never, now)).toThrow();
    expect(() => initialSchedule(new Date("invalid"))).toThrow();
    expect(() => studyDay(now, "UTC", 24)).toThrow();
  });
});
