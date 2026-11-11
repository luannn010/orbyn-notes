import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const output =
  process.env.NOTES_UI_OUTPUT ?? "test-results/study-motion-policy";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  results = [];
try {
  for (const policy of [
    { os: "reduce", preference: "on", reduced: false },
    { os: "no-preference", preference: "reduced", reduced: true },
  ]) {
    const context = await browser.newContext({
      reducedMotion: policy.os,
      viewport: { width: 1160, height: 850 },
    });
    try {
      await context.addInitScript(
        (preference) => localStorage.setItem("notes.motion", preference),
        policy.preference,
      );
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(
        `${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179"}/tests/integration/study-motion-component.html`,
      );
      await expect(
        page.getByRole("button", { name: "Study 4 cards", exact: true }),
      ).toBeVisible();
      await page.evaluate(() => {
        window.__motionPolicyEvents = [];
        for (const kind of ["animationstart", "animationend"])
          document.addEventListener(
            kind,
            (event) => {
              if (!event.target.matches(".study-flash")) return;
              window.__motionPolicyEvents.push({
                kind,
                name: event.animationName,
                elapsed: event.elapsedTime,
                frames: event.target
                  .getAnimations()
                  .flatMap((a) =>
                    a.effect
                      .getKeyframes()
                      .map(({ transform, opacity }) => ({
                        transform,
                        opacity,
                      })),
                  ),
              });
            },
            true,
          );
      });
      const settle = async () =>
        page
          .locator(".study-flash")
          .evaluate((element) =>
            Promise.all(
              element.getAnimations().map((a) => a.finished.catch(() => {})),
            ),
          );
      await page
        .getByRole("button", { name: "Study 4 cards", exact: true })
        .click();
      await expect(
        page.getByRole("article", { name: "Card question", exact: true }),
      ).toBeVisible();
      await settle();
      await page
        .getByRole("button", { name: "Show answer", exact: true })
        .click();
      await expect(
        page.getByRole("article", { name: "Card answer", exact: true }),
      ).toBeVisible();
      await settle();
      await page.getByRole("button", { name: /^Good/ }).click();
      await expect(
        page.getByRole("article", { name: "Card question", exact: true }),
      ).toBeVisible();
      await settle();
      const events = await page.evaluate(() => window.__motionPolicyEvents);
      for (const [name, seconds] of [
        ["study-reveal-out", 0.105],
        ["study-answer-in", 0.15],
        ["study-card-out", 0.14],
        ["study-next-in", 0.2],
      ]) {
        const completed = events.filter(
          (e) => e.kind === "animationend" && e.name === name,
        );
        expect(
          completed.length,
          `${policy.preference} actual ${name} completion`,
        ).toBeGreaterThan(0);
        for (const event of completed)
          expect(event.elapsed).toBeCloseTo(seconds, 3);
      }
      const frames = events
        .filter(
          (e) =>
            e.kind === "animationstart" &&
            ["study-answer-in", "study-next-in"].includes(e.name),
        )
        .flatMap((e) => e.frames);
      expect(frames.length).toBeGreaterThan(0);
      if (policy.reduced)
        expect(
          frames.every(
            (frame) => !frame.transform || frame.transform === "none",
          ),
        ).toBe(true);
      else
        expect(
          frames.some((frame) => frame.transform && frame.transform !== "none"),
        ).toBe(true);
      expect(errors).toEqual([]);
      results.push({ policy, events, errors });
    } finally {
      await context.close();
    }
  }
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        qualified:
          "Genuine encrypted direct Study component; saved preference overrides OS policy. Actual CSS event timings; no App-shell/native/FPS claim.",
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: explicit On overrides OS reduction; explicit Reduced overrides ordinary OS policy, preserving actual phase durations.",
  );
} finally {
  await browser.close();
}
