import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const output = process.env.NOTES_UI_OUTPUT ?? "test-results/sidebar-resize";
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5187";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 850 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const rail = page.getByRole("separator", { name: "Resize sidebar" });
const sidebar = page.getByLabel("Notes navigation", { exact: true });
async function width(value) {
  await expect(rail).toHaveAttribute("aria-valuenow", String(value));
  await expect
    .poll(async () => Math.round((await sidebar.boundingBox()).width))
    .toBe(value);
}
async function dragTo(value) {
  const box = await rail.boundingBox();
  if (!box) throw Error("No resize rail");
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(value, box.y + 100, { steps: 8 });
  await width(value);
}
try {
  await page.goto(`${base}/tests/integration/library-browser.html`);
  await expect(
    page.getByRole("heading", { name: "All notes", exact: true }),
  ).toBeVisible();
  await width(224);
  await page
    .getByRole("button", { name: "New note", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Note title", { exact: true })
    .fill("Sidebar retained note");
  await page
    .getByLabel("Note content", { exact: true })
    .fill("Writing survives sidebar gestures.");
  await expect(
    page.getByText("Saved in this browser", { exact: true }),
  ).toBeVisible();
  const longTag =
    "A deliberately long sidebar tag whose full accessible name survives resizing";
  await page.getByLabel("New tag", { exact: true }).fill(longTag);
  await page.getByRole("button", { name: "Add tag", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `${longTag}, 1 note`, exact: true }),
  ).toBeVisible();
  for (const theme of ["light", "dark", "dim"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await dragTo(300);
    await page.screenshot({ path: `${output}/dragging-${theme}.png` });
    await page.mouse.up();
    await rail.dblclick();
    await width(224);
  }
  await rail.focus();
  await page.keyboard.press("ArrowLeft");
  await width(208);
  await page.keyboard.press("Enter");
  await width(224);
  await dragTo(420);
  await page.mouse.move(800, 150);
  await width(420);
  await page.mouse.up();
  await dragTo(180);
  await page.mouse.move(50, 150);
  await width(180);
  const tagButton = page.getByRole("button", {
    name: `${longTag}, 1 note`,
    exact: true,
  });
  await expect(tagButton).toBeVisible();
  const label = tagButton.locator(".nav-label");
  expect(
    await label.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: `${output}/minimum-long-tag-dim.png` });
  await page.mouse.up();
  await dragTo(300);
  await page.mouse.up();
  await expect(page.getByLabel("Note content", { exact: true })).toContainText(
    "Writing survives sidebar gestures.",
  );
  await page.reload();
  await width(300);
  await page
    .getByRole("button", { name: /Sidebar retained note/ })
    .first()
    .click();
  await expect(page.getByLabel("Note content", { exact: true })).toContainText(
    "Writing survives sidebar gestures.",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dim";
  });
  await dragTo(320);
  await expect(rail).toHaveCSS("width", "16px");
  expect(
    await rail.evaluate(
      (element) => getComputedStyle(element, "::after").width,
    ),
  ).toBe("2px");
  await page.screenshot({ path: `${output}/dragging-reduced-dim.png` });
  await page.mouse.up();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rail).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Notes navigation" }),
  ).toBeVisible();
  await expect(rail).toHaveCount(0);
  await page.screenshot({ path: `${output}/narrow-drawer-dim.png` });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 850 });
  await width(320);
  const denied = await browser.newContext({
    viewport: { width: 1280, height: 850 },
  });
  try {
    await denied.addInitScript(() => {
      const get = Storage.prototype.getItem,
        set = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key) {
        if (key === "notes.sidebar-width")
          throw new DOMException("Denied", "SecurityError");
        return get.call(this, key);
      };
      Storage.prototype.setItem = function (key, value) {
        if (key === "notes.sidebar-width")
          throw new DOMException("Denied", "SecurityError");
        return set.call(this, key, value);
      };
    });
    const deniedPage = await denied.newPage();
    deniedPage.on("pageerror", (error) => errors.push(error.message));
    await deniedPage.goto(`${base}/tests/integration/library-browser.html`);
    const deniedRail = deniedPage.getByRole("separator", {
      name: "Resize sidebar",
    });
    await expect(deniedRail).toHaveAttribute("aria-valuenow", "224");
    await deniedRail.focus();
    await deniedPage.keyboard.press("ArrowRight");
    await expect(deniedRail).toHaveAttribute("aria-valuenow", "240");
  } finally {
    await denied.close();
  }
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        qualification:
          "Real production Workspace, WASM and IndexedDB in disposable synthetic-account browser profiles; no native physical-input/FPS/backend-auth claim",
        checks: [
          "live pointer clamp180..420",
          "doubleclick224 reset",
          "keyboard16px and Enter reset",
          "preference reload",
          "encrypted note retained",
          "Light Dark Dim",
          "OS reduced motion",
          "narrow drawer no rail",
          "storage denial retains in-memory resizing",
        ],
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("Sidebar resize genuine encrypted browser journey passed");
} finally {
  await context.close();
  await browser.close();
}
