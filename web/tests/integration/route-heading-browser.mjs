import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5187";
const output = process.env.NOTES_UI_OUTPUT ?? "test-results/route-heading";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const runs = [];
try {
  for (const [policy, os] of [
    ["system", "no-preference"],
    ["system", "reduce"],
    ["on", "reduce"],
    ["reduced", "no-preference"],
  ]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 850 },
      reducedMotion: os,
    });
    const page = await context.newPage(),
      errors = [],
      checks = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.addInitScript((policy) => {
      localStorage.setItem("notes.motion", policy);
      localStorage.setItem("notes.theme", "light");
      window.__headingEvents = [];
      document.addEventListener(
        "animationstart",
        (event) => {
          if (
            event.animationName === "route-heading-in" ||
            event.animationName === "study-fade"
          ) {
            const style = getComputedStyle(event.target);
            window.__headingEvents.push({
              name: event.animationName,
              target: event.target.tagName,
              text:
                event.target.tagName === "H1" ? event.target.textContent : null,
              duration: style.animationDuration,
              easing: style.animationTimingFunction,
            });
          }
        },
        true,
      );
    }, policy);
    await context.route(/\/src\/desktop\/window\.ts(?:\?|$)/, (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `export const isDesktop=()=>true; export async function connectWindow(){return{minimize:async()=>{},toggleMaximize:async()=>{},isMaximized:async()=>false,close:async()=>{},startDragging:async()=>{},showSystemMenu:async()=>{},finishClose:async()=>{},dispose:()=>{}}}`,
      }),
    );
    const sidebar = page.getByLabel("Notes navigation", { exact: true });
    async function navigate(label, title) {
      const heading = page.getByRole("heading", { name: title, exact: true });
      const button = sidebar.getByRole("button", { name: label, exact: true });
      if (!(await button.isVisible()))
        await page
          .getByRole("button", { name: "Show sidebar", exact: true })
          .click();
      const start = await page.evaluate(() => window.__headingEvents.length);
      await page.evaluate((title) => {
        window.__headingSamples = [];
        window.__headingSamplingDone = false;
        let foundAt = null;
        const start = performance.now();
        function sample(now) {
          const node = [...document.querySelectorAll("h1")].find(
            (element) =>
              element.textContent === title && element.getClientRects().length,
          );
          if (node) {
            foundAt ??= now;
            let opacity = 1;
            const animations = [];
            for (let actor = node; actor; actor = actor.parentElement) {
              opacity *= Number(getComputedStyle(actor).opacity);
              animations.push(
                ...actor.getAnimations().map((animation) => ({
                  name: animation.animationName,
                  state: animation.playState,
                  timing: animation.effect.getTiming(),
                  keyframeEasings: animation.effect
                    .getKeyframes()
                    .map((frame) => frame.easing),
                })),
              );
            }
            window.__headingSamples.push({
              t: now - start,
              opacity,
              transform: getComputedStyle(node).transform,
              animations,
            });
          }
          if (
            (foundAt === null && now - start < 5000) ||
            (foundAt !== null && now - foundAt < 350)
          )
            requestAnimationFrame(sample);
          else window.__headingSamplingDone = true;
        }
        requestAnimationFrame(sample);
      }, title);
      await button.click();
      await expect(heading).toBeVisible();
      await page.waitForFunction(() => window.__headingSamplingDone);
      const samples = await page.evaluate(() => window.__headingSamples);
      expect(
        samples.some(
          (sample) => sample.opacity > 0.01 && sample.opacity < 0.99,
        ),
      ).toBe(true);
      expect(samples.at(-1).opacity).toBe(1);
      expect(samples.every((sample) => sample.transform === "none")).toBe(true);
      const animations = samples
        .flatMap((sample) => sample.animations)
        .filter(
          (animation) =>
            animation.name === "route-heading-in" ||
            animation.name === "study-fade",
        );
      expect(animations.length).toBeGreaterThan(0);
      for (const animation of animations) {
        expect(animation.timing.duration).toBe(150);
        expect(animation.timing.delay).toBe(0);
        // CSS animations place their curve on the keyframes; overall WAAPI timing is linear.
        expect(animation.keyframeEasings[0]).toBe(
          "cubic-bezier(0.2, 0.8, 0.2, 1)",
        );
      }
      const events = await page.evaluate(
        (start) => window.__headingEvents.slice(start),
        start,
      );
      expect(
        events.filter((event) => event.name === "route-heading-in").length,
      ).toBeLessThanOrEqual(1);
      checks.push({ label: String(label), title, events, samples });
      return heading;
    }
    try {
      await page.goto(
        `${base}/tests/integration/library-browser.html?desktop-shell=1`,
      );
      const setup = page.getByRole("dialog", { name: "Set up Orbyn Notes" });
      await setup.getByRole("button", { name: "Skip", exact: true }).click();
      await setup.getByRole("button", { name: "Skip", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "All notes", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() =>
          window.__headingEvents.filter(
            (event) => event.name === "route-heading-in",
          ),
        ),
      ).toEqual([]);
      const initialHeading = await page
        .getByRole("heading", { name: "All notes", exact: true })
        .elementHandle();
      await navigate(/^Trash/, "Trash");
      expect(
        await page
          .getByRole("heading", { name: "Trash", exact: true })
          .evaluate((node, original) => node === original, initialHeading),
      ).toBe(true);
      const beforeSame = await page.evaluate(
        () => window.__headingEvents.length,
      );
      await sidebar.getByRole("button", { name: /^Trash/ }).click();
      await expect
        .poll(() => page.evaluate(() => window.__headingEvents.length))
        .toBe(beforeSame);
      await navigate(/^Pinned/, "Pinned");
      await navigate("Linked", "Linked");
      await navigate("Manage tags", "Tags");
      await navigate("Study", "Study");
      await navigate("Clips", "Clips");
      await navigate("Journal", "Set a Journal passphrase");
      const beforeUnlock = await page.evaluate(
        () =>
          window.__headingEvents.filter(
            (event) => event.name === "route-heading-in",
          ).length,
      );
      const phrase = "Synthetic route heading verification phrase";
      await page.getByLabel("Passphrase", { exact: true }).fill(phrase);
      await page.getByLabel("Confirm passphrase", { exact: true }).fill(phrase);
      await page
        .getByRole("button", { name: "Lock Journal", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Journal", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            window.__headingEvents.filter(
              (event) => event.name === "route-heading-in",
            ).length,
        ),
      ).toBe(beforeUnlock);
      await navigate(/^All notes/, "All notes");
      await expect(
        page.getByRole("textbox", { name: "Journal entry", exact: true }),
      ).toHaveCount(0);
      await navigate("Journal", "Journal is locked");
      for (const theme of ["dark", "dim"]) {
        await page.evaluate(
          (theme) => (document.documentElement.dataset.theme = theme),
          theme,
        );
        await navigate(/^All notes/, "All notes");
        await navigate(/^Trash/, "Trash");
        await page.screenshot({
          path: `${output}/${policy}-${os}-${theme}.png`,
        });
      }
      await page.setViewportSize({ width: 640, height: 850 });
      await navigate(/^All notes/, "All notes");
      await expect(
        page.getByRole("dialog", { name: "Notes navigation" }),
      ).toHaveCount(0);
      expect(errors).toEqual([]);
      runs.push({
        policy,
        os,
        checks,
        initialStatic: true,
        sameNode: true,
        sameRowStatic: true,
        journalUnlockDoesNotReplay: true,
        errors,
      });
    } catch (error) {
      await page.screenshot({ path: `${output}/${policy}-${os}-failure.png` });
      throw error;
    } finally {
      await context.close();
    }
  }
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        scope:
          "Disposable synthetic identity/native bridge; genuine WASM/IndexedDB and Journal vault. Actual heading opacity and route integration. No native/account-server/FPS qualification.",
        runs,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
