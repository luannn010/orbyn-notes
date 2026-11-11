import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const output =
  process.env.NOTES_UI_OUTPUT ?? "test-results/journal-link-browser";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
const passphrase = "Synthetic link recovery phrase only";
try {
  await mkdir(output, { recursive: true });
  for (const [theme, width] of [
    ["light", 1160],
    ["dark", 1160],
    ["dim", 390],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((theme) => {
      localStorage.setItem("notes.theme", theme);
      localStorage.setItem("notes.motion", "reduced");
    }, theme);
    await page.goto(
      `${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179"}/tests/integration/collections-browser.html?view=journal`,
    );
    await page.getByLabel("Passphrase", { exact: true }).fill(passphrase);
    await page
      .getByLabel("Confirm passphrase", { exact: true })
      .fill(passphrase);
    await page
      .getByRole("button", { name: "Lock Journal", exact: true })
      .click();
    async function unlock(secret = passphrase) {
      await page.getByLabel("Passphrase", { exact: true }).fill(secret);
      await page
        .getByRole("button", { name: "Unlock Journal", exact: true })
        .click();
    }
    const editor = page.getByRole("textbox", {
      name: "Journal entry",
      exact: true,
    });
    await expect(editor).toBeVisible();
    await editor.fill("Synthetic journal selection");
    await expect
      .poll(() => page.evaluate(() => window.__journalFixture.status().saving))
      .toBe(false);
    await editor.focus();
    await page.keyboard.press("Control+A");
    await page.getByRole("button", { name: "Link", exact: true }).click();
    let popup = page.getByRole("dialog", { name: "Web link", exact: true });
    const uri = "https://example.test/private-unfinished-link";
    await popup.getByLabel("URL", { exact: true }).fill(uri);
    await expect
      .poll(() =>
        page.evaluate(() => window.__journalFixture.status().linkDraftDirty),
      )
      .toBe(true);
    await popup
      .getByRole("button", { name: "Lock Journal", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Journal is locked" }),
    ).toBeVisible();
    await expect(editor).toHaveCount(0);
    await expect(popup).toHaveCount(0);
    expect(await page.locator("body").textContent()).not.toContain(uri);
    expect(
      await page
        .locator("input")
        .evaluateAll((inputs) => inputs.map((input) => input.value)),
    ).not.toContain(uri);
    await unlock("Wrong synthetic recovery phrase");
    await expect(page.getByRole("alert")).toContainText(
      "Couldn’t unlock Journal",
    );
    expect(await page.locator("body").textContent()).not.toContain(uri);
    await unlock();
    popup = page.getByRole("dialog", { name: "Web link", exact: true });
    await expect(popup.getByLabel("URL", { exact: true })).toHaveValue(uri);
    await expect(
      popup.getByRole("button", { name: "Apply link" }),
    ).toBeEnabled();
    const rect = await popup.boundingBox();
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: join(output, `recovered-${theme}-${width}.png`),
    });
    await popup.getByRole("button", { name: "Apply link" }).click();
    await expect(popup).toHaveCount(0);
    await expect(editor.locator("a")).toHaveAttribute("href", uri);
    await expect(editor).toHaveText("Synthetic journal selection");
    await expect
      .poll(() => page.evaluate(() => window.__journalFixture.status().dirty))
      .toBe(false);
    await editor.locator("a").click({ position: { x: 3, y: 3 } });
    await page.getByRole("button", { name: "Link", exact: true }).click();
    await popup
      .getByLabel("URL", { exact: true })
      .fill("unfinished invalid URL");
    await page.evaluate(() => window.__journalFixture.lock());
    await expect(
      page.getByRole("heading", { name: "Journal is locked" }),
    ).toBeVisible();
    await unlock();
    await expect(popup.getByLabel("URL", { exact: true })).toHaveValue(
      "unfinished invalid URL",
    );
    await popup.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(popup).toHaveCount(0);
    await expect(editor.locator("a")).toHaveAttribute("href", uri);
    await page.getByRole("button", { name: "Link", exact: true }).click();
    await popup
      .getByLabel("URL", { exact: true })
      .fill("https://example.test/away-draft");
    await page.clock.install();
    await page.evaluate(() => window.__journalFixture.setAway(true));
    await page.clock.fastForward(60001);
    await expect(
      page.getByRole("heading", { name: "Journal is locked" }),
    ).toBeVisible();
    expect(await page.locator("body").textContent()).not.toContain(
      "https://example.test/away-draft",
    );
    await page.evaluate(() => window.__journalFixture.setAway(false));
    await unlock();
    await expect(popup.getByLabel("URL", { exact: true })).toHaveValue(
      "https://example.test/away-draft",
    );
    await popup.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.reload();
    await unlock();
    await expect(editor.locator("a")).toHaveAttribute("href", uri);
    await expect(popup).toHaveCount(0);
    expect(errors).toEqual([]);
    results.push({
      theme,
      width,
      manualLock: true,
      wrongProofHidden: true,
      recoveredURL: true,
      selectionApply: true,
      invalidEditLockCancel: true,
      reload: true,
      errors,
    });
    await context.close();
  }
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        authentication:
          "Synthetic account session; real WASM, IndexedDB and Journal encryption. No account-server qualification.",
        results,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: results.length, output }));
} finally {
  await browser.close();
}
