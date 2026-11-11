import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const output = process.env.NOTES_UI_OUTPUT ?? "test-results/study-motion-audit";
const preview = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179";
await mkdir(output, { recursive: true });
const sourcePaths = ["src/ui/StudyView.tsx", "src/styles/study.css"];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceBefore = await Promise.all(
  sourcePaths.map(async (path) => ({
    path,
    sha256: hash(await readFile(path)),
  })),
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const reduced of [false, true]) {
    const context = await browser.newContext({
      reducedMotion: reduced ? "reduce" : "no-preference",
      viewport: { width: 1160, height: 850 },
    });
    try {
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(
        `${preview}/tests/integration/study-settings-browser.html`,
      );
      await expect(
        page.getByRole("heading", { name: "All notes", exact: true }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(async () =>
            (await import("/src/desktop/closeGuard.ts")).checkClose(),
          ),
        )
        .toBe("allowed");
      await page.evaluate(() => {
        window.__studyMotionAudit = [];
        const observe = (element, phase) => {
          if (!(element instanceof Element)) return;
          const css = getComputedStyle(element);
          window.__studyMotionAudit.push({
            phase,
            at: performance.now(),
            kind: element.classList.contains("study-toast") ? "toast" : "card",
            label: element.getAttribute("aria-label"),
            duration: css.animationDuration,
            animation: css.animationName,
            frames: element.getAnimations().flatMap((animation) =>
              animation.effect
                .getKeyframes()
                .map(({ opacity, transform, offset }) => ({
                  opacity,
                  transform,
                  offset,
                })),
            ),
          });
        };
        new MutationObserver((records) => {
          for (const record of records) {
            for (const [nodes, phase] of [
              [record.addedNodes, "added"],
              [record.removedNodes, "removed"],
            ]) {
              for (const node of nodes) {
                if (!(node instanceof Element)) continue;
                if (node.matches(".study-flash,.study-toast"))
                  observe(node, phase);
                for (const element of node.querySelectorAll(
                  ".study-flash,.study-toast",
                ))
                  observe(element, phase);
              }
            }
          }
        }).observe(document.getElementById("root"), {
          childList: true,
          subtree: true,
        });
      });
      await page.getByRole("button", { name: "Study", exact: true }).click();
      await page.getByRole("button", { name: /^Study 4 cards$/ }).click();
      await expect(
        page.getByRole("article", { name: "Card question" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Show answer", exact: true })
        .click();
      await expect(
        page.getByRole("article", { name: "Card answer" }),
      ).toBeVisible();
      const good = page.getByRole("button", { name: /^Good/ });
      await good.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      const gradeStyle = await good.evaluate((element) => {
        const css = getComputedStyle(element);
        return {
          transitionDuration: css.transitionDuration,
          transitionProperty: css.transitionProperty,
          transitionTimingFunction: css.transitionTimingFunction,
          outlineWidth: css.outlineWidth,
          outlineStyle: css.outlineStyle,
        };
      });
      expect(gradeStyle.outlineStyle).toBe("solid");
      expect(gradeStyle.outlineWidth).toBe("2px");
      const box = await good.boundingBox();
      expect(box).toBeTruthy();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await good.evaluate((element) =>
        Promise.all(
          element
            .getAnimations()
            .map((animation) => animation.finished.catch(() => undefined)),
        ),
      );
      const pressedTransform = await good.evaluate(
        (element) => getComputedStyle(element).transform,
      );
      expect(pressedTransform).toBe(
        reduced ? "none" : "matrix(0.97, 0, 0, 0.97, 0, 0)",
      );
      await page.mouse.up();
      await expect(
        page.getByRole("article", { name: "Card question" }),
      ).toBeVisible();
      await expect(page.locator(".study-toast")).toBeVisible();
      // Wait on the actual UI disappearance, rather than using a guessed sleep.
      await expect(page.locator(".study-toast")).toHaveCount(0, {
        timeout: 7000,
      });
      const timeline = await page.evaluate(() => window.__studyMotionAudit);
      const entered = timeline.filter(
        (item) => item.phase === "added" && item.kind === "card",
      );
      expect(entered.length).toBeGreaterThanOrEqual(3);
      expect(entered.some((item) => item.label === "Card answer")).toBe(true);
      if (!reduced)
        expect(
          entered.every(
            (item) =>
              item.animation === "study-answer-in" && item.duration === "0.15s",
          ),
        ).toBe(true);
      else
        expect(
          entered.every((item) =>
            item.frames.every(
              (frame) => !frame.transform || frame.transform === "none",
            ),
          ),
        ).toBe(true);
      const toastEnter = timeline.find(
          (item) => item.phase === "added" && item.kind === "toast",
        ),
        toastExit = timeline.find(
          (item) => item.phase === "removed" && item.kind === "toast",
        );
      expect(toastEnter).toBeTruthy();
      expect(toastExit.at - toastEnter.at).toBeGreaterThanOrEqual(4900);
      expect(errors).toEqual([]);
      results.push({
        reduced,
        gradeStyle,
        pressedTransform,
        timeline,
        toastLifetimeMs: toastExit.at - toastEnter.at,
        errors,
      });
    } finally {
      await context.close();
    }
  }
  const sourceAfter = await Promise.all(
    sourcePaths.map(async (path) => ({
      path,
      sha256: hash(await readFile(path)),
    })),
  );
  expect(sourceAfter).toEqual(sourceBefore);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        qualified:
          "Disposable synthetic account; genuine App/WASM/IndexedDB. Browser presentation observations only; no native input, backend authentication or whole-app frame-rate claim.",
        source: sourceBefore,
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    "Study motion baseline passed: keyed card/answer entry, grade feedback styles, actual toast expiry and reduced-motion paths observed.",
  );
} finally {
  await browser.close();
}
