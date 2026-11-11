// Genuine local Journal/WASM/IDB checks; disposable synthetic contexts only.
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
if (!process.argv.includes("--run"))
  throw new Error("Pass --run for disposable synthetic Journal profiles.");
const web = fileURLToPath(new URL("../../", import.meta.url));
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179";
const output =
  process.env.NOTES_UI_OUTPUT ??
  resolve(web, "test-results/journal-habits-browser");
const sources = [
  "src/ui/JournalView.tsx",
  "src/ui/JournalHabitFeedback.tsx",
  "src/ui/journalHabitDetails.ts",
  "src/styles/journal.css",
  "src/styles/app.css",
  "src/collections/journalVault.ts",
  "src/generated/wasm/orbyn_wasm_bg.wasm",
  "tests/integration/collections-browser.tsx",
  "tests/integration/journal-habits-browser.mjs",
];
const hashes = () =>
  Promise.all(
    sources.map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(resolve(web, path)))
        .digest("hex"),
    })),
  );
await mkdir(output, { recursive: true });
const before = await hashes(),
  runs = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const phrase = "Synthetic Journal habit browser phrase only";
try {
  for (const mode of [
    { id: "normal", os: "no-preference", motion: "system" },
    { id: "os-reduced", os: "reduce", motion: "system" },
    { id: "explicit-on-os-reduced", os: "reduce", motion: "on" },
    { id: "explicit-reduced", os: "no-preference", motion: "reduced" },
  ]) {
    const reduced =
      mode.motion === "reduced" ||
      (mode.os === "reduce" && mode.motion !== "on");
    const context = await browser.newContext({
      viewport: { width: 1200, height: 900 },
      reducedMotion: mode.os,
    });
    await context.addInitScript(({ motion }) => {
      localStorage.setItem("notes.motion", motion);
      localStorage.setItem("notes.theme", "light");
    }, mode);
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(
        `${base}/tests/integration/collections-browser.html?view=journal`,
      );
      await page.getByLabel("Passphrase", { exact: true }).fill(phrase);
      await page.getByLabel("Confirm passphrase", { exact: true }).fill(phrase);
      await page
        .getByRole("button", { name: "Lock Journal", exact: true })
        .click();
      await expect(
        page.getByRole("textbox", { name: "Journal entry", exact: true }),
      ).toBeVisible();
      await page.evaluate(async () => {
        const { emptyJournal, journalToday, saveHabit, setHabitCompletion } =
          await import("/src/collections/journal.ts");
        const today = journalToday(),
          date = new Date(`${today}T12:00:00Z`);
        const day = (offset) => {
          const copy = new Date(date);
          copy.setUTCDate(copy.getUTCDate() + offset);
          return copy.toISOString().slice(0, 10);
        };
        let data = saveHabit(
          emptyJournal(),
          "Synthetic reading",
          new Date(`${day(-5)}T12:00:00Z`),
        );
        data.habits[0].createdOn = day(-5);
        for (let i = -5; i < 0; i++)
          data = setHabitCompletion(
            data,
            day(i),
            data.habits[0].id,
            true,
            new Date(),
          );
        await window.__journalFixture.update(() => data);
      });
      const ready = () =>
        expect
          .poll(() =>
            page.evaluate(() => {
              const status = window.__journalFixture.status();
              return !status.dirty && !status.saving;
            }),
          )
          .toBe(true);
      await ready();
      const habit = page.getByRole("button", {
        name: "Synthetic reading",
        exact: true,
      });
      await expect(habit).toHaveAccessibleDescription(
        /5 consecutive days through/,
      );
      await expect(habit).toHaveAttribute("aria-pressed", "false");
      const box = await habit.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const press = await habit.evaluate(async (element) => {
        const start = performance.now();
        await new Promise((resolve) => {
          const tick = () =>
            performance.now() - start >= 180
              ? resolve()
              : requestAnimationFrame(tick);
          requestAnimationFrame(tick);
        });
        const check = element.querySelector(".journal-check"),
          style = getComputedStyle(check);
        return {
          inner: style.transform,
          outer: getComputedStyle(element).transform,
          width: check.getBoundingClientRect().width,
          tickTransition: getComputedStyle(
            element.querySelector(".journal-check-mark"),
          ).transition,
          tickTransform: getComputedStyle(
            element.querySelector(".journal-check-mark"),
          ).transform,
        };
      });
      expect(press.outer).toBe("none");
      expect(press.inner).toBe(
        reduced ? "none" : "matrix(0.92, 0, 0, 0.92, 0, 0)",
      );
      expect(press.tickTransform).toBe(
        "matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, 0)",
      );
      await page.evaluate(() => {
        window.__habitTriggerAt = null;
        document.addEventListener(
          "pointerup",
          () => {
            window.__habitTriggerAt = performance.now();
          },
          { once: true },
        );
        window.__habitTrace = new Promise((resolve) => {
          const rows = [],
            start = performance.now();
          const tick = () => {
            const button = document.querySelector(
              '.journal-habits button[aria-label="Synthetic reading"]',
            );
            rows.push({
              t:
                window.__habitTriggerAt === null
                  ? null
                  : performance.now() - window.__habitTriggerAt,
              tickOpacity: Number(
                getComputedStyle(button.querySelector(".journal-check-mark"))
                  .opacity,
              ),
              counts: [...button.querySelectorAll(".journal-habit-count")].map(
                (item) => ({
                  text: item.textContent,
                  entering: item.hasAttribute("data-entering"),
                  leaving: item.hasAttribute("data-leaving"),
                  opacity: Number(getComputedStyle(item).opacity),
                }),
              ),
              animations: button
                .getAnimations({ subtree: true })
                .map((animation) => ({
                  name: animation.animationName ?? animation.transitionProperty,
                  duration: animation.effect.getTiming().duration,
                  easing: animation.effect.getTiming().easing,
                  frames: animation.effect
                    .getKeyframes()
                    .map((frame) => ({
                      easing: frame.easing,
                      opacity: frame.opacity,
                      transform: frame.transform,
                    })),
                })),
            });
            if (performance.now() - start < 300) requestAnimationFrame(tick);
            else resolve(rows);
          };
          requestAnimationFrame(tick);
        });
      });
      await page.mouse.up();
      const trace = await page.evaluate(() => window.__habitTrace);
      await expect(habit).toHaveAccessibleDescription(
        /6 consecutive days through/,
      );
      await ready();
      const animations = trace.flatMap((row) => row.animations);
      const release = animations.find(
        (animation) =>
          animation.name === "transform" &&
          animation.frames.some((frame) => frame.transform?.includes("0.92")),
      );
      if (reduced) expect(release).toBeUndefined();
      else {
        expect(release, `${mode.id}: check release must animate`).toBeTruthy();
        expect(release.duration).toBe(150);
      }
      for (const [name, duration] of [
        ["journal-streak-in", 150],
        ["journal-streak-out", reduced ? 150 : 105],
      ]) {
        const found = animations.find((animation) => animation.name === name);
        expect(found, `${mode.id}: ${name} must actually run`).toBeTruthy();
        expect(found.duration).toBe(duration);
      }
      expect(
        trace.some((row) => row.tickOpacity > 0 && row.tickOpacity < 1),
      ).toBe(true);
      await habit.press("Space");
      await expect(habit).toHaveAccessibleDescription(/5 consecutive days/);
      await ready();
      await habit.press("Enter");
      await expect(habit).toHaveAccessibleDescription(/6 consecutive days/);
      await ready();
      if (mode.id === "normal") {
        await page.evaluate(() => {
          const original = IDBObjectStore.prototype.put;
          let fail = true;
          window.__restoreHabitPut = () => {
            IDBObjectStore.prototype.put = original;
          };
          IDBObjectStore.prototype.put = function (...args) {
            if (this.name === "devices" && fail) {
              fail = false;
              throw new DOMException("Synthetic quota", "QuotaExceededError");
            }
            return original.apply(this, args);
          };
        });
        await habit.click();
        await expect
          .poll(() =>
            page.evaluate(() => {
              const status = window.__journalFixture.status();
              return status.dirty && !status.saving && !!status.error;
            }),
          )
          .toBe(true);
        await expect(habit).toHaveAccessibleDescription(/5 consecutive days/);
        await page.evaluate(() => window.__restoreHabitPut());
        await page
          .getByRole("button", { name: "Try again", exact: true })
          .click();
        await ready();
        for (const theme of ["light", "dark", "dim"]) {
          await page.evaluate((theme) => {
            document.documentElement.dataset.theme = theme;
          }, theme);
          await page.screenshot({
            path: resolve(output, `today-${theme}.png`),
          });
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(habit).toHaveAccessibleDescription(/5 consecutive days/);
        await expect(habit.locator(".journal-habit-streak")).toBeHidden();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: resolve(output, "today-narrow-dim.png"),
        });
        await page.setViewportSize({ width: 1200, height: 900 });
      }
      await page.reload();
      await page.getByLabel("Passphrase", { exact: true }).fill(phrase);
      await page
        .getByRole("button", { name: "Unlock Journal", exact: true })
        .click();
      await expect(habit).toHaveAccessibleDescription(
        new RegExp(`${mode.id === "normal" ? 5 : 6} consecutive days`),
      );
      await habit.click();
      await expect
        .poll(() => page.locator(".journal-habit-count[data-leaving]").count())
        .toBe(1);
      const immediate = await page.evaluate(() => {
        window.__collectionsFixture.close();
        let readDenied = false;
        try {
          window.__journalFixture.read();
        } catch {
          readDenied = true;
        }
        return {
          phase: window.__journalFixture.status().phase,
          counts: document.querySelectorAll(".journal-habit-count").length,
          streaks: document.querySelectorAll(".journal-habit-streak").length,
          readDenied,
        };
      });
      expect(immediate).toEqual({
        phase: "revoked",
        counts: 0,
        streaks: 0,
        readDenied: true,
      });
      expect(errors).toEqual([]);
      await writeFile(
        resolve(output, `${mode.id}-trace.json`),
        JSON.stringify(trace, null, 2),
      );
      runs.push({
        ...mode,
        reduced,
        press,
        persisted: true,
        storageFailureRetainedAndRetried: mode.id === "normal",
        immediate,
        errors,
      });
    } finally {
      await context.close();
    }
  }
  // Actual protected writes and calendar rendering, independent of the four
  // motion contexts. Previous month keeps every tested day selectable.
  const calendarContext = await browser.newContext({
    viewport: { width: 1200, height: 900 },
  });
  const calendarPage = await calendarContext.newPage(),
    calendarErrors = [];
  calendarPage.on("pageerror", (error) => calendarErrors.push(error.message));
  try {
    await calendarPage.goto(
      `${base}/tests/integration/collections-browser.html?view=journal`,
    );
    await calendarPage.getByLabel("Passphrase", { exact: true }).fill(phrase);
    await calendarPage
      .getByLabel("Confirm passphrase", { exact: true })
      .fill(phrase);
    await calendarPage
      .getByRole("button", { name: "Lock Journal", exact: true })
      .click();
    await expect(
      calendarPage.getByRole("textbox", { name: "Journal entry", exact: true }),
    ).toBeVisible();
    const dates = await calendarPage.evaluate(async () => {
      const { emptyJournal, journalToday, saveHabit, setHabitCompletion } =
        await import("/src/collections/journal.ts");
      const today = journalToday(),
        year = Number(today.slice(0, 4)),
        month = Number(today.slice(5, 7));
      const prior = new Date(Date.UTC(year, month - 2, 1))
        .toISOString()
        .slice(0, 7);
      const day = (n) => `${prior}-${String(n).padStart(2, "0")}`;
      let data = emptyJournal();
      for (let i = 0; i < 5; i++) {
        data = saveHabit(
          data,
          `Synthetic calendar ${i + 1}`,
          new Date(`${day(1)}T12:00:00Z`),
        );
        const habit = data.habits.at(-1);
        habit.createdOn = day(1);
        for (let n = i + 1; n <= 5; n++)
          data = setHabitCompletion(data, day(n), habit.id, true, new Date());
      }
      await window.__journalFixture.update(() => data);
      return { today, prior };
    });
    await calendarPage
      .getByRole("button", { name: "Previous month", exact: true })
      .click();
    const days = calendarPage.locator(".journal-calendar-days button");
    async function assertDays() {
      for (const [day, level, count] of [
        [1, 1, 1],
        [2, 1, 2],
        [3, 2, 3],
        [4, 3, 4],
        [5, 3, 5],
        [6, 0, 0],
      ]) {
        const button = days.filter({ hasText: new RegExp(`^${day}$`) });
        await expect(button).toHaveAttribute("data-level", String(level));
        await expect(button).toHaveAccessibleName(
          new RegExp(`${count} of 5 habits`),
        );
      }
      const legend = calendarPage.getByRole("group", {
        name: "Habits done legend",
      });
      await expect(legend.getByText("4+", { exact: true })).toBeVisible();
      await expect(legend).toContainText("4 or more");
    }
    await assertDays();
    await calendarPage.evaluate(async () => {
      const { archiveHabit, saveHabit } =
        await import("/src/collections/journal.ts");
      await window.__journalFixture.update((data) => {
        const id = data.habits[0].id;
        return archiveHabit(
          saveHabit(data, "Synthetic renamed", new Date(), id),
          id,
          new Date(),
        );
      });
    });
    await assertDays();
    await calendarPage
      .getByRole("button", { name: "Next month", exact: true })
      .click();
    await calendarPage.evaluate(async () => {
      const { emptyJournal, journalToday, saveHabit, setHabitCompletion } =
        await import("/src/collections/journal.ts");
      const today = journalToday(),
        start = `${today.slice(0, 7)}-01`;
      let data = emptyJournal();
      for (let i = 0; i < 100; i++) {
        data = saveHabit(
          data,
          `Synthetic denominator ${i + 1}`,
          new Date(`${start}T12:00:00Z`),
        );
        data.habits.at(-1).createdOn = start;
        if (i < 3)
          data = setHabitCompletion(
            data,
            today,
            data.habits.at(-1).id,
            true,
            new Date(),
          );
      }
      await window.__journalFixture.update(() => data);
    });
    const todayButton = calendarPage.locator(
      '.journal-calendar-days button[aria-current="date"]',
    );
    await expect(todayButton).toHaveAttribute("data-level", "2");
    await expect(todayButton).toHaveAccessibleName(/3 of 100 habits/);
    const legend = calendarPage.getByRole("group", {
      name: "Habits done legend",
    });
    await expect(legend).toContainText("0, 1 to 2, 3, 4");
    await expect(legend.getByText("4+", { exact: true })).toHaveCount(0);
    expect(calendarErrors).toEqual([]);
    runs.push({
      id: "calendar-history",
      priorMonth: dates.prior,
      levels: [1, 1, 2, 3, 3, 0],
      counts: [1, 2, 3, 4, 5, 0],
      renameArchiveRetainedHistory: true,
      denominator100Completed3: true,
      errors: calendarErrors,
    });
  } finally {
    await calendarContext.close();
  }
  const after = await hashes();
  expect(after).toEqual(before);
  await writeFile(
    resolve(output, "result.json"),
    JSON.stringify(
      {
        qualification:
          "Genuine production JournalVault, WASM and IndexedDB; isolated synthetic account; actual browser transitions and keyboard, not backend-auth/native-input/FPS/full-frame qualification",
        before,
        after,
        runs,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      policies: runs.length - 1,
      calendarContexts: 1,
      sourceDrift: false,
      errors: 0,
    }),
  );
} finally {
  await browser.close();
}
