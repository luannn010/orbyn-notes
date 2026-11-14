import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const output = process.env.NOTES_UI_OUTPUT ?? "test-results/desktop-layout";
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5187";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 850 },
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await context.route(/\/src\/desktop\/window\.ts(?:\?|$)/, (route) =>
  route.fulfill({
    contentType: "application/javascript",
    body: `export const isDesktop = () => true;
    export async function connectWindow(onClose,onResize) {
      const state = window.__desktopPreview = {calls:[],failMinimize:false,maximized:false};
      return {minimize:async()=>{state.calls.push('minimize');if(state.failMinimize)throw Error('preview failure')},
        toggleMaximize:async()=>{state.calls.push('maximize');state.maximized=!state.maximized;onResize()},
        isMaximized:async()=>state.maximized,close:async()=>{state.calls.push('close');onClose(1)},
        startDragging:async()=>{state.calls.push('drag')},showSystemMenu:async()=>{state.calls.push('system-menu')},
        finishClose:async()=>{state.calls.push('finish-close')},dispose:()=>{state.calls.push('dispose')}};
    }`,
  }),
);
await context.route(
  /\/tests\/integration\/library-browser\.html\?desktop-shell/,
  async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text())
        .replace(
          '<div id="fixture-label">',
          '<div id="fixture-label" style="position:fixed;bottom:2px;left:2px;z-index:99;max-width:180px;font:9px sans-serif;pointer-events:none">Simulated native bridge; ',
        )
        .replace(
          "No account-server qualification.",
          "No native OS or account-server qualification.",
        ),
    });
  },
);
async function geometry(selector) {
  return page.locator(selector).evaluate((element) => {
    const r = element.getBoundingClientRect(),
      css = getComputedStyle(element);
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      bg: css.backgroundColor,
      border: css.borderTopWidth,
      radius: css.borderTopLeftRadius,
    };
  });
}
async function captions() {
  for (const name of ["Minimize window", "Maximize window", "Close window"]) {
    const button = page.getByRole("button", { name, exact: true });
    const r = await button.boundingBox();
    expect(Math.round(r.width)).toBe(46);
    expect(Math.round(r.height)).toBe(44);
    expect(Math.round(r.y)).toBe(0);
    await expect(button).toBeInViewport();
  }
}
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
  await expect(
    page.getByRole("heading", { name: "All notes", exact: true }),
  ).toBeVisible();
  const rail = page.getByRole("separator", { name: "Resize sidebar" });
  await expect(page.locator(".desktop-titlebar")).not.toContainText(
    "Orbyn Notes",
  );
  for (const theme of ["light", "dark", "dim"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    for (const width of [180, 224, 420]) {
      await rail.focus();
      await page.keyboard.press("Enter");
      if (width === 180)
        for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
      if (width === 420)
        for (let i = 0; i < 13; i++) await page.keyboard.press("ArrowRight");
      await expect(rail).toHaveAttribute("aria-valuenow", String(width));
      const title = await geometry(".desktop-titlebar"),
        sheet = await geometry(".sheet"),
        identity = await geometry(".identity"),
        scroll = await geometry(".desktop-sheet-content");
      expect(title.height).toBe(44);
      expect(title.bg).toBe("rgba(0, 0, 0, 0)");
      expect(sheet.y).toBe(0);
      expect(sheet.x).toBe(width);
      expect(sheet.border).toBe("0px");
      expect(sheet.radius).toBe("0px");
      expect(identity.y).toBe(56);
      expect(scroll.y).toBe(44);
      await captions();
      samples.push({ theme, width, title, sheet, identity, scroll });
      await page.screenshot({ path: `${output}/${theme}-${width}.png` });
    }
  }
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  expect((await geometry(".sheet")).x).toBe(0);
  await expect(rail).toHaveCount(0);
  await page.getByRole("button", { name: "Show sidebar" }).click();
  expect((await geometry(".sheet")).x).toBe(420);
  await rail.focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("button", { name: "New note", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Note title", { exact: true })
    .fill("Native layout retained note");
  await page
    .getByLabel("Note content", { exact: true })
    .fill("Retained encrypted writing\n".repeat(80));
  await expect(
    page.getByText("Saved in this browser", { exact: true }),
  ).toBeVisible();
  const editor = await page
    .getByLabel("Note content", { exact: true })
    .elementHandle();
  const portal = await page.locator(".desktop-editor-actions").elementHandle();
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await page.getByRole("button", { name: "Show sidebar" }).click();
  expect(
    await page
      .getByLabel("Note content", { exact: true })
      .evaluate((node, before) => node === before, editor),
  ).toBe(true);
  expect(
    await page
      .locator(".desktop-editor-actions")
      .evaluate((node, before) => node === before, portal),
  ).toBe(true);
  await page.locator(".desktop-sheet-content").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect((await geometry(".desktop-sheet-content")).y).toBe(44);
  await page.getByLabel("Note content", { exact: true }).focus();
  expect((await geometry(".desktop-sheet-content")).y).toBe(44);
  for (const width of [900, 899, 641, 640, 390]) {
    await page.setViewportSize({ width, height: 850 });
    if (width < 900) await expect(rail).toHaveCount(0);
    await captions();
    if (width > 640)
      await expect(
        page.locator(".desktop-editor-actions .note-links-toggle"),
      ).toBeVisible();
    const menu = page.getByRole("button", { name: "Note menu", exact: true });
    await menu.focus();
    await expect(menu).toBeInViewport();
    const menuBox = await menu.boundingBox(),
      cap = await page
        .getByRole("button", { name: "Minimize window" })
        .boundingBox();
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(cap.x + 1);
    await menu.click();
    await expect(
      page.getByRole("menuitem", { name: "Rename", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Rename", exact: true }),
    ).toBeInViewport();
    const popup = page.getByRole("menu", { name: "Note menu", exact: true });
    await popup.evaluate((element) =>
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
    await expect(popup).toHaveCSS("opacity", "1");
    await page.screenshot({ path: `${output}/editor-menu-${width}.png` });
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.getByRole("button", { name: "Minimize window" }).click();
  expect(
    await page.evaluate(() =>
      window.__desktopPreview.calls.includes("minimize"),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => window.__desktopPreview.calls.includes("drag")),
  ).toBe(false);
  await page.evaluate(() => {
    window.__desktopPreview.failMinimize = true;
  });
  await page.getByRole("button", { name: "Minimize window" }).click();
  await expect(
    page.getByText("Window controls aren’t available. Try again."),
  ).toBeVisible();
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  expect((await retry.boundingBox()).y).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: `${output}/error-notice.png` });
  await retry.click();
  await expect(page.getByLabel("Note title", { exact: true })).toHaveValue(
    "Native layout retained note",
  );
  await page.goto(
    `${base}/tests/integration/library-browser.html?desktop-shell=1&pane=account`,
  );
  await expect(page.locator(".account-card")).toBeVisible();
  await expect(page.locator(".desktop-shell")).toHaveAttribute(
    "data-layout",
    "single-pane",
  );
  await expect(page.getByRole("button", { name: /sidebar/ })).toHaveCount(0);
  expect((await geometry(".account-card")).y).toBeGreaterThanOrEqual(44);
  await captions();
  await page.screenshot({ path: `${output}/single-pane-account.png` });
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        qualification:
          "Production shell/Workspace with explicitly simulated native bridge and synthetic account; genuine WASM/IndexedDB. No native OS input, authentication or FPS qualification.",
        samples,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("Desktop layout browser checks passed");
} catch (error) {
  await page.screenshot({ path: `${output}/failed-state.png` });
  await writeFile(
    `${output}/failed-state.json`,
    JSON.stringify(
      await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        active: document.activeElement?.outerHTML,
        nodes: [
          ...document.querySelectorAll(
            ".desktop-titlebar,.desktop-editor-toolbar,.desktop-editor-actions,.menu-anchor,.desktop-caption-controls",
          ),
        ].map((element) => ({
          name: element.className,
          rect: element.getBoundingClientRect().toJSON(),
          scrollLeft: element.scrollLeft,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          overflow: getComputedStyle(element).overflow,
        })),
      })),
      null,
      2,
    ),
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
}
