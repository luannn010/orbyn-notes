import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const output = process.env.NOTES_UI_OUTPUT ?? "test-results/search-profile";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1160, height: 850 },
  reducedMotion: "no-preference",
});
await context.addInitScript(() => {
  window.__searchProbe = { shifts: [], longTasks: [] };
  for (const type of ["layout-shift", "longtask"]) {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (type === "layout-shift")
          window.__searchProbe.shifts.push({
            time: entry.startTime,
            value: entry.value,
            hadRecentInput: entry.hadRecentInput,
          });
        else
          window.__searchProbe.longTasks.push({
            time: entry.startTime,
            duration: entry.duration,
          });
      }
    }).observe({ type, buffered: true });
  }
});
const page = await context.newPage(),
  errors = [],
  samples = [];
const profiler =
  process.env.NOTES_PROFILE_CPU === "1"
    ? await context.newCDPSession(page)
    : null;
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(
    `${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179"}/tests/integration/search-browser.html`,
  );
  await page.waitForFunction(
    () =>
      !!window.__searchFixture ||
      document.getElementById("root")?.dataset.fixtureFailed === "true",
  );
  if (await page.locator("#root").getAttribute("data-fixture-failed"))
    throw new Error(await page.locator("#root").innerText());
  await expect(
    page.getByRole("heading", { name: "All notes", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { checkClose } = await import("/src/desktop/closeGuard.ts");
        return checkClose();
      }),
    )
    .toBe("allowed");
  await page
    .getByRole("button", { name: "Search notes, clips and cards", exact: true })
    .click();
  const input = page.getByRole("textbox", {
    name: "Search notes, clips and cards",
    exact: true,
  });
  await expect(input).toBeVisible();
  if (profiler) {
    await profiler.send("Profiler.enable");
    await profiler.send("Profiler.start");
  }
  for (const [query, count] of [
    ["lisbon", 69],
    ["strasse", 2],
    ["private-journal-sentinel", 0],
    ["<script>", 1],
    ["lisbon", 69],
  ]) {
    await input.fill(query);
    const started = await page.evaluate(() => performance.now());
    await input.press("Enter");
    await expect(page.locator(".search-heading p")).toContainText(
      `${count} ${count === 1 ? "result" : "results"}`,
    );
    if (count)
      await expect(page.locator(".search-heading p")).toContainText(
        `“${query}”`,
      );
    else
      await expect(
        page.getByRole("heading", {
          name: `No results for “${query}”`,
          exact: true,
        }),
      ).toBeVisible();
    const ready = await page.evaluate(() => performance.now());
    await page.locator(".unified-search").evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .filter(
            (animation) =>
              animation.effect?.getTiming().iterations !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => {})),
      );
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    samples.push(
      await page.evaluate(
        ({ query, count, started, ready }) => ({
          query,
          count,
          readyMs: +(ready - started).toFixed(2),
          settledMs: +(performance.now() - started).toFixed(2),
          unexpectedCLS: window.__searchProbe.shifts
            .filter((entry) => entry.time >= started && !entry.hadRecentInput)
            .reduce((sum, entry) => sum + entry.value, 0),
          allInteractionShift: window.__searchProbe.shifts
            .filter((entry) => entry.time >= started)
            .reduce((sum, entry) => sum + entry.value, 0),
          longTasks: window.__searchProbe.longTasks.filter(
            (entry) => entry.time >= started,
          ),
          renderedResultRows: document.querySelectorAll(
            ".unified-search .search-result",
          ).length,
        }),
        { query, count, started, ready },
      ),
    );
    expect(await page.locator(".unified-search script").count()).toBe(0);
  }
  await expect(
    page
      .getByRole("region", { name: "Notes results", exact: true })
      .locator(".search-result"),
  ).toHaveCount(50);
  await page
    .getByRole("button", { name: "Next Notes results", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Notes results", exact: true })
      .locator(".search-result"),
  ).toHaveCount(12);
  await expect(page.locator(".search-heading p")).toContainText("69 results");
  const focusAfterPaging = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    label: document.activeElement?.getAttribute("aria-label"),
  }));
  if (profiler) {
    const { profile } = await profiler.send("Profiler.stop");
    await writeFile(`${output}/cpu-profile.json`, JSON.stringify(profile));
  }
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        qualified:
          "Developer-server Chrome headless interaction samples on genuine encrypted synthetic mixed corpus; no production baseline/LCP/native/60fps acceptance claim",
        browser: browser.version(),
        samples,
        boundedCurrentNotesPage: "50 then12; total69 retained",
        focusAfterPaging,
        escapedHtmlLookingContent: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Search developer interaction profile passed: " +
      JSON.stringify(
        samples.map(({ query, readyMs, unexpectedCLS }) => ({
          query,
          readyMs,
          unexpectedCLS,
        })),
      ),
  );
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  await writeFile(`${output}/failure.txt`, String(error));
  throw error;
} finally {
  await context.close();
  await browser.close();
}
