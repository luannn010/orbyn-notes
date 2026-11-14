import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const output =
  process.env.NOTES_UI_OUTPUT ?? "test-results/study-motion-browser";
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [],
  errors = [];
let activePage;
async function pageFor(context, path = "study-motion-component.html") {
  const page = await context.newPage();
  activePage = page;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/tests/integration/${path}`);
  await page.waitForFunction(
    () => window.__studyMotionFixture || window.__studySettingsFixture,
  );
  await page.evaluate(() => {
    window.__motionEvents = [];
    for (const kind of ["animationstart", "animationend"]) {
      document.addEventListener(
        kind,
        (event) => {
          if (!event.animationName.startsWith("study-")) return;
          const element = event.target,
            css = getComputedStyle(element);
          window.__motionEvents.push({
            kind,
            name: event.animationName,
            elapsed: event.elapsedTime,
            at: performance.now(),
            phase: element.dataset.studyMotion,
            duration: css.animationDuration,
            easing: css.animationTimingFunction,
            frames: element
              .getAnimations()
              .flatMap((a) =>
                a.effect
                  .getKeyframes()
                  .map(({ opacity, transform }) => ({ opacity, transform })),
              ),
          });
        },
        true,
      );
    }
  });
  return page;
}
async function settle(page, selector = ".study-flash") {
  await page.locator(selector).evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((a) => a.finished.catch(() => {})),
    );
  });
}
async function start(page) {
  await page
    .getByRole("button", { name: "Study 4 cards", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: "Card question" }),
  ).toBeVisible();
  await settle(page);
}
async function reveal(page) {
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await expect(
    page.getByRole("article", { name: "Card answer" }),
  ).toBeVisible();
  await settle(page);
}
function timing(events, name, seconds) {
  const ends = events.filter(
    (event) => event.name === name && event.kind === "animationend",
  );
  expect(ends.length, `${name} actual completion`).toBeGreaterThan(0);
  for (const event of ends) expect(event.elapsed).toBeCloseTo(seconds, 3);
}
try {
  {
    const context = await browser.newContext();
    const page = await pageFor(context);
    await start(page);
    await page.evaluate(() => {
      const early = (event) => {
        if (
          event.animationName !== "study-answer-in" ||
          event.target.getAttribute("aria-label") !== "Card answer"
        )
          return;
        document.removeEventListener("animationstart", early, true);
        const good = [
          ...document.querySelectorAll(".study-grades button"),
        ].find((button) => button.textContent.startsWith("Good"));
        window.__earlyGradeAttempt = {
          disabled: good.disabled,
          phase: event.target.dataset.studyMotion,
          preview: good.querySelector("time").getAttribute("datetime"),
        };
        good.click();
        event.target.dispatchEvent(
          new KeyboardEvent("keydown", { key: "1", bubbles: true }),
        );
      };
      document.addEventListener("animationstart", early, true);
    });
    await reveal(page);
    const attempted = await page.evaluate(() => window.__earlyGradeAttempt);
    expect(attempted).toMatchObject({ disabled: true, phase: "answer-enter" });
    await expect(page.getByRole("button", { name: /^Good/ })).toBeEnabled();
    expect(
      (await page.evaluate(() => window.__studyMotionFixture.metadata())).study
        .events,
    ).toHaveLength(0);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    expect(
      (await page.evaluate(() => window.__studyMotionFixture.metadata())).study
        .events,
    ).toHaveLength(0);
    await page.getByRole("button", { name: /^Good/ }).click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.__studyMotionFixture.metadata()))
            .study.events.length,
      )
      .toBe(1);
    expect(
      (await page.evaluate(() => window.__studyMotionFixture.metadata())).study
        .events[0].after.schedule.due,
    ).toBe(attempted.preview);
    results.push({ stableAnswerAdmission: attempted, noQueuedGrade: true });
    await context.close();
  }
  for (const reduced of [false, true]) {
    const context = await browser.newContext({
      viewport: { width: 1160, height: 850 },
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    const page = await pageFor(context);
    await start(page);
    await reveal(page);
    const before = await page.evaluate(() =>
      window.__studyMotionFixture.metadata(),
    );
    for (const theme of ["light", "dark", "dim"]) {
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        theme,
      );
      await page.screenshot({
        path: `${output}/answer-${theme}-${reduced ? "reduced" : "normal"}.png`,
      });
    }
    await page.setViewportSize({ width: 390, height: 780 });
    await page.getByRole("button", { name: /^Easy/ }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${output}/answer-narrow-${reduced ? "reduced" : "normal"}.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1160, height: 850 });
    const preview = await page
      .locator(".study-grades time")
      .evaluateAll((elements) =>
        elements.map((el) => el.getAttribute("datetime")),
      );
    await page.evaluate(() => window.__studyMotionFixture.holdNextCommit());
    await page.getByRole("button", { name: /^Good/ }).click();
    await expect
      .poll(() =>
        page.evaluate(() => window.__studyMotionFixture.gates().commitReached),
      )
      .toBe(true);
    expect(
      await page.locator('[data-study-motion="confirmed-exit"]').count(),
    ).toBe(0);
    expect(
      (await page.evaluate(() => window.__studyMotionFixture.metadata())).study
        .events,
    ).toEqual(before.study.events);
    await page.evaluate(() => window.__studyMotionFixture.releaseCommit());
    await expect(
      page.getByRole("article", { name: "Card question" }),
    ).toBeVisible();
    await settle(page);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(
      page.getByRole("article", { name: "Card answer" }),
    ).toBeVisible();
    await settle(page);
    expect(
      (await page.evaluate(() => window.__studyMotionFixture.metadata())).study
        .events[0].undoneAt,
    ).not.toBeNull();
    await page.getByRole("button", { name: /^Good/ }).click();
    await expect(
      page.getByRole("article", { name: "Card question" }),
    ).toBeVisible();
    await settle(page);
    await expect(page.locator(".study-toast")).toHaveCount(0, {
      timeout: 7000,
    });
    for (let i = 0; i < 3; i++) {
      await reveal(page);
      await page.getByRole("button", { name: /^Easy/ }).click();
      if (i < 2) {
        await expect(
          page.getByRole("article", { name: "Card question" }),
        ).toBeVisible();
        await settle(page);
      }
    }
    await expect(
      page.getByRole("heading", { name: "Done for today", exact: true }),
    ).toBeVisible();
    await settle(page, ".study-done-label");
    const events = await page.evaluate(() => window.__motionEvents);
    timing(events, "study-reveal-out", 0.105);
    timing(events, "study-answer-in", 0.15);
    timing(events, "study-card-out", 0.14);
    timing(events, "study-next-in", 0.2);
    timing(events, "study-toast-out", 0.14);
    if (!reduced) timing(events, "study-fade", 0.15);
    const next = events.find(
      (event) =>
        event.name === "study-next-in" && event.kind === "animationstart",
    );
    expect(next.easing).toBe("cubic-bezier(0.2, 0.8, 0.2, 1)");
    expect(
      next.frames.some(
        (frame) => frame.transform && frame.transform !== "none",
      ),
    ).toBe(!reduced);
    if (reduced)
      expect(
        await page
          .locator(".study-done-label")
          .evaluate((el) => getComputedStyle(el).animationName),
      ).toBe("none");
    for (const theme of ["light", "dark", "dim"]) {
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        theme,
      );
      await page.screenshot({
        path: `${output}/done-${theme}-${reduced ? "reduced" : "normal"}.png`,
      });
    }
    await page.setViewportSize({ width: 390, height: 780 });
    await page.screenshot({
      path: `${output}/done-narrow-${reduced ? "reduced" : "normal"}.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    results.push({
      reduced,
      events,
      preview,
      checks: [
        "real precommit hold has no departure/event",
        "real confirmation and Undo",
        "actual105/140/150/200 completions",
        "toast140exit",
        "Done actual/reduced",
        "themes/narrow",
      ],
    });
    await context.close();
  }
  // Cold initial read acknowledgement remains genuine; only its delivery is held.
  for (const reduced of [false, true]) {
    const context = await browser.newContext({
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    const page = await pageFor(
      context,
      "study-motion-component.html?holdRead=1",
    );
    await expect
      .poll(() =>
        page.evaluate(() => window.__studyMotionFixture.gates().readReached),
      )
      .toBe(true);
    await expect(page.getByLabel("Loading decks")).toBeVisible();
    const ring = await page.locator(".study-loading-ring").evaluate((el) => ({
      name: getComputedStyle(el).animationName,
      duration: getComputedStyle(el).animationDuration,
    }));
    expect(ring).toEqual(
      reduced
        ? { name: "none", duration: "0s" }
        : { name: "study-ring", duration: "0.9s" },
    );
    await page.evaluate(() => window.__studyMotionFixture.releaseRead());
    await expect(
      page.getByRole("button", { name: "Study 4 cards", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".study-loader-exit")).toHaveCount(0);
    const coldEvents = await page.evaluate(() => window.__motionEvents);
    timing(coldEvents, "study-fade", 0.15);
    timing(coldEvents, "study-loader-out", 0.15);
    results.push({
      coldReduced: reduced,
      ring,
      events: coldEvents,
    });
    await context.close();
  }
  // Synchronous privacy boundaries in fresh isolated owners, including held commit.
  {
    const context = await browser.newContext();
    const page = await pageFor(context);
    await start(page);
    const edit = await page.evaluate(async () => {
      const front = document.querySelector(".study-question").textContent;
      const state = await window.__studyMotionFixture.metadata();
      const entry = state.study.entries.find((entry) => entry.front === front);
      document.querySelector(".study-flash .primary").click();
      await Promise.resolve();
      const admitted =
        document.querySelector(".study-flash").dataset.studyMotion;
      await window.__studyMotionFixture.editEntry(
        entry.id,
        "Genuine compatible edit",
      );
      return { admitted };
    });
    expect(edit.admitted).toBe("reveal-exit");
    await expect(page.locator('[data-study-motion="reveal-exit"]')).toHaveCount(
      0,
    );
    await expect(page.locator(".study-question")).toHaveText(
      "Genuine compatible edit",
    );
    results.push({ sameIdCompatibleEdit: edit });
    await context.close();
  }
  for (const action of [
    "closeAndInspect",
    "lockAndInspect",
    "reauthenticateAndInspect",
    "eraseAndObserve",
  ]) {
    const context = await browser.newContext();
    const page = await pageFor(context);
    await start(page);
    await reveal(page);
    if (action === "closeAndInspect") {
      await page.evaluate(() => window.__studyMotionFixture.holdNextCommit());
      await page.getByRole("button", { name: /^Good/ }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__studyMotionFixture.gates().commitReached,
          ),
        )
        .toBe(true);
    }
    if (action === "eraseAndObserve")
      await page.evaluate(() => window.__studyMotionFixture.watchEpoch());
    const result = await page.evaluate(
      (action) => window.__studyMotionFixture[action](),
      action,
    );
    expect(result.noCardDom).toBe(true);
    if (result.epochSamples)
      expect(result.epochSamples.every(Boolean)).toBe(true);
    if (action === "closeAndInspect") {
      expect(
        await page.evaluate(async () =>
          (await import("/src/desktop/closeGuard.ts")).checkClose(),
        ),
      ).toBe("working");
      await page.evaluate(() => window.__studyMotionFixture.releaseCommit());
      await expect(
        page.getByText("Study is no longer available.", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Try again", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Study 4 cards", exact: true }),
      ).toBeVisible();
    }
    results.push({ privacyAction: action, result });
    await context.close();
  }
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify({ results, pageErrors: errors }, null, 2),
  );
  console.log("Study motion genuine encrypted browser passed");
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${output}/failure.png` });
    await writeFile(
      `${output}/failure-events.json`,
      JSON.stringify(
        await activePage.evaluate(() => ({
          events: window.__motionEvents,
          body: document.body.innerText,
        })),
        null,
        2,
      ),
    );
  }
  await writeFile(
    `${output}/failure.txt`,
    String(error) + "\n" + JSON.stringify({ results, errors }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
