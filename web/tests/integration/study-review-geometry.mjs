import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

// Synthetic identity in a fresh browser context; real production Study/store/WASM.
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5191";
const output =
  process.env.NOTES_UI_OUTPUT ?? "test-results/study-review-geometry";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const measurements = [],
  errors = [];
let activePage;
async function stable(page) {
  await expect(page.locator(".study-flash:not([inert])")).toHaveAttribute(
    "data-study-motion",
    "stable",
  );
}
async function measure(page, theme, width, type, side) {
  const result = await page
    .locator(".study-flash:not([inert])")
    .evaluate((card) => {
      const css = (element) => {
        if (!element) return null;
        const s = getComputedStyle(element),
          r = element.getBoundingClientRect();
        return {
          width: r.width,
          height: r.height,
          font: s.fontSize,
          weight: s.fontWeight,
          color: s.color,
          background: s.backgroundColor,
          radius: s.borderRadius,
          padding: s.padding,
          gap: s.gap,
        };
      };
      const probe = document.createElement("span");
      card.append(probe);
      const tokens = {};
      for (const token of ["t1", "t3", "line2", "raise"]) {
        probe.style.color = `var(--${token})`;
        tokens[token] = getComputedStyle(probe).color;
      }
      probe.remove();
      const track = document.querySelector(".study-review-track");
      return {
        card: css(card),
        inner: css(card.querySelector(".study-flash-content")),
        innerBottom: card.querySelector(".study-flash-content").getBoundingClientRect().bottom,
        controlTop: (card.querySelector(".study-grades") ?? card.querySelector(".primary"))?.getBoundingClientRect().top,
        question: css(card.querySelector(".study-question")),
        answer:
          card.querySelector(".study-answer") &&
          css(card.querySelector(".study-answer")),
        show:
          card.querySelector(".primary") && css(card.querySelector(".primary")),
        badge: css(card.querySelector("kbd")),
        track: css(track),
        fill: css(track.querySelector("i")),
        gradesInside: !!card.querySelector(".study-grades"),
        instructionInside: !!card.querySelector("p.study-caption"),
        instructionDisplay: getComputedStyle(card.querySelector("p.study-caption") ?? card).display,
        columns:
          card.querySelector(".study-grades") &&
          getComputedStyle(
            card.querySelector(".study-grades"),
          ).gridTemplateColumns.split(" ").length,
        tokens,
        overflow:
          document.documentElement.scrollWidth > innerWidth ||
          card.scrollWidth > card.clientWidth,
      };
    });
  measurements.push({ theme, width, type, side, ...result });
  await writeFile(
    `${output}/measurements.json`,
    JSON.stringify(measurements, null, 2),
  );
  await page.screenshot({
    path: `${output}/${theme}-${width}-${type}-${side}.png`,
    fullPage: true,
  });
  expect(result.overflow).toBe(false);
  expect(result.track.height).toBe(6);
  expect(result.track.radius).toBe("999px");
  expect(result.track.background).toBe(result.tokens.line2);
  expect(result.fill.background).toBe(result.tokens.t1);
  expect(result.fill.radius).toBe("999px");
  expect(result.card.gap).toBe("14px");
  if (width > 700) {
    expect(result.card.radius).toBe("16px");
    expect(result.card.padding).toBe("32px");
  } else {
    expect(result.inner.radius).toBe("16px");
    expect(result.inner.padding).toBe(side === "front" ? "36px 20px" : "28px 20px");
    expect(result.controlTop).toBeGreaterThanOrEqual(result.innerBottom);
  }
  if (width > 700) expect(result.card.width).toBe(side === "front" ? 520 : 560);
  if (side === "front") {
    expect(result.question.font).toBe(width > 700 ? "20px" : "18px");
    expect(result.show.height).toBe(40);
    expect(result.show.font).toBe("13.5px");
    expect(result.show.radius).toBe("12px");
    expect(result.show.padding).toBe("0px 16px");
  } else {
    expect(result.badge.font).toBe("10.5px");
    expect(result.badge.radius).toBe("4px");
    expect(result.badge.padding).toBe("0px 5px");
    expect(result.badge.color).toBe(result.tokens.t3);
    expect(result.badge.background).toBe(result.tokens.raise);
    expect(result.question.font).toBe("13px");
    expect(result.question.weight).toBe("400");
    expect(result.question.color).toBe(result.tokens.t3);
    expect(result.answer.font).toBe(width > 700 ? "18px" : "17px");
    expect(result.answer.color).toBe(result.tokens.t1);
    expect(result.gradesInside).toBe(true);
    expect(result.instructionInside).toBe(true);
    expect(result.instructionDisplay).toBe(width > 700 ? "block" : "none");
    expect(result.columns).toBe(width > 700 ? 4 : 2);
  }
  await page.screenshot({
    path: `${output}/${theme}-${width}-${type}-${side}.png`,
    fullPage: true,
  });
}
try {
  for (const theme of ["light", "dark", "dim"])
    for (const width of [1160, 390])
      for (const type of ["basic", "reversed", "cloze"]) {
        const context = await browser.newContext({
          reducedMotion: type === "cloze" ? "reduce" : "no-preference",
          viewport: { width, height: width === 390 ? 844 : 760 },
        });
        const page = await context.newPage();
        activePage = page;
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`${base}/tests/integration/study-review-geometry.html`);
        const fonts = await page.evaluate(async () => {
          await document.fonts.load('400 10.5px "JetBrains Mono"');
          await document.fonts.load('400 13px Geist');
          await document.fonts.load('500 20px Geist');
          await document.fonts.ready;
          return {
            mono: document.fonts.check('400 10.5px "JetBrains Mono"'),
            geist: document.fonts.check('400 13px Geist') && document.fonts.check('500 20px Geist'),
            monoLoaded: [...document.fonts].some((font) => font.family === "JetBrains Mono" && font.status === "loaded"),
            geistLoaded: [...document.fonts].some((font) => font.family === "Geist" && font.status === "loaded"),
          };
        });
        expect(fonts).toEqual({ mono: true, geist: true, monoLoaded: true, geistLoaded: true });
        await expect(
          page.getByText("No decks yet", { exact: true }),
        ).toBeVisible();
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, theme);
        await page
          .getByRole("button", { name: "New deck", exact: true })
          .first()
          .click();
        let dialog = page.getByRole("dialog", { name: "New deck" });
        await dialog.getByLabel("Name").fill("Review geometry");
        await dialog
          .getByRole("button", { name: "Create deck", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Add card", exact: true })
          .first()
          .click();
        dialog = page.getByRole("dialog", { name: "Add card", exact: true });
        const long =
          "Long synthetic study content with an_unbroken_identifier_" +
          "x".repeat(65) +
          " and a second line.\n";
        if (type === "cloze") {
          await dialog
            .getByRole("button", { name: "Fill in the blank", exact: true })
            .click();
          await dialog
            .getByLabel("Text", { exact: true })
            .fill(long + "The answer is {{blank1}}.");
          await dialog
            .getByLabel("Answer 1", { exact: true })
            .fill("cytoplasm");
        } else {
          if (type === "reversed")
            await dialog
              .getByRole("button", { name: "Reversed", exact: true })
              .click();
          await dialog
            .getByLabel("Front", { exact: true })
            .fill(long + "Which molecule carries electrons?");
          await dialog
            .getByLabel("Back", { exact: true })
            .fill(long + "NADH and FADH2");
        }
        await dialog
          .getByRole("button", { name: "Add card", exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
        await page.getByRole("button", { name: /^Study [12] cards?$/ }).click();
        await stable(page);
        await measure(page, theme, width, type, "front");
        const before = await page.evaluate(() =>
          window.__collectionsFixture.read(),
        );
        await page
          .getByRole("button", { name: "Show answer", exact: true })
          .click();
        await stable(page);
        await measure(page, theme, width, type, "back");
        const answer = await page.locator(".study-answer").innerText();
        await page.locator(".study-flash").evaluate((card) => {
          window.__reviewStableHeight = card.getBoundingClientRect().height;
          window.__reviewExit = null;
          document.addEventListener(
            "animationstart",
            (event) => {
              if (event.animationName !== "study-card-out") return;
              const outgoing = event.target;
              window.__reviewExit = {
                height: outgoing.getBoundingClientRect().height,
                inert: outgoing.inert,
                hidden: outgoing.getAttribute("aria-hidden"),
                controls: outgoing.querySelectorAll(".study-grades button")
                  .length,
              };
            },
            { capture: true },
          );
        });
        await page.getByRole("button", { name: /^Good/ }).click();
        await expect
          .poll(() => page.evaluate(() => window.__reviewExit))
          .not.toBeNull();
        const exit = await page.evaluate(() => ({
          ...window.__reviewExit,
          stableHeight: window.__reviewStableHeight,
        }));
        expect(exit.height).toBe(exit.stableHeight);
        expect(exit.inert).toBe(true);
        expect(exit.hidden).toBe("true");
        expect(exit.controls).toBe(0);
        await expect
          .poll(
            async () =>
              (await page.evaluate(() => window.__collectionsFixture.read()))
                .study.events.length,
          )
          .toBe(1);
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        await stable(page);
        await expect(page.locator(".study-answer")).toHaveText(answer);
        const undone = await page.evaluate(() =>
          window.__collectionsFixture.read(),
        );
        expect(
          undone.study.cards.map(({ id, entryId, key, schedule }) => ({
            id,
            entryId,
            key,
            schedule,
          })),
        ).toEqual(
          before.study.cards.map(({ id, entryId, key, schedule }) => ({
            id,
            entryId,
            key,
            schedule,
          })),
        );
        await context.close();
      }
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        measurements,
        errors,
        scope:
          "Browser synthetic account; real production component, encrypted store, scheduler, grade and Undo. No native/account backend qualification.",
      },
      null,
      2,
    ),
  );
  console.log(
    `Review geometry passed: ${measurements.length} measured states, 18 real grade/Undo journeys.`,
  );
} catch (error) {
  await activePage?.screenshot({
    path: `${output}/failure.png`,
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
