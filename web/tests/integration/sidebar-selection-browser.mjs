import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const output = process.env.NOTES_UI_OUTPUT ?? "test-results/sidebar-selection";
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5187";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const [policy, os, moving] of [
    ["system", "no-preference", true],
    ["system", "reduce", false],
    ["on", "reduce", true],
    ["reduced", "no-preference", false],
  ]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 850 },
      reducedMotion: os,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.addInitScript(
      (policy) => localStorage.setItem("notes.motion", policy),
      policy,
    );
    await context.route(/\/src\/desktop\/window\.ts(?:\?|$)/, (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `export const isDesktop=()=>true; export async function connectWindow(){return{minimize:async()=>{},toggleMaximize:async()=>{},isMaximized:async()=>false,close:async()=>{},startDragging:async()=>{},showSystemMenu:async()=>{},finishClose:async()=>{},dispose:()=>{}}}`,
      }),
    );
    try {
      await page.goto(
        `${base}/tests/integration/library-browser.html?desktop-shell=1`,
      );
      const setup = page.getByRole("dialog", { name: "Set up Orbyn Notes" });
      await expect(setup).toBeVisible();
      await setup.getByRole("button", { name: "Skip", exact: true }).click();
      await setup.getByRole("button", { name: "Skip", exact: true }).click();
      const sidebar = page.getByLabel("Notes navigation", { exact: true });
      const layer = sidebar.locator(".sidebar-selection-highlight");
      const notes = sidebar.getByRole("button", {
        name: "All notes",
        exact: false,
      });
      const study = sidebar.getByRole("button", { name: "Study", exact: true });
      await expect(layer).toBeVisible();
      await expect(layer).toHaveAttribute("aria-hidden", "true");
      await expect(layer).toHaveCSS("pointer-events", "none");
      await expect(study).toHaveCSS("height", "29px");
      const rows = sidebar.locator("nav > .nav");
      const geometry = await rows.evaluateAll((elements) =>
        elements.map((element) => ({
          y: element.offsetTop,
          h: element.offsetHeight,
        })),
      );
      expect(geometry[1].y - geometry[0].y).toBe(30);
      for (const theme of ["light", "dark", "dim"]) {
        await page.evaluate(
          (theme) => (document.documentElement.dataset.theme = theme),
          theme,
        );
        await expect(layer).toHaveCSS("border-radius", "8px");
        await expect(study).toHaveCSS("transition-duration", /0.15s/);
      }
      await page.evaluate(
        () => (document.documentElement.dataset.theme = "light"),
      );
      const before = await layer.boundingBox();
      await layer.evaluate((element) => {
        window.__sidebarMotionSamples = [];
        window.__sidebarMotionDone = false;
        const start = performance.now();
        const sample = (now) => {
          window.__sidebarMotionSamples.push({
            t: now - start,
            y: element.getBoundingClientRect().y,
            animations: element.getAnimations().map((animation) => ({
              property: animation.transitionProperty,
              state: animation.playState,
            })),
          });
          if (now - start < 450) requestAnimationFrame(sample);
          else window.__sidebarMotionDone = true;
        };
        requestAnimationFrame(sample);
      });
      await study.click();
      await expect(
        page.getByRole("heading", { name: "Study", exact: true }),
      ).toBeVisible();
      await expect(layer).toHaveAttribute("data-animate", "true");
      const transition = await layer.evaluate((element) => ({
        duration: getComputedStyle(element).transitionDuration,
        easing: getComputedStyle(element).transitionTimingFunction,
      }));
      expect(transition.duration).toBe(moving ? "0.2s" : "0s");
      if (moving)
        expect(transition.easing).toBe("cubic-bezier(0.2, 0.8, 0.2, 1)");
      await expect
        .poll(async () => Math.round((await layer.boundingBox()).y))
        .toBe(Math.round((await study.boundingBox()).y));
      const after = await layer.boundingBox();
      expect(after.y - before.y).toBe(60);
      await page.waitForFunction(() => window.__sidebarMotionDone);
      const samples = await page.evaluate(() => window.__sidebarMotionSamples);
      const between = samples.filter(
        (sample) => sample.y > before.y + 0.1 && sample.y < after.y - 0.1,
      );
      const running = samples.some((sample) =>
        sample.animations.some(
          (animation) =>
            animation.property === "transform" && animation.state === "running",
        ),
      );
      expect(between.length > 0).toBe(moving);
      expect(running).toBe(moving);
      // Layout-only width changes settle; they never animate to a stale row.
      const rail = page.getByRole("separator", { name: "Resize sidebar" });
      await rail.focus();
      await page.keyboard.press("ArrowRight");
      await expect(layer).toHaveAttribute("data-animate", "false");
      expect(Math.round((await layer.boundingBox()).width)).toBe(
        Math.round((await study.boundingBox()).width),
      );
      await notes.click();
      await sidebar
        .getByRole("group", { name: "Account", exact: true })
        .getByRole("button", { name: "New note", exact: true })
        .click();
      await expect(
        page.getByLabel("Note title", { exact: true }),
      ).toBeVisible();
      await page
        .getByLabel("New tag", { exact: true })
        .fill("Unsaved navigation guard");
      const guardedPosition = await layer.getAttribute("style");
      await study.click();
      await expect(page.getByLabel("New tag", { exact: true })).toHaveValue(
        "Unsaved navigation guard",
      );
      await expect(study).not.toHaveClass(/active/);
      await expect(layer).toHaveAttribute("style", guardedPosition);
      await page.screenshot({ path: `${output}/${policy}-${os}.png` });
      expect(errors).toEqual([]);
      results.push({
        policy,
        os,
        moving,
        geometry,
        transition,
        samples,
        guardedNavigation: true,
        errors,
      });
    } finally {
      await context.close();
    }
  }
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        scope:
          "Synthetic account/native bridge; genuine WASM and IndexedDB. Geometry, motion policy and actual draft guard. No native FPS or account-server qualification.",
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
