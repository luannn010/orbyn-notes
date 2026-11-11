import type { JournalData } from "../collections/journal";

export type JournalHabitDetail = Readonly<{
  days: number;
  through: string | null;
  completed: boolean;
}>;
const DAY_MS = 86400000;

function civilDay(value: string): number {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value))
    throw new RangeError("Choose a valid Journal calendar date.");
  const time = Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(5, 7)) - 1,
    Number(value.slice(8, 10)),
  );
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== value
  )
    throw new RangeError("Choose a valid Journal calendar date.");
  return time / DAY_MS;
}

/** Derive only view scalars from an already validated, unlocked Journal image.
 * No clock, persisted streak, retained source reference or cross-session cache. */
export function journalHabitDetails(
  data: Pick<JournalData, "habits" | "completions">,
  selectedDay: string,
): ReadonlyMap<string, JournalHabitDetail> {
  const selected = civilDay(selectedDay);
  const active = new Map<
    string,
    { created: number; completedDays: Set<number> }
  >();
  for (const habit of data.habits) {
    if (
      habit.createdOn > selectedDay ||
      (habit.archivedOn && habit.archivedOn < selectedDay)
    )
      continue;
    active.set(habit.id, {
      created: civilDay(habit.createdOn),
      completedDays: new Set(),
    });
  }
  // One pass over the protected history, rather than one whole-history filter
  // per habit. Future and out-of-interval completions cannot extend this run.
  for (const completion of data.completions) {
    if (!completion.done || completion.date > selectedDay) continue;
    const habit = active.get(completion.habitId);
    if (!habit) continue;
    const day = civilDay(completion.date);
    if (day >= habit.created) habit.completedDays.add(day);
  }
  const details = new Map<string, JournalHabitDetail>();
  for (const [id, habit] of active) {
    const completed = habit.completedDays.has(selected);
    const end = completed ? selected : selected - 1;
    let days = 0;
    // A missing or explicitly undone day ends the streak immediately. The
    // total walk is bounded by the indexed true completion records plus H.
    for (
      let cursor = end;
      cursor >= habit.created && habit.completedDays.has(cursor);
      cursor--
    )
      days++;
    details.set(
      id,
      Object.freeze({
        days,
        through: days
          ? new Date(end * DAY_MS).toISOString().slice(0, 10)
          : null,
        completed,
      }),
    );
  }
  return details;
}
