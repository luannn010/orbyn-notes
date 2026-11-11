import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const output = process.env.NOTES_UI_OUTPUT ?? "test-results/search-fixture";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1160, height: 850 },
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(
    `${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179"}/tests/integration/search-browser.html`,
  );
  await page.waitForFunction(
    () =>
      !!window.__searchFixture ||
      document.getElementById("root")?.dataset.fixtureFailed === "true",
    undefined,
    { timeout: 20000 },
  );
  if (await page.locator("#root").getAttribute("data-fixture-failed"))
    throw new Error(await page.locator("#root").innerText());
  await expect(
    page.getByRole("heading", { name: "All notes", exact: true }),
  ).toBeVisible();
  const metadata = await page.evaluate(() => window.__searchFixture.metadata());
  expect(
    metadata.notes.filter(
      (note) => !note.trashedAt && note.title.toLowerCase().includes("lisbon"),
    ),
  ).toHaveLength(62);
  expect(metadata.clips).toHaveLength(2);
  expect(metadata.cards).toHaveLength(5);
  expect(metadata.notes.filter((note) => !!note.trashedAt)).toHaveLength(1);
  expect(metadata.eventCount).toBe(0);
  await page.reload();
  await page.waitForFunction(() => !!window.__searchFixture);
  await expect(
    page.getByRole("heading", { name: "All notes", exact: true }),
  ).toBeVisible();
  const after = await page.evaluate(() => window.__searchFixture.metadata());
  expect(after.cards).toEqual(metadata.cards);
  expect(after.clips).toEqual(metadata.clips);
  expect(after.notes).toEqual(metadata.notes);
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        qualified:
          "Test-only actual App + encrypted WASM/IDB synthetic session; not account authentication or Search UI acceptance",
        notesMatchingLisbon: 62,
        clips: 2,
        actualCards: 5,
        trashed: 1,
        eventCount: 0,
        reloadRetainsActualIdentities: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("Search mixed-corpus fixture and reload passed");
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  await writeFile(`${output}/failure.txt`, String(error));
  throw error;
} finally {
  await context.close();
  await browser.close();
}
