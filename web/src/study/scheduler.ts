import type { Grade, Schedule } from "../collections/contracts";

const DAY = 86_400_000;
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
function instant(at: Date): number {
  const time = at.getTime();
  if (!Number.isFinite(time)) throw new Error("invalid_date: Choose a valid review time.");
  return time;
}

/** Local interval policy v1. Preview and commit must call this same function. */
export function initialSchedule(at: Date): Schedule {
  return { version: 1, state: "new", due: new Date(instant(at)).toISOString(), intervalDays: 0, ease: 2.5, repetitions: 0, lapses: 0, lastReviewedAt: null };
}

export function nextSchedule(previous: Schedule, grade: Grade, at: Date): Schedule {
  const time = instant(at);
  if (previous.version !== 1 || !["new", "learning", "review"].includes(previous.state) ||
    !Number.isFinite(previous.intervalDays) || previous.intervalDays < 0 || previous.intervalDays > 36500 ||
    !Number.isFinite(previous.ease) || previous.ease < 1.3 || previous.ease > 3 ||
    !Number.isSafeInteger(previous.repetitions) || previous.repetitions < 0 ||
    !Number.isSafeInteger(previous.lapses) || previous.lapses < 0)
    throw new Error("invalid_schedule: This card's review schedule could not be read.");
  const next = { ...previous, lastReviewedAt: at.toISOString() };
  let delay: number;
  switch (grade) {
    case "again":
      next.state = "learning";
      next.intervalDays = 0;
      next.repetitions = 0;
      next.lapses++;
      delay = 60_000;
      break;
    case "hard":
      next.ease = Math.max(1.3, next.ease - 0.15);
      if (previous.state === "review") {
        next.intervalDays = Math.min(36500, Math.max(1, Math.ceil(previous.intervalDays * 1.2)));
        delay = next.intervalDays * DAY;
      } else {
        next.state = "learning";
        next.intervalDays = 0;
        delay = 600_000;
      }
      break;
    case "good":
    case "easy":
      next.state = "review";
      next.repetitions++;
      next.intervalDays = Math.min(36500, previous.state === "review"
        ? Math.max(grade === "easy" ? 4 : 1, Math.ceil(previous.intervalDays * previous.ease * (grade === "easy" ? 1.3 : 1)))
        : grade === "easy" ? 4 : 1);
      if (grade === "easy") next.ease = Math.min(3, next.ease + 0.15);
      delay = next.intervalDays * DAY;
      break;
    default:
      throw new Error("invalid_grade: Choose Again, Hard, Good or Easy.");
  }
  next.due = new Date(time + delay).toISOString();
  return next;
}

/** Calendar grouping, distinct from elapsed schedule intervals. Handles DST. */
export function studyDay(at: Date, timeZone: string, dayStartHour: number): string {
  instant(at);
  if (!Number.isInteger(dayStartHour) || dayStartHour < 0 || dayStartHour > 23)
    throw new Error("invalid_day_start: Choose a whole hour from 0 to 23.");
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    if (dayFormatters.size >= 16) dayFormatters.delete(dayFormatters.keys().next().value!);
    dayFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  const calendar = new Date(Date.UTC(value("year"), value("month") - 1, value("day") - (value("hour") < dayStartHour ? 1 : 0)));
  return calendar.toISOString().slice(0, 10);
}
