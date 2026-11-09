import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const output =
  process.env.NOTES_UI_OUTPUT ??
  fileURLToPath(
    new URL("../../test-results/ui-qualification/", import.meta.url),
  );
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  headless: true,
});
const results = {
  fixture: true,
  source:
    "UI beta-ui/tests/ui/preview.html; in-memory synthetic notes, no encryption/account claim",
  checks: [],
  profiles: [],
};
const observer = () => {
  window.__shifts = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      window.__shifts.push({
        startTime: entry.startTime,
        value: entry.value,
        hadRecentInput: entry.hadRecentInput,
        sources: entry.sources?.map((source) => ({
          tag: source.node?.nodeName,
          class: source.node?.className,
          previous: source.previousRect.toJSON(),
          current: source.currentRect.toJSON(),
        })),
      });
  }).observe({ type: "layout-shift", buffered: true });
};
try {
  for (const width of [1160, 900, 899, 390])
    for (const theme of ["light", "dark", "dim"]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 700 },
        reducedMotion: "reduce",
      });
      await context.addInitScript((theme) => {
        localStorage.setItem("notes.theme", theme);
        localStorage.setItem("notes.motion", "reduced");
      }, theme);
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:5177/tests/ui/preview.html");
      await expect(page.locator(".note-row")).toHaveCount(2);
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        theme: document.documentElement.dataset.theme,
        bg: getComputedStyle(document.documentElement)
          .getPropertyValue("--bg")
          .trim(),
        sidebar: document.querySelector(".sidebar").getBoundingClientRect()
          .width,
      }));
      expect(geometry.scrollWidth).toBeLessThanOrEqual(width);
      expect(geometry.theme).toBe(theme);
      await page.screenshot({
        path: `${output}/library-${width}-${theme}.png`,
      });
      if (width < 900) {
        await page.getByRole("button", { name: "Open navigation" }).click();
        await expect(page.getByLabel("Search notes")).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(
          page.getByRole("button", { name: "Settings", exact: true }),
        ).toBeFocused();
        await page.keyboard.press("Escape");
        results.checks.push({
          width,
          theme,
          drawerEscapeReturnsFocus: await page
            .getByRole("button", { name: "Open navigation" })
            .evaluate((el) => document.activeElement === el),
        });
        await expect(
          page.getByRole("button", { name: "Open navigation" }),
        ).toBeFocused();
      }
      await page
        .getByRole("button", { name: /A quiet place to think A synthetic/ })
        .click();
      await expect(
        page.getByRole("textbox", { name: "Note content", exact: true }),
      ).toBeVisible();
      const motion = await page
        .locator(".editor-pane")
        .evaluate((el) => getComputedStyle(el).animationName);
      expect(motion).toBe("none");
      await page
        .getByRole("textbox", { name: "Note title", exact: true })
        .focus();
      await page.keyboard.press("Control+A");
      await page.keyboard.type("Keyboard-edited synthetic note");
      await expect(
        page.getByText("Saved in this browser", { exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: `${output}/editor-${width}-${theme}.png` });
      await page.getByRole("button", { name: /Back to notes/ }).click();
      if (width < 900)
        await page.getByRole("button", { name: "Open navigation" }).click();
      await page
        .getByLabel("Search notes", { exact: true })
        .fill("Keyboard-edited");
      if (width < 900) await page.keyboard.press("Escape");
      await expect(page.locator(".note-row")).toHaveCount(1);
      results.checks.push({
        width,
        theme,
        geometry,
        reducedMotion: motion,
        keyboardEditSearch: true,
        drawerFocusAndEscape: width < 900 ? "passed" : "not applicable",
      });
      await context.close();
    }
  for (const delayFonts of [false, true]) {
    const context = await browser.newContext({
      viewport: { width: 1160, height: 700 },
    });
    await context.addInitScript(observer);
    if (delayFonts)
      await context.route(/\.(woff2?|ttf)(\?|$)/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.continue();
      });
    const page = await context.newPage();
    for (const phase of ["cold", "warm"]) {
      if (phase === "cold")
        await page.goto(
          "http://127.0.0.1:5177/tests/ui/preview.html?count=1000",
        );
      else await page.reload();
      await expect(page.locator(".note-row")).toHaveCount(1000);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `${output}/profile-${delayFonts ? "font-delayed" : "normal"}-${phase}.png`,
      });
      const shifts = await page.evaluate(() => window.__shifts);
      results.profiles.push({
        phase,
        delayFonts,
        cls: shifts
          .filter((s) => !s.hadRecentInput)
          .reduce((sum, s) => sum + s.value, 0),
        shifts,
      });
    }
    await context.close();
  }
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(
  JSON.stringify(
    {
      checks: results.checks.length,
      profiles: results.profiles.map(({ phase, delayFonts, cls }) => ({
        phase,
        delayFonts,
        cls,
      })),
      output,
    },
    null,
    2,
  ),
);
