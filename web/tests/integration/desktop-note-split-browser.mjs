// Isolated production-store fixture; the native window bridge is simulated.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5186";
const output = process.env.NOTES_UI_OUTPUT ?? "test-results/desktop-note-split";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.NOTES_BROWSER_CHANNEL ?? "msedge",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 850 },
});
await context.route(/\/src\/desktop\/window\.ts(?:\?|$)/, (route) =>
  route.fulfill({
    contentType: "application/javascript",
    body: `export const isDesktop = () => true;
  export async function connectWindow() { return {
    minimize:async()=>{},toggleMaximize:async()=>{},isMaximized:async()=>false,
    close:async()=>{},startDragging:async()=>{},showSystemMenu:async()=>{},
    finishClose:async()=>{},dispose:()=>{}
  }; }`,
  }),
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const samples = [];
try {
  await page.goto(
    `${base}/tests/integration/library-browser.html?desktop-shell=1`,
  );
  const setup = page.getByRole("dialog", { name: "Set up Orbyn Notes" });
  await expect(setup).toBeVisible();
  await setup.getByRole("button", { name: "Skip", exact: true }).click();
  await setup.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(setup).toHaveCount(0);
  for (const title of ["Split first note", "Split second note"]) {
    await page
      .getByRole("region", { name: "Notes list" })
      .getByRole("button", { name: "New note", exact: true })
      .first()
      .click();
    await page
      .getByRole("textbox", { name: "Note title", exact: true })
      .fill(title);
    await page
      .getByRole("textbox", { name: "Note content", exact: true })
      .fill(`Synthetic content for ${title}.`);
    await expect(
      page.getByText("Saved in this browser", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Back to notes", exact: false })
      .click();
  }
  const list = page.getByRole("region", { name: "Notes list" });
  await list.getByRole("button", { name: /^Split first note/ }).click();
  await expect(page.locator(".notes-workspace")).toHaveAttribute(
    "data-split",
    "true",
  );
  await expect(list).toBeVisible();
  await expect(
    list.getByRole("button", { name: /^Split first note/ }),
  ).toHaveAttribute("aria-current", "page");
  const editorNode = await page
    .getByRole("textbox", { name: "Note content", exact: true })
    .elementHandle();
  for (const theme of ["light", "dark", "dim"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await page.locator(".notes-workspace").evaluate((element) =>
      Promise.all(
        element
          .getAnimations({ subtree: true })
          .filter(
            (animation) =>
              animation.effect?.getTiming().iterations !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
    const geometry = await page
      .locator(".notes-workspace")
      .evaluate((element) => {
        const list = element
          .querySelector(".notes-library-pane")
          .getBoundingClientRect();
        const editor = element
          .querySelector(".note-actor-pool")
          .getBoundingClientRect();
        return {
          list: { x: list.x, width: list.width, height: list.height },
          editor: { x: editor.x, width: editor.width, height: editor.height },
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
    expect(geometry.list.width).toBe(300);
    expect(geometry.editor.x).toBe(geometry.list.x + 300);
    expect(geometry.editor.width).toBeGreaterThanOrEqual(480);
    expect(geometry.overflow).toBe(false);
    samples.push({ theme, ...geometry });
    await page.screenshot({ path: `${output}/${theme}-split.png` });
  }
  await page.setViewportSize({ width: 1005, height: 850 });
  await expect(page.locator(".notes-workspace")).toHaveAttribute(
    "data-split",
    "true",
  );
  const minimum = await page.locator(".note-actor-pool").boundingBox();
  expect(minimum.width).toBeGreaterThanOrEqual(480);
  expect(
    await page
      .locator(".note-actor-pool")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: `${output}/minimum-split.png` });
  await page.setViewportSize({ width: 1280, height: 850 });
  await page
    .getByRole("textbox", { name: "New tag", exact: true })
    .fill("retained tag draft");
  await list.getByRole("button", { name: /^Split second note/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toHaveValue("Split first note");
  await expect(
    page
      .getByRole("status")
      .filter({
        hasText: "Finish or discard your unsaved changes before leaving.",
      }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 850 });
  await expect(page.locator(".notes-workspace")).toHaveAttribute(
    "data-split",
    "false",
  );
  await expect(list).toBeHidden();
  await expect(
    page.getByRole("textbox", { name: "New tag", exact: true }),
  ).toHaveValue("retained tag draft");
  expect(
    await page
      .getByRole("textbox", { name: "Note content", exact: true })
      .evaluate((node, previous) => node === previous, editorNode),
  ).toBe(true);
  await page.screenshot({ path: `${output}/narrow-fallback.png` });
  await page.setViewportSize({ width: 1280, height: 850 });
  await expect(list).toBeVisible();
  await page.getByRole("textbox", { name: "New tag", exact: true }).fill("");
  await list.getByRole("button", { name: /^Split second note/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toHaveValue("Split second note");
  await expect(
    list.getByRole("button", { name: /^Split second note/ }),
  ).toHaveAttribute("aria-current", "page");
  await page
    .getByRole("button", { name: "Back to notes", exact: false })
    .click();
  await expect(page.locator(".notes-workspace")).toHaveAttribute(
    "data-split",
    "false",
  );
  await expect(list).toBeVisible();
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/measurements.json`,
    JSON.stringify({ samples, errors, passed: true }, null, 2),
  );
} finally {
  await context.close();
  await browser.close();
}
