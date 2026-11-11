import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const output = process.env.NOTES_UI_OUTPUT ?? "test-results/setup-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1160, height: 850 },
});
await context.route(
  "**/tests/integration/note-link-entry-browser.html**",
  async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        "font:12px sans-serif",
        "position:fixed;left:4px;bottom:4px;z-index:40;max-width:190px;pointer-events:none;font:10px sans-serif",
      ),
    });
  },
);
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
async function settled(locator) {
  await locator.evaluate(async (element) => {
    await document.fonts.ready;
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
  });
  await expect(locator).toHaveCSS("opacity", "1");
}
async function openManual() {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Settings", exact: true })
    .getByRole("button", { name: "Set up Notes", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Set up Orbyn Notes" }),
  ).toBeVisible();
}
async function choose(files) {
  const wait = page.waitForEvent("filechooser");
  await page
    .getByRole("dialog", { name: "Set up Orbyn Notes" })
    .getByRole("button", { name: "Import notes", exact: true })
    .click();
  await (await wait).setFiles(files);
}
try {
  await page.goto(
    `${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179"}/tests/integration/note-link-entry-browser.html`,
  );
  let setup = page.getByRole("dialog", { name: "Set up Orbyn Notes" });
  await expect(setup).toBeVisible();
  await expect(setup).toContainText("Step 2 of 3");
  if ((await page.evaluate(() => localStorage.getItem("notes.setup"))) !== null)
    throw Error("Setup persisted before explicit completion");
  for (const theme of ["light", "dark", "dim"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await settled(setup);
    await page.screenshot({ path: `${output}/first-run-${theme}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup
    .getByRole("button", { name: "Import notes", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    setup.getByRole("button", { name: "Import notes", exact: true }),
  ).toBeInViewport();
  await setup
    .getByRole("button", { name: "Close setup", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    setup.getByRole("button", { name: "Close setup", exact: true }),
  ).toBeInViewport();
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Setup horizontal overflow");
  await settled(setup);
  await page.screenshot({ path: output + "/first-run-narrow-dim-reduced.png" });
  await page.setViewportSize({ width: 1160, height: 850 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await choose([]);
  await expect(
    setup.getByRole("button", { name: "Import notes", exact: true }),
  ).toBeEnabled();
  await choose({
    name: "not-markdown.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Original stays unchanged."),
  });
  await expect(setup.getByRole("alert")).toContainText("Choose Markdown files");
  await setup.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(setup).toContainText("Step 3 of 3");
  await setup.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(setup).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No notes yet", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Write your first note, or bring in what you already have.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Notes are encrypted on this device.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: output + "/empty-library-dim.png" });
  const hint = await page.evaluate(() => localStorage.getItem("notes.setup"));
  if (hint !== '{"version":1,"dismissed":true}')
    throw Error("Setup preference shape/content mismatch");
  await openManual();
  setup = page.getByRole("dialog", { name: "Set up Orbyn Notes" });
  await choose([
    {
      name: "one.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Imported one\n\nReal encrypted local writing."),
    },
    {
      name: "two.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Imported two\n\nSecond real local note."),
    },
  ]);
  const review = page.getByRole("dialog", { name: "Import Markdown" });
  await expect(review).toContainText("2 files ready");
  await review
    .getByRole("button", { name: "Import remaining", exact: true })
    .click();
  await expect(review).toHaveCount(0);
  await expect(setup).toContainText("2 notes imported.");
  await expect(setup).toContainText("Step 3 of 3");
  await setup.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(setup).toHaveCount(0);
  let data = await page.evaluate(() => window.__noteEntryFixture.metadata());
  if (data.notes.length !== 2) throw Error("Actual imported count mismatch");
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Imported one/ }).first(),
  ).toBeVisible();
  await expect(setup).toHaveCount(0);
  data = await page.evaluate(() => window.__noteEntryFixture.metadata());
  if (data.notes.length !== 2) throw Error("Encrypted import reload mismatch");
  await page.getByRole("button", { name: "Study", exact: true }).click();
  await page
    .getByRole("button", { name: "New deck", exact: true })
    .first()
    .click();
  let dialog = page.getByRole("dialog", { name: "New deck", exact: true });
  await dialog.getByLabel("Name").fill("Actual retained setup study");
  await dialog
    .getByRole("button", { name: "Create deck", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add card", exact: true })
    .first()
    .click();
  dialog = page.getByRole("dialog", { name: "Add card", exact: true });
  await dialog
    .getByLabel("Front", { exact: true })
    .fill("Actual setup question");
  await dialog
    .getByLabel("Back", { exact: true })
    .fill("Actual retained answer");
  await dialog.getByRole("button", { name: "Add card", exact: true }).click();
  await page.getByRole("button", { name: /^Study 1 card$/ }).click();
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await openManual();
  await page
    .getByRole("dialog", { name: "Set up Orbyn Notes" })
    .getByRole("button", { name: "Close setup", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: "Card answer", exact: true }),
  ).toContainText("Actual retained answer");
  await page.getByRole("button", { name: "End session", exact: true }).click();
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Set a Journal passphrase",
      exact: true,
    }),
  ).toBeVisible();
  const secret = "synthetic-setup-journal-only-passphrase";
  await page.getByLabel("Passphrase", { exact: true }).fill(secret);
  await page.getByLabel("Confirm passphrase", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Lock Journal", exact: true }).click();
  await expect(
    page
      .getByRole("textbox", { name: "Journal entry", exact: true })
      .or(
        page.getByRole("heading", { name: "Journal is locked", exact: true }),
      ),
  ).toBeVisible();
  if (
    await page
      .getByRole("heading", { name: "Journal is locked", exact: true })
      .count()
  ) {
    await page.getByLabel("Passphrase", { exact: true }).fill(secret);
    await page
      .getByRole("button", { name: "Unlock Journal", exact: true })
      .click();
  }
  await page
    .getByRole("textbox", { name: "Journal entry", exact: true })
    .fill("Synthetic protected marker for setup lifecycle.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await openManual();
  await expect(
    page.getByText("Synthetic protected marker for setup lifecycle.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("dialog", { name: "Set up Orbyn Notes" })
    .getByRole("button", { name: "Close setup", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Journal is locked", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic protected marker for setup lifecycle.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.screenshot({ path: output + "/journal-return-protected.png" });
  if (errors.length) throw Error(errors.join("\n"));
  await writeFile(
    output + "/result.json",
    JSON.stringify(
      {
        qualified:
          "Actual App/production UI and real WASM/IndexedDB under disposable synthetic session; no account backend/native OS/file-dialog/physical IME claim. Fixture provenance label fixed before paint.",
        checks: [
          "optional first-run actual empty writable profile",
          "all3themes+narrow/reduced actionreachability",
          "actual file input cancel and invalidextension",
          "skip exactempty principalcopy",
          "exactcontent-free persisted profile hint",
          "explicitSettingsreopen despitehint",
          "real2file Markdown encryptedimport+reload",
          "revealedStudy actor preserved",
          "cleanJournalhost disposed and protectedgate onreturn",
        ],
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("Setup browser passed");
} catch (error) {
  await page.screenshot({ path: output + "/failure.png" });
  await writeFile(
    output + "/failure.txt",
    String(error) +
      "\nURL " +
      page.url() +
      "\n" +
      (await page.locator("body").innerText()),
  );
  throw error;
} finally {
  await browser.close();
}
