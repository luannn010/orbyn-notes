import { chromium, expect } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const output =
  process.env.NOTES_UI_OUTPUT ?? "test-results/study-source-reopen";
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "orbyn-source-reopen-"));
const url = `${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179"}/tests/integration/study-source-browser.html`;
const errors = [];
const quote = "NADH and FADH2";
const body = `Before ${quote} after. ${quote} again.`;
const selectedOffset = body.lastIndexOf(quote);
let context;
async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
    headless: true,
    viewport: { width: 1160, height: 850 },
  });
  // The Vite assets remain available. This deliberately proves local encrypted
  // state with the account API unreachable, not offline frontend installation.
  await context.route("http://127.0.0.1:8089/**", (route) => route.abort());
  const page = context.pages()[0] ?? (await context.newPage());
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.__studySourceFixture));
  return page;
}
const metadata = (page) =>
  page.evaluate(() => window.__studySourceFixture.metadata());
async function exactDecoration(page, selector) {
  const actual = await page
    .getByLabel("Note content", { exact: true })
    .evaluate((element, selector) => {
      const decoration = element.querySelector(selector);
      if (!decoration) return null;
      const prefix = element.ownerDocument.createRange();
      prefix.selectNodeContents(element);
      prefix.setEndBefore(decoration);
      return { prefix: prefix.toString(), text: decoration.textContent };
    }, selector);
  assert.deepEqual(actual, {
    prefix: body.slice(0, selectedOffset),
    text: quote,
  });
}
async function openNote(page) {
  await page.getByRole("button", { name: /^All notes/ }).click();
  await page
    .getByRole("button")
    .filter({ hasText: "Reload source note" })
    .click();
  await expect(page.getByLabel("Note title")).toHaveValue("Reload source note");
  await expect(page.locator(".study-source-annotation")).toHaveText(
    "NADH and FADH2",
  );
  await exactDecoration(page, ".study-source-annotation");
}

try {
  let page = await launch();
  await page.getByRole("button", { name: "Study", exact: true }).click();
  await page
    .getByRole("button", { name: "New deck", exact: true })
    .first()
    .click();
  let dialog = page.getByRole("dialog", { name: "New deck", exact: true });
  await dialog.getByLabel("Name").fill("Reload source deck");
  await dialog
    .getByRole("button", { name: "Create deck", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: /^All notes/ }).click();
  await page.locator('#main').getByRole("button", { name: "New note", exact: true }).first().click();
  await page.getByLabel("Note title").fill("Reload source note");
  const editor = page.getByLabel("Note content", { exact: true });
  await editor.click();
  await page.keyboard.type(body);
  await expect(
    page.getByText("Saved in this browser", { exact: true }),
  ).toBeVisible();
  await editor.press("Control+Home");
  for (let i = 0; i < selectedOffset; i++) await editor.press("ArrowRight");
  for (let i = 0; i < 14; i++) await editor.press("Shift+ArrowRight");
  await page
    .getByRole("toolbar", { name: "Selection tools", exact: true })
    .getByRole("button", { name: "Make a card", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Make a card", exact: true });
  await expect(
    dialog.getByRole("textbox", { name: "Back", exact: true }),
  ).toHaveValue("NADH and FADH2");
  await dialog
    .getByRole("textbox", { name: "Front", exact: true })
    .fill("Which carriers persist?");
  await dialog.getByRole("button", { name: "Add card", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".study-source-annotation")).toHaveText(
    "NADH and FADH2",
  );
  const before = await metadata(page);
  assert.equal(before.entries.length, 1);
  assert.equal(before.cards.length, 1);
  assert.equal(before.entries[0].source.version, 2);
  const originalAnchors = await page.evaluate(
    (id) => window.__studySourceFixture.annotations(id),
    before.notes[0].id,
  );
  assert.equal(originalAnchors.length, 1);
  assert.equal(originalAnchors[0].from, selectedOffset + 1);
  assert.equal(originalAnchors[0].to, selectedOffset + quote.length + 1);
  await exactDecoration(page, ".study-source-annotation");

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__studySourceFixture));
  assert.deepEqual(await metadata(page), before);
  await openNote(page);
  await page.screenshot({
    path: join(output, "underline-after-page-reload.png"),
  });
  await context.close();
  context = undefined;

  // Relaunch a new Chromium process against the same task-only profile. No
  // in-memory source service, key or editor can carry the old projection over.
  page = await launch();
  assert.deepEqual(await metadata(page), before);
  await openNote(page);
  const noteId = before.notes[0].id;
  const anchors = await page.evaluate(
    (id) => window.__studySourceFixture.annotations(id),
    noteId,
  );
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].entryId, before.entries[0].id);
  assert.deepEqual(anchors, originalAnchors);
  await page.getByRole("button", { name: /Back to notes$/ }).click();
  await page.getByRole("button", { name: "Study", exact: true }).click();
  await page
    .getByRole("button", { name: "Reload source deck", exact: true })
    .click();
  await page.getByRole("button", { name: /^Study 1 card$/ }).click();
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await page.getByRole("button", { name: "Open in note", exact: true }).click();
  await expect(page.locator(".study-source-highlight")).toHaveText(
    "NADH and FADH2",
  );
  await exactDecoration(page, ".study-source-highlight");
  await page.screenshot({
    path: join(output, "verified-jump-after-browser-restart.png"),
  });
  await page.getByRole("button", { name: "Back to card", exact: true }).click();
  await expect(
    page.getByRole("article", { name: "Card answer" }),
  ).toBeVisible();
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        qualified:
          "Disposable synthetic account session; actual production editor/source/WASM/IndexedDB and retained CryptoKey across Chromium restart. Vite assets stay online, account API blocked. Not account-server login, installed-offline frontend, or native input qualification.",
        checks: [
          "actual second-occurrence selection and atomic card/anchor save",
          "exact saved PM range matches second occurrence",
          "page reload restores exact entry/card/note identities and underline DOM offset",
          "new Chromium process restores encrypted state/retained key",
          "verified source jump after restart matches saved second-occurrence PM range and exact DOM prefix, not first equal quote",
          "revealed review retained on return after restart",
        ],
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("Study source encrypted page reload and browser restart passed");
} catch (error) {
  const page = context?.pages()[0];
  if (page) {
    await page.screenshot({ path: join(output, "failure.png") });
    await writeFile(
      join(output, "failure.txt"),
      `${String(error)}\n${await page.locator("body").innerText()}`,
    );
  }
  throw error;
} finally {
  await context?.close();
}
