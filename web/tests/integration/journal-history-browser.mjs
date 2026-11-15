// Real encrypted Journal/IDB; disposable synthetic browser contexts only.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

if (!process.argv.includes("--run"))
  throw Error("Pass --run for synthetic Journal profiles.");
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5193";
const output = resolve(
  process.env.NOTES_UI_OUTPUT ?? "test-results/journal-history",
);
// Notes artifact 706a8d07, frame journal-history, shared nlist/nrow rules.
const reference = {
  listGap: "2px",
  listPadding: "0px",
  padding: "9px 12px",
  radius: "10px",
  rowGap: "1px",
  columnGap: "12px",
  titleSize: "13.5px",
  snippetSize: "12.5px",
  statusSize: "12px",
  iconSize: 13,
};
const text =
  "Synthetic history entry with a long passage. ".repeat(9) +
  "Accessible ending beyond 160 characters.";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const theme of ["light", "dark", "dim"]) {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 900 },
    });
    await context.addInitScript(
      (theme) => localStorage.setItem("notes.theme", theme),
      theme,
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(
        `${base}/tests/integration/collections-browser.html?view=journal`,
      );
      const phrase = "Synthetic Journal history phrase only";
      await page.getByLabel("Passphrase", { exact: true }).fill(phrase);
      await page.getByLabel("Confirm passphrase", { exact: true }).fill(phrase);
      await page
        .getByRole("button", { name: "Lock Journal", exact: true })
        .click();
      await expect(
        page.getByRole("textbox", { name: "Journal entry", exact: true }),
      ).toBeVisible();
      const date = await page.evaluate(async (text) => {
        const {
          emptyJournal,
          journalToday,
          saveHabit,
          setHabitCompletion,
          writeJournalEntry,
        } = await import("/src/collections/journal.ts");
        const today = journalToday();
        const day = today.slice(0, 8) + "01";
        let data = saveHabit(
          emptyJournal(),
          "Synthetic reading",
          new Date(`${day}T12:00:00`),
        );
        data = writeJournalEntry(
          data,
          day,
          {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          },
          null,
          new Date(),
        );
        data = setHabitCompletion(
          data,
          day,
          data.habits[0].id,
          true,
          new Date(),
        );
        if (day !== today)
          data = writeJournalEntry(
            data,
            today,
            {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Synthetic current entry" }],
                },
              ],
            },
            null,
            new Date(),
          );
        await window.__journalFixture.update(() => data);
        return day;
      }, text);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const state = window.__journalFixture.status();
            return !state.dirty && !state.saving;
          }),
        )
        .toBe(true);
      for (const width of [1200, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page
          .getByRole("button", { name: "Past entries", exact: true })
          .click();
        const row = page
          .locator(".journal-history-row")
          .filter({ hasText: "Accessible ending beyond 160 characters." });
        await expect(row).toHaveAccessibleName(
          new RegExp("Accessible ending beyond 160 characters.*1 of 1 habits"),
        );
        const measured = await row.evaluate((row) => {
          const css = getComputedStyle(row),
            list = getComputedStyle(row.parentElement);
          const title = row.querySelector("b"),
            snippet = row.querySelector(".journal-history-snippet"),
            status = row.querySelector("small"),
            icon = row.querySelector("svg");
          const rect = row.getBoundingClientRect(),
            statusRect = status.getBoundingClientRect();
          return {
            listGap: list.gap,
            listPadding: list.padding,
            padding: css.padding,
            radius: css.borderRadius,
            rowGap: css.rowGap,
            columnGap: css.columnGap,
            titleSize: getComputedStyle(title).fontSize,
            snippetSize: getComputedStyle(snippet).fontSize,
            statusSize: getComputedStyle(status).fontSize,
            iconSize: icon.getBoundingClientRect().width,
            columns: css.gridTemplateColumns,
            border: css.borderBottomWidth,
            titleColor: getComputedStyle(title).color,
            secondaryColor: getComputedStyle(status).color,
            snippetColor: getComputedStyle(snippet).color,
            height: rect.height,
            right: rect.right,
            statusRight: statusRect.right,
            truncated: snippet.scrollWidth > snippet.clientWidth,
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        expect(measured).toMatchObject(reference);
        expect(measured.columns).toMatch(/^20px [\d.]+px [\d.]+px$/);
        expect(measured.border).toBe("0px");
        expect(measured.secondaryColor).toBe(measured.snippetColor);
        expect(measured.titleColor).not.toBe(measured.secondaryColor);
        expect(measured.right - measured.statusRight).toBeCloseTo(12, 0);
        expect(measured.truncated).toBe(true);
        expect(measured.overflow).toBe(false);
        // Reach the row through Tab and inspect the actual keyboard focus ring.
        await page
          .getByRole("button", { name: "Past entries", exact: true })
          .focus();
        for (
          let tab = 0;
          tab < 40 &&
          !(await row.evaluate((el) => el === document.activeElement));
          tab++
        )
          await page.keyboard.press("Tab");
        await expect(row).toBeFocused();
        expect(
          await row.evaluate((el) => getComputedStyle(el).outlineStyle),
        ).toBe("solid");
        await row.screenshot({
          path: resolve(output, `${theme}-${width}-row.png`),
        });
        await page.screenshot({
          path: resolve(output, `${theme}-${width}.png`),
          fullPage: true,
        });
        await page.keyboard.press("Enter");
        await expect(
          page.getByRole("textbox", { name: "Journal entry", exact: true }),
        ).toHaveText(text);
        await expect(
          page.locator(".journal-entry > .journal-caption"),
        ).toHaveText(
          await page.evaluate(
            (date) =>
              new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              }),
            date,
          ),
        );
        await page
          .getByRole("button", { name: "Past entries", exact: true })
          .click();
        await row.click();
        await expect(
          page.getByRole("textbox", { name: "Journal entry", exact: true }),
        ).toHaveText(text);
        results.push({ theme, width, ...measured });
      }
      await page
        .getByRole("button", { name: "Past entries", exact: true })
        .click();
      await page.evaluate(() => window.__journalFixture.lock());
      await expect(
        page.getByRole("heading", { name: "Journal is locked", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".journal-history-row")).toHaveCount(0);
      await expect(page.getByText(text, { exact: true })).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }
  await writeFile(
    resolve(output, "measurements.json"),
    JSON.stringify({ reference, results }, null, 2) + "\n",
  );
  console.log(
    `Passed ${results.length} theme/width history cases, date opening, keyboard focus and lock hiding.`,
  );
} finally {
  await browser.close();
}
