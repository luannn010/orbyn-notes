import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const output =
  process.env.NOTES_UI_OUTPUT ?? "test-results/study-motion-fixture-smoke";
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179";
await mkdir(output, { recursive: true });
const sourcePaths = [
  "src/ui/StudyView.tsx",
  "src/ui/useStudyMotion.ts",
  "src/styles/study.css",
];
const fingerprint = () =>
  Promise.all(
    sourcePaths.map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    })),
  );
const before = await fingerprint(),
  results = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
let stage = "boot";
try {
  for (const mode of [
    "cold-and-reopen",
    "lock",
    "same-identity",
    "epoch",
    "held-commit",
    "held-read",
  ]) {
    const context = await browser.newContext({
      viewport: { width: 1160, height: 850 },
    });
    try {
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      stage = mode + ":boot";
      await page.goto(
        `${base}/tests/integration/study-motion-component.html${mode === "cold-and-reopen" ? "?holdRead=1" : ""}`,
      );
      await page.waitForFunction(
        () =>
          !!window.__studyMotionFixture ||
          document.getElementById("root")?.dataset.fixtureFailed === "true",
      );
      if (await page.locator("#root").getAttribute("data-fixture-failed"))
        throw Error(await page.locator("#root").innerText());
      if (mode === "cold-and-reopen") {
        await page.waitForFunction(
          () => window.__studyMotionFixture.gates().readReached,
        );
        await expect(page.locator(".study-skeleton")).toBeVisible();
        await page.evaluate(() => window.__studyMotionFixture.releaseRead());
      }
      await page.getByRole("button", { name: /^Study 4 cards$/ }).click();
      await page
        .getByRole("button", { name: "Show answer", exact: true })
        .click();
      await expect(
        page.getByRole("article", { name: "Card answer", exact: true }),
      ).toBeVisible();
      stage = mode + ":revoke";
      let observation;
      if (mode === "cold-and-reopen") {
        observation = await page.evaluate(() =>
          window.__studyMotionFixture.closeAndInspect(),
        );
        expect(observation.noCardDom).toBe(true);
        await expect(
          page.getByText("Study is no longer available.", { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Try again", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: /^Study 4 cards$/ }),
        ).toBeVisible();
      } else if (mode === "lock") {
        observation = await page.evaluate(() =>
          window.__studyMotionFixture.lockAndInspect(),
        );
        expect(observation.noCardDom).toBe(true);
      } else if (mode === "same-identity") {
        observation = await page.evaluate(() =>
          window.__studyMotionFixture.reauthenticateAndInspect(),
        );
        expect(observation.noCardDom).toBe(true);
      } else if (mode === "epoch") {
        await page.evaluate(() => window.__studyMotionFixture.watchEpoch());
        observation = await page.evaluate(() =>
          window.__studyMotionFixture.eraseAndObserve(),
        );
        expect(observation.noCardDom).toBe(true);
        expect(observation.epochSamples.length).toBeGreaterThan(0);
        expect(observation.epochSamples.every(Boolean)).toBe(true);
        await expect(
          page.getByText("No decks yet", { exact: true }),
        ).toBeVisible();
      } else if (mode === "held-commit") {
        await page.evaluate(() => window.__studyMotionFixture.holdNextCommit());
        await page.getByRole("button", { name: /^Good/ }).click();
        await page.waitForFunction(
          () => window.__studyMotionFixture.gates().commitReached,
        );
        const pending = await page.evaluate(() =>
          window.__studyMotionFixture.metadata(),
        );
        expect(pending.study.events).toHaveLength(0);
        await expect(
          page.getByRole("article", { name: "Card answer", exact: true }),
        ).toBeVisible();
        observation = await page.evaluate(() =>
          window.__studyMotionFixture.closeAndInspect(),
        );
        expect(observation.noCardDom).toBe(true);
        await page.evaluate(() => window.__studyMotionFixture.releaseCommit());
      } else {
        await page.evaluate(async () => {
          window.__studyMotionFixture.holdNextRead();
          await window.__studyMotionFixture.toggleStreak();
        });
        await page.waitForFunction(
          () => window.__studyMotionFixture.gates().readReached,
        );
        observation = await page.evaluate(() =>
          window.__studyMotionFixture.closeAndInspect(),
        );
        expect(observation.noCardDom).toBe(true);
        await page.evaluate(() => window.__studyMotionFixture.releaseRead());
      }
      if (!["cold-and-reopen", "epoch"].includes(mode)) {
        await expect(
          page.getByText("Study is no longer available.", { exact: true }),
        ).toBeVisible();
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        await expect(page.locator(".study-flash")).toHaveCount(0);
      }
      expect(errors).toEqual([]);
      results.push({ mode, observation, errors });
    } finally {
      await context.close();
    }
  }
  const after = await fingerprint();
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        qualified:
          "Disposable synthetic identity; direct production StudyView with genuine owner/WASM/IndexedDB, explicit test-only read-ack/precommit gates. No App-shell/backend/native proof. WIP source identities recorded; final freeze needs a rerun.",
        before,
        after,
        sourceStable: JSON.stringify(before) === JSON.stringify(after),
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: genuine cold/read/commit gates, synchronous close/lock/reauth/observed-epoch clearing, real owner reopen and stale-result suppression.",
  );
} catch (error) {
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify({ stage, error: String(error), before, results }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
