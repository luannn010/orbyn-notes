import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const output = process.env.NOTES_UI_OUTPUT ?? "test-results/library-toolbar";
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5187";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 850 },
});
const page = await context.newPage(),
  errors = [],
  measurements = [];
page.on("pageerror", (error) => errors.push(error.message));
await context.route(/\/src\/desktop\/window\.ts(?:\?|$)/, (route) =>
  route.fulfill({
    contentType: "application/javascript",
    body: `export const isDesktop=()=>true; export async function connectWindow(){return{minimize:async()=>{},toggleMaximize:async()=>{},isMaximized:async()=>false,close:async()=>{},startDragging:async()=>{},showSystemMenu:async()=>{},finishClose:async()=>{},dispose:()=>{}}}`,
  }),
);
await context.route(
  /\/tests\/integration\/library-browser\.html\?desktop-shell/,
  async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        '<div id="fixture-label">',
        '<div id="fixture-label" style="position:fixed;bottom:2px;left:2px;z-index:99;max-width:180px;font:9px sans-serif;pointer-events:none">Simulated native bridge; ',
      ),
    });
  },
);
const sidebar = page.getByLabel("Notes navigation", { exact: true });
const header = page.locator(".notes-library-heading");
const toolbar = header.locator(".notes-library-toolbar");
async function sidebarWidth(value) {
  const rail = page.getByRole("separator", { name: "Resize sidebar" });
  await rail.focus();
  await page.keyboard.press("Enter");
  if (value === 180)
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  if (value === 420)
    for (let i = 0; i < 13; i++) await page.keyboard.press("ArrowRight");
  await expect(rail).toHaveAttribute("aria-valuenow", String(value));
}
async function geometry(id) {
  const colors = await page.evaluate(() => {
    const probe = document.createElement("i");
    probe.style.display = "none";
    document.body.append(probe);
    const result = {};
    for (const token of ["t1", "t2", "t3", "btnt", "btn", "red"]) {
      probe.style.color = `var(--${token})`;
      result[token] = getComputedStyle(probe).color;
    }
    probe.remove();
    return result;
  });
  await expect(
    toolbar.getByRole("button", { name: "Import Markdown", exact: true }),
  ).toHaveCSS("color", colors.t2);
  await expect(
    toolbar.getByRole("button", { name: "New note", exact: true }),
  ).toHaveCSS("color", colors.btnt);
  await expect(
    toolbar.getByRole("button", { name: "New note", exact: true }),
  ).toHaveCSS("background-color", colors.btn);
  await expect(
    toolbar.getByRole("button", { name: "New note", exact: true }),
  ).toHaveCSS("height", "30px");
  await expect(
    toolbar.getByRole("button", { name: "Import Markdown", exact: true }),
  ).toHaveCSS("height", "30px");
  await expect(toolbar.getByRole("combobox", { name: "Sort notes" })).toHaveCSS(
    "height",
    "28px",
  );
  await expect(
    toolbar.getByRole("group", { name: "View", exact: true }),
  ).toHaveCSS("height", "28px");
  for (const name of ["List view", "Grid view"])
    await expect(toolbar.getByRole("button", { name, exact: true })).toHaveCSS(
      "height",
      "24px",
    );
  await expect(toolbar).toHaveCSS("align-items", "center");
  await expect(toolbar).toHaveCSS("gap", "6px");
  await expect(header).toHaveCSS("padding-bottom", "6px");
  await expect(header.locator("h1")).toHaveCSS("font-size", "22px");
  await expect(header.locator("h1")).toHaveCSS("margin-bottom", "0px");
  await expect(header.locator(".notes-library-count")).toHaveCSS(
    "font-size",
    "13px",
  );
  const report = await header.evaluate((root) => {
    const rect = (element) => {
      const r = element.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        right: r.right,
        bottom: r.bottom,
      };
    };
    const controls = [...root.querySelectorAll("button,select")].map(
      (element) => ({
        label: element.getAttribute("aria-label") || element.textContent.trim(),
        rect: rect(element),
      }),
    );
    return {
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      root: rect(root),
      titleText: root.querySelector("h1").textContent,
      title: rect(root.querySelector("h1")),
      count: rect(root.querySelector(".notes-library-count")),
      controls,
    };
  });
  expect(report.documentWidth).toBeLessThanOrEqual(report.viewport);
  if (report.titleText === "All notes") {
    expect(report.count.x - report.title.right).toBeCloseTo(12, 1);
  }
  if (id.endsWith("-1280-224")) {
    expect(report.root.height - report.title.height).toBeCloseTo(28, 1);
  }
  for (const control of report.controls) {
    expect(control.rect.x).toBeGreaterThanOrEqual(report.root.x);
    expect(control.rect.right).toBeLessThanOrEqual(report.root.right + 0.1);
    expect(control.rect.y).toBeGreaterThanOrEqual(44);
    expect(control.rect.bottom).toBeLessThanOrEqual(report.root.bottom + 0.1);
  }
  const choices = report.controls.filter((control) =>
    ["List view", "Grid view"].includes(control.label),
  );
  expect(choices.every((control) => control.rect.height === 24)).toBe(true);
  measurements.push({ id, colors, ...report });
  return report;
}
try {
  await page.goto(
    `${base}/tests/integration/library-browser.html?desktop-shell=1`,
  );
  const setup = page.getByRole("dialog", { name: "Set up Orbyn Notes" });
  await setup.getByRole("button", { name: "Skip", exact: true }).click();
  await setup.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(
    header.getByRole("heading", { name: "All notes", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  for (const theme of ["light", "dark", "dim"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    for (const viewport of [1280, 900]) {
      await page.setViewportSize({ width: viewport, height: 850 });
      for (const width of [180, 224, 420]) {
        await sidebarWidth(width);
        const report = await geometry(`${theme}-${viewport}-${width}`);
        if (viewport === 1280 && width === 224) {
          expect(report.count.y + report.count.height).toBeLessThan(
            report.title.bottom + 2,
          );
          expect(report.count.x).toBeGreaterThan(
            report.title.x + report.title.width,
          );
        }
        await page.screenshot({
          path: `${output}/${theme}-${viewport}-${width}.png`,
        });
      }
    }
    for (const viewport of [899, 640, 390]) {
      await page.setViewportSize({ width: viewport, height: 850 });
      await geometry(`${theme}-${viewport}-drawer`);
      await page.screenshot({ path: `${output}/${theme}-${viewport}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 850 });
  await sidebarWidth(224);
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  const grid = toolbar.getByRole("button", { name: "Grid view", exact: true });
  await grid.focus();
  expect(
    await grid.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe("solid");
  expect(
    await grid.evaluate((element) => getComputedStyle(element).outlineWidth),
  ).toBe("2px");
  await toolbar.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByLabel("Note title", { exact: true }).fill("Toolbar Zulu");
  await page
    .getByLabel("Note content", { exact: true })
    .fill("Genuine encrypted toolbar note.");
  await expect(
    page.getByText("Saved in this browser", { exact: true }),
  ).toBeVisible();
  const longTag =
    "Averylongunbrokentagheadingthatmustremainreachableatnarrowwidth";
  await page.getByLabel("New tag", { exact: true }).fill(longTag);
  await page.getByRole("button", { name: "Add tag", exact: true }).click();
  await expect(
    page.getByText("Saved in this browser", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "← Back to notes", exact: true })
    .click();
  await grid.click();
  await expect(page.locator(".note-collection")).toHaveClass(/grid/);
  await expect(grid).toHaveAttribute("aria-pressed", "true");
  await toolbar.getByRole("button", { name: "List view", exact: true }).click();
  await expect(page.locator(".note-collection")).not.toHaveClass(/grid/);
  const chooserEvent = page.waitForEvent("filechooser");
  await toolbar
    .getByRole("button", { name: "Import Markdown", exact: true })
    .click();
  await (
    await chooserEvent
  ).setFiles({
    name: "toolbar-alpha.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# Toolbar Alpha\n\nReal Markdown imported through the unchanged toolbar action.",
    ),
  });
  const imports = page.getByRole("dialog", {
    name: "Import Markdown",
    exact: true,
  });
  await expect(imports).toContainText("1 files ready");
  await imports.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".note-row")).toHaveCount(1);
  const retryChooser = page.waitForEvent("filechooser");
  await toolbar
    .getByRole("button", { name: "Import Markdown", exact: true })
    .click();
  await (
    await retryChooser
  ).setFiles({
    name: "toolbar-alpha.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# Toolbar Alpha\n\nReal Markdown imported through the unchanged toolbar action.",
    ),
  });
  await imports
    .getByRole("button", { name: "Import remaining", exact: true })
    .click();
  await expect(imports).toHaveCount(0);
  await expect(page.locator(".note-row")).toHaveCount(2);
  await toolbar
    .getByRole("combobox", { name: "Sort notes" })
    .selectOption("title");
  await expect(page.locator(".note-row").first()).toContainText(
    "Toolbar Alpha",
  );
  await page.reload();
  await expect(
    toolbar.getByRole("combobox", { name: "Sort notes" }),
  ).toHaveValue("title");
  await expect(page.locator(".note-row")).toHaveCount(2);
  const original = await header.locator("h1").elementHandle();
  await sidebar
    .getByRole("button", { name: `${longTag}, 1 note`, exact: true })
    .click();
  await expect(header.locator("h1")).toHaveText(`# ${longTag}`);
  expect(
    await header
      .locator("h1")
      .evaluate((element, original) => element === original, original),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 850 });
  await geometry("long-filter-390");
  await page.screenshot({ path: `${output}/long-filter-390.png` });
  await page.setViewportSize({ width: 1280, height: 850 });
  await sidebar.getByRole("button", { name: /^Trash/ }).click();
  await expect(
    header.getByRole("button", { name: "Empty Trash", exact: true }),
  ).toBeDisabled();
  await expect(
    header.getByRole("button", { name: "Empty Trash", exact: true }),
  ).toHaveCSS("height", "30px");
  await expect(
    header.getByRole("group", { name: "View", exact: true }),
  ).toHaveCount(0);
  await sidebar.getByRole("button", { name: "Clips", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Clips", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".clips-view .page-heading")
      .getByRole("button", { name: "Save a link", exact: true }),
  ).toHaveCSS("height", "32px");
  await sidebar
    .getByRole("button", { name: "Manage tags", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "New tag", exact: true }),
  ).toHaveCSS("height", "32px");
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        scope:
          "Synthetic account and simulated native bridge; genuine WASM/IndexedDB, no backend/native/FPS qualification.",
        measurements,
        checks: [
          "27 theme/viewport/sidebar geometry cases plus long tag",
          "keyboard focus ring",
          "same h1 node",
          "actual list/grid",
          "Markdown picker cancel and successful import",
          "persisted CAS sort/reload",
          "disabled empty Trash",
          "Clips/Tags control isolation",
        ],
        errors,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await page.screenshot({ path: `${output}/failed-state.png` });
  throw error;
} finally {
  await context.close();
  await browser.close();
}
