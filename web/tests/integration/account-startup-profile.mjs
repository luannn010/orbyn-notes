import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const output =
  process.env.NOTES_UI_OUTPUT ?? "test-results/account-startup-profile";
const targets = [
  {
    name: "baseline",
    url: process.env.NOTES_BASELINE_URL ?? "http://127.0.0.1:5184/",
  },
  {
    name: "candidate",
    url: process.env.NOTES_CANDIDATE_URL ?? "http://127.0.0.1:5185/",
  },
];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const samples = [];
try {
  // Fixed alternating order before observing results; no retry-until-green.
  for (let pair = 0; pair < 10; pair++) {
    const ordered = pair % 2 ? [...targets].reverse() : targets;
    for (const target of ordered) {
      const context = await browser.newContext({
        viewport: { width: 1160, height: 850 },
        serviceWorkers: "block",
      });
      await context.addInitScript(() => {
        window.__accountStartupProbe = { lcp: null, cls: 0 };
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            window.__accountStartupProbe.lcp = entry.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            if (!entry.hadRecentInput)
              window.__accountStartupProbe.cls += entry.value;
        }).observe({ type: "layout-shift", buffered: true });
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.goto(target.url);
        await expect(page.locator(".account-card h1")).toBeVisible();
        const readyMs = await page.evaluate(() => performance.now());
        await page.locator(".account-page").evaluate(async (element) => {
          await document.fonts.ready;
          await Promise.all(
            element
              .getAnimations({ subtree: true })
              .filter(
                (animation) =>
                  animation.effect?.getTiming().iterations !== Infinity,
              )
              .map((animation) => animation.finished.catch(() => {})),
          );
          for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
        });
        const sample = await page.evaluate(() => window.__accountStartupProbe);
        expect(sample.lcp).not.toBe(null);
        expect(sample.lcp).toBeLessThan(2500);
        expect(sample.cls).toBe(0);
        expect(errors).toEqual([]);
        samples.push({
          pair,
          target: target.name,
          lcpMs: sample.lcp,
          cls: sample.cls,
          accountReadyMs: +readyMs.toFixed(2),
        });
      } finally {
        await context.close();
      }
    }
  }
  const median = (values) => {
    const ordered = [...values].sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    return (ordered[middle - 1] + ordered[middle]) / 2;
  };
  const baselineMedian = median(
    samples
      .filter((sample) => sample.target === "baseline")
      .map((sample) => sample.lcpMs),
  );
  const candidateMedian = median(
    samples
      .filter((sample) => sample.target === "candidate")
      .map((sample) => sample.lcpMs),
  );
  const result = {
    qualified:
      "Production static account-entry startup only, empty disposable browser profiles; blocked service workers, no authentication/backend operation, no native/signed-in/Search/animation acceptance claim",
    browser: browser.version(),
    samples,
    baselineMedianLcpMs: baselineMedian,
    candidateMedianLcpMs: candidateMedian,
    medianDifferenceMs: candidateMedian - baselineMedian,
    target2500msAndZeroClsPassed: true,
    comparison:
      "Fixed10alternating pairs; raw timing variation retained, no strict no-regression conclusion from noisy samples alone",
  };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      baselineMedian,
      candidateMedian,
      samples: samples.length,
      target2500msAndZeroClsPassed: true,
    }),
  );
} catch (error) {
  await writeFile(`${output}/failure.txt`, String(error));
  throw error;
} finally {
  await browser.close();
}
