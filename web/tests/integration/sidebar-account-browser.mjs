import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const output = process.env.NOTES_UI_OUTPUT ?? "test-results/sidebar-account";
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
    body: `
  export const isDesktop=()=>true;
  export async function connectWindow(){return{minimize:async()=>{},toggleMaximize:async()=>{},isMaximized:async()=>false,close:async()=>{},startDragging:async()=>{},showSystemMenu:async()=>{},finishClose:async()=>{},dispose:()=>{}}}
`,
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
const header = sidebar.getByRole("group", { name: "Account", exact: true });
const create = header.getByRole("button", { name: "New note", exact: true });
const measurements = [];
try {
  await page.goto(
    `${base}/tests/integration/library-browser.html?desktop-shell=1`,
  );
  const setup = page.getByRole("dialog", { name: "Set up Orbyn Notes" });
  await expect(setup).toBeVisible();
  await setup.getByRole("button", { name: "Skip", exact: true }).click();
  await setup.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(setup).toHaveCount(0);
  await expect(header).toContainText("isolated-library-fixture@example.test");
  await expect(header.locator(".sidebar-account-avatar")).toHaveText("I");
  await expect(
    sidebar.getByText("◉ Beta · Local only", { exact: true }),
  ).toBeVisible();
  for (const theme of ["light", "dark", "dim"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    for (const width of [180, 224, 420]) {
      const rail = page.getByRole("separator", { name: "Resize sidebar" });
      await rail.focus();
      await page.keyboard.press("Enter");
      if (width === 180)
        for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
      if (width === 420)
        for (let i = 0; i < 13; i++) await page.keyboard.press("ArrowRight");
      await expect(rail).toHaveAttribute("aria-valuenow", String(width));
      const avatar = header.locator(".sidebar-account-avatar");
      await expect(avatar).toHaveCSS("width", "24px");
      await expect(avatar).toHaveCSS("height", "24px");
      await expect(avatar).toHaveCSS("font-size", "10.5px");
      await expect(avatar).toHaveCSS("color", "rgb(11, 11, 11)");
      await expect(avatar).toHaveCSS(
        "background-color",
        theme === "light" ? "rgb(59, 130, 246)" : "rgb(96, 165, 250)",
      );
      await expect(create).toHaveCSS("width", "28px");
      await expect(create).toHaveCSS("height", "28px");
      await expect(create).toHaveCSS("border-radius", "8px");
      const box = await header.boundingBox();
      expect(box.y).toBe(56);
      expect(box.height).toBe(29);
      const fullEmail = header.getByTitle(
        "isolated-library-fixture@example.test",
      );
      await expect(fullEmail).toHaveText(
        "isolated-library-fixture@example.test",
      );
      if (width === 180)
        expect(
          await fullEmail.evaluate(
            (element) => element.scrollWidth > element.clientWidth,
          ),
        ).toBe(true);
      expect(
        await create.evaluate((element) => {
          const r = element.getBoundingClientRect(),
            hit = document.elementFromPoint(
              r.x + r.width / 2,
              r.y + r.height / 2,
            );
          return element === hit || element.contains(hit);
        }),
      ).toBe(true);
      measurements.push({ theme, width, header: box });
      await page.screenshot({ path: `${output}/${theme}-${width}.png` });
    }
  }
  await sidebar.getByRole("button", { name: "Study", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Study", exact: true }),
  ).toBeVisible();
  await create.click();
  await expect(page.getByLabel("Note title", { exact: true })).toBeVisible();
  await expect(
    page.getByText("From a Study card.", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Note title", { exact: true })
    .fill("Account header encrypted note");
  await page
    .getByLabel("Note content", { exact: true })
    .fill("Created through the real account header action.");
  await expect(
    page.getByText("Saved in this browser", { exact: true }),
  ).toBeVisible();
  // A genuine unsaved tag draft refuses the global action and is never auto-replayed.
  await page
    .getByLabel("New tag", { exact: true })
    .fill("Retained unsaved tag");
  await create.click();
  await expect(
    page.getByRole("status").filter({
      hasText: "Finish or discard your unsaved changes before leaving.",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Note title", { exact: true })).toHaveValue(
    "Account header encrypted note",
  );
  await expect(page.getByLabel("New tag", { exact: true })).toHaveValue(
    "Retained unsaved tag",
  );
  await expect(
    sidebar.getByRole("button", { name: "All notes 1", exact: true }),
  ).toBeVisible();
  await page.getByLabel("New tag", { exact: true }).fill("");
  await page.reload();
  await page
    .getByRole("button", { name: /Account header encrypted note/ })
    .first()
    .click();
  await expect(page.getByLabel("Note content", { exact: true })).toContainText(
    "Created through the real account header action.",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 640, height: 850 });
  await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Notes navigation" }),
  ).toBeVisible();
  await expect(create).toBeInViewport();
  await page.screenshot({ path: `${output}/narrow-account-reduced.png` });
  await create.click();
  await expect(
    page.getByRole("dialog", { name: "Notes navigation" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Note title", { exact: true })).toHaveValue("");
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        qualification:
          "Genuine Workspace/WASM/IndexedDB in disposable synthetic account; explicitly simulated native bridge, no native OS/FPS/auth qualification",
        measurements,
        checks: [
          "real account identity",
          "exact geometry and palette",
          "minimum width email truncation/full accessible text",
          "create from Study goes to Notes",
          "genuine dirty tag draft refuses creation without automatic replay",
          "encrypted save/reload",
          "narrow drawer create closes drawer",
          "reduced motion reachable controls",
        ],
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("Account header genuine browser checks passed");
} catch (error) {
  await page.screenshot({ path: `${output}/failed-state.png` });
  throw error;
} finally {
  await context.close();
  await browser.close();
}
