import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const output = process.env.NOTES_UI_OUTPUT ?? "test-results/note-link-entry";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1160, height: 850 },
});
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(
    `${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179"}/tests/integration/note-link-entry-browser.html?invite=private-not-for-copy`,
  );
  const setup = page.getByRole("dialog", { name: "Set up Orbyn Notes" });
  await expect(setup).toBeVisible();
  await setup.getByRole("button", { name: "Skip", exact: true }).click();
  await setup.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(setup).not.toBeVisible();
  for (const title of ["Entry target", "Entry other"]) {
    await page.locator('#main').getByRole("button", { name: "New note", exact: true }).first().click();
    await page.getByLabel("Note title").fill(title);
    await page
      .getByLabel("Note content", { exact: true })
      .fill("Saved body for " + title);
    await expect(
      page.getByText("Saved in this browser", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to notes" }).click();
  }
  const data = await page.evaluate(async () => {
    const metadata = await window.__noteEntryFixture.metadata();
    const target = metadata.notes.find((note) => note.title === "Entry target");
    return {
      ...target,
      reference: await window.__noteEntryFixture.reference(target.id),
    };
  });
  const hash = "#note/v1/" + data.reference.split("/v1/")[1];
  await page.evaluate((value) => {
    location.hash = value;
  }, hash);
  await expect(page.getByLabel("Note title")).toHaveValue("Entry target");
  await page.reload();
  await expect(page.getByLabel("Note title")).toHaveValue("Entry target");
  await page.getByRole("button", { name: "Note menu", exact: true }).click();
  await page.getByRole("menuitem", { name: /Copy (note )?link/i }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain(hash);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  if (copied.includes("private-not-for-copy") || new URL(copied).search)
    throw Error("Copied private query");
  await page.getByRole("button", { name: "Back to notes" }).click();
  await page
    .getByRole("button", { name: /Entry other/ })
    .first()
    .click();
  await page.evaluate(() => {
    location.hash = "note/v9/invalid";
  });
  await expect(
    page.getByText("This note link isn’t valid.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Note title")).toHaveValue("Entry other");
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  // The existing unsaved-note boundary must also guard external hash entry.
  await page.getByRole("button", { name: "Back to notes" }).click();
  await page.locator('#main').getByRole("button", { name: "New note", exact: true }).first().click();
  // New note itself is already committed. Make an actual unsaved title edit.
  await page.getByLabel("Note title").fill("Keep this draft");
  await page.evaluate((value) => {
    location.hash = value;
  }, hash);
  await expect(
    page.getByText("Finish your current work before opening this note.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Note title")).toHaveValue("Keep this draft");
  await page
    .getByLabel("Note content", { exact: true })
    .fill("Actually save before retry.");
  await expect(
    page.getByText("Saved in this browser", { exact: true }),
  ).toBeVisible();
  // Saving must not implicitly retry the incoming intent.
  await expect(page.getByLabel("Note title")).toHaveValue("Keep this draft");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByLabel("Note title")).toHaveValue("Entry target");
  // Check immediately: the old five-second notice timer is not a navigation fix.
  expect(
    await page
      .getByRole("status")
      .filter({
        hasText: "Finish or discard your unsaved changes before leaving.",
      })
      .count(),
  ).toBe(0);
  await page.locator(".editor-pane").evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  await expect(page.locator(".editor-pane")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: output + "/web-entry.png" });
  if (errors.length) throw Error(errors.join("\n"));
  await writeFile(
    output + "/result.json",
    JSON.stringify(
      {
        qualified:
          "Actual App, navigation, encrypted store and clipboard in isolated Chrome synthetic session; not account authentication/native association",
        checks: [
          "hash opens exact target",
          "reload opens target",
          "copied web link excludes query",
          "invalid link preserves current note",
          "unsaved new draft blocks entry",
          "save does not auto retry",
          "explicit retry opens target",
        ],
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("Web note entry browser passed");
} catch (error) {
  await page.screenshot({ path: output + "/failure.png" });
  await writeFile(
    output + "/failure.txt",
    String(error) + "\n" + (await page.locator("body").innerText()),
  );
  throw error;
} finally {
  await browser.close();
}
