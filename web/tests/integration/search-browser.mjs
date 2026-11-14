import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const output = process.env.NOTES_UI_OUTPUT ?? "test-results/search-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1160, height: 850 },
});
const page = await context.newPage();
let diagnosticPage = page;
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function runQuery(raw) {
  const input = page.getByRole("textbox", {
    name: "Search notes, clips and cards",
    exact: true,
  });
  await input.fill(raw);
  await input.press("Enter");
}
try {
  await page.goto(
    `${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179"}/tests/integration/search-browser.html`,
  );
  await expect(
    page.getByRole("heading", { name: "All notes", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.__searchMotion = [];
    let prior = null;
    let closingAt = 0;
    new MutationObserver(() => {
      const element = document.querySelector(".workspace-search");
      if (!element) {
        if (prior && closingAt)
          window.__searchMotion.push({
            phase: "removed",
            elapsed: performance.now() - closingAt,
          });
        prior = null;
        closingAt = 0;
        return;
      }
      const phase = element.getAttribute("data-phase");
      if (prior === phase) return;
      prior = phase;
      const css = getComputedStyle(element);
      window.__searchMotion.push({
        phase,
        duration: css.animationDuration,
        name: css.animationName,
        transform: css.transform,
        inert: element.inert,
        hidden: element.getAttribute("aria-hidden"),
        frames: element.getAnimations().flatMap((animation) =>
          animation.effect.getKeyframes().map((frame) => ({
            opacity: frame.opacity,
            transform: frame.transform,
          })),
        ),
      });
      if (phase === "closing") closingAt = performance.now();
    }).observe(document.getElementById("main"), {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-phase"],
    });
  });
  await page
    .getByRole("button", { name: "Search notes, clips and cards", exact: true })
    .click();
  await runQuery("lisbon");
  await expect(
    page.getByText("69 results for “lisbon”", { exact: true }),
  ).toBeVisible();
  const searchCss = await page.evaluate(() => {
    const row = document.querySelector(".search-result"),
      content = document.querySelector(".search-content"),
      heading = document.querySelector(".search-heading h1"),
      group = document.querySelector(".search-group"),
      label = group.querySelector("h2"),
      count = label.querySelector("span"),
      list = group.querySelector("ul");
    const r = getComputedStyle(row),
      c = getComputedStyle(content),
      h = getComputedStyle(heading),
      g = getComputedStyle(group),
      b = getComputedStyle(label),
      n = getComputedStyle(count),
      u = getComputedStyle(list);
    const rows = [...list.querySelectorAll(".search-result")];
    const inactive = getComputedStyle(
        document.querySelector('.search-tabs button[aria-pressed="false"]'),
      ),
      active = getComputedStyle(
        document.querySelector('.search-tabs button[aria-pressed="true"]'),
      ),
      sub = getComputedStyle(document.querySelector(".search-heading p")),
      ghost = getComputedStyle(
        document.querySelector(".search-heading > button"),
      );
    const token = (name) => {
      const probe = document.createElement("span");
      probe.hidden = true;
      probe.style.color = `var(${name})`;
      document.body.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    };
    const pill = (style) => ({
      height: style.height,
      minHeight: style.minHeight,
      padding: style.padding,
      radius: style.borderRadius,
      border: style.borderTopWidth,
      gap: style.gap,
      size: style.fontSize,
      background: style.backgroundColor,
      color: style.color,
    });
    return {
      row: {
        border: r.borderTopWidth,
        gap: r.gap,
        padding: r.padding,
        radius: r.borderRadius,
        margin: r.marginBottom,
      },
      content: { padding: c.padding, gap: c.gap },
      heading: { size: h.fontSize, spacing: h.letterSpacing },
      sub: { size: sub.fontSize, color: sub.color },
      ghost: {
        height: ghost.height,
        minHeight: ghost.minHeight,
        padding: ghost.padding,
        radius: ghost.borderRadius,
        gap: ghost.gap,
        size: ghost.fontSize,
        background: ghost.backgroundColor,
        color: ghost.color,
      },
      pills: { inactive: pill(inactive), active: pill(active) },
      tokens: {
        raise: token("--raise"),
        t2: token("--t2"),
        t3: token("--t3"),
        btn: token("--btn"),
        btnt: token("--btnt"),
      },
      section: {
        size: b.fontSize,
        weight: b.fontWeight,
        padding: b.padding,
        margin: b.margin,
        alignment: b.justifyContent,
        countSize: n.fontSize,
        countColor: n.color,
        countExpected: getComputedStyle(document.documentElement)
          .getPropertyValue("--t3")
          .trim(),
        gap: g.gap,
        listGap: u.gap,
        headingToRow:
          rows[0].getBoundingClientRect().top -
          label.getBoundingClientRect().bottom,
        rowToRow:
          rows[1].getBoundingClientRect().top -
          rows[0].getBoundingClientRect().bottom,
      },
    };
  });
  expect(searchCss.row).toEqual({
    border: "0px",
    gap: "3px",
    padding: "10px 12px",
    radius: "10px",
    margin: "0px",
  });
  expect(searchCss.content).toEqual({ padding: "6px 28px 24px", gap: "8px" });
  expect(searchCss.heading).toEqual({ size: "22px", spacing: "-0.33px" });
  expect(searchCss.section).toMatchObject({
    size: "13px",
    weight: "500",
    padding: "12px 0px 6px",
    margin: "0px",
    alignment: "space-between",
    countSize: "12px",
    gap: "8px",
    listGap: "8px",
    headingToRow: 8,
    rowToRow: 8,
  });
  expect(searchCss.section.countColor).toBe(searchCss.tokens.t3);
  expect(searchCss.sub).toEqual({ size: "13px", color: searchCss.tokens.t3 });
  expect(searchCss.ghost).toEqual({
    height: "30px",
    minHeight: "30px",
    padding: "0px 12px",
    radius: "9px",
    gap: "6px",
    size: "12.5px",
    background: searchCss.tokens.raise,
    color: searchCss.tokens.t2,
  });
  expect(searchCss.pills.inactive).toEqual({
    height: "28px",
    minHeight: "28px",
    padding: "0px 11px",
    radius: "999px",
    border: "0px",
    gap: "6px",
    size: "12px",
    background: searchCss.tokens.raise,
    color: searchCss.tokens.t2,
  });
  expect(searchCss.pills.active).toMatchObject({
    border: "0px",
    background: searchCss.tokens.btn,
    color: searchCss.tokens.btnt,
  });
  await writeFile(
    output + "/computed-css.json",
    JSON.stringify(searchCss, null, 2),
  );
  const noteGroup = page.getByRole("region", {
    name: "Notes results",
    exact: true,
  });
  await expect(noteGroup.getByRole("listitem")).toHaveCount(50);
  await page
    .getByRole("button", { name: "Next Notes results", exact: true })
    .click();
  await expect(
    page.getByText("Notes 51–62 of 62", { exact: true }),
  ).toBeVisible();
  await expect(noteGroup.getByRole("listitem")).toHaveCount(12);
  await page
    .getByRole("button", { name: "Previous Notes results", exact: true })
    .click();
  await expect(noteGroup.getByRole("listitem")).toHaveCount(50);
  await page
    .getByRole("button", { name: "Next Notes results", exact: true })
    .click();
  await expect(
    page.getByText("Notes 51–62 of 62", { exact: true }),
  ).toBeVisible();
  await noteGroup.getByRole("button").nth(5).scrollIntoViewIfNeeded();
  const retainedScroll = await page
    .locator(".unified-search")
    .evaluate((element) => element.scrollTop);
  await noteGroup.getByRole("button").nth(5).click();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to search", exact: true })
    .click();
  await expect(
    page.getByText("69 results for “lisbon”", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      Math.abs(
        (await page
          .locator(".unified-search")
          .evaluate((element) => element.scrollTop)) - retainedScroll,
      ),
    )
    .toBeLessThan(2);
  await expect(
    page.getByText("Notes 51–62 of 62", { exact: true }),
  ).toBeVisible();
  await expect(noteGroup.getByRole("listitem")).toHaveCount(12);
  await page
    .getByRole("button", { name: "Previous Notes results", exact: true })
    .click();
  await expect(noteGroup.getByRole("listitem")).toHaveCount(50);
  const before = await page.evaluate(() => window.__searchFixture.metadata());
  await page
    .getByRole("region", { name: "Clips results", exact: true })
    .getByRole("button")
    .filter({ hasText: "Archived" })
    .click();
  await expect(
    page.getByRole("button", { name: "← Back to clips", exact: true }),
  ).toBeVisible();
  const after = await page.evaluate(() => window.__searchFixture.metadata());
  expect(after.clips).toEqual(before.clips);
  await page
    .getByRole("button", { name: "Back to search", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Cards results", exact: true })
    .getByRole("button")
    .first()
    .click();
  const card = page.getByRole("dialog", { name: "Card", exact: true });
  await expect(card).toBeVisible();
  await expect(
    card.getByText("Loading card content…", { exact: true }),
  ).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Show answer", exact: true }),
  ).toBeEnabled();
  await card.getByRole("button", { name: "Show answer", exact: true }).click();
  await expect(
    card.getByRole("heading", { name: "Answer", exact: true }),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "Back to search", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  expect(
    (await page.evaluate(() => window.__searchFixture.metadata())).eventCount,
  ).toBe(before.eventCount);

  await runQuery("strasse");
  await expect(
    page.getByText("2 results for “strasse”", { exact: true }),
  ).toBeVisible();
  await runQuery("\u{10428}");
  await expect(
    page.getByText("1 result for “\u{10428}”", { exact: true }),
  ).toBeVisible();
  await runQuery("<script>");
  await expect(
    page.getByText("1 result for “<script>”", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".unified-search script")).toHaveCount(0);
  await expect(
    page.locator(".search-match").filter({ hasText: "<script>" }),
  ).toHaveCount(1);
  for (const raw of [
    "private-journal-sentinel",
    "private-source-sentinel",
    "trash-only-sentinel",
  ]) {
    await runQuery(raw);
    await expect(
      page.getByRole("heading", {
        name: `No results for “${raw}”`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "All 0", exact: true }),
    ).toBeVisible();
  }
  await runQuery("lisbon");
  await expect(
    page.getByText("69 results for “lisbon”", { exact: true }),
  ).toBeVisible();
  const privacyExitCount = await page.evaluate(
    () =>
      window.__searchMotion.filter((event) => event.phase === "closing").length,
  );
  const packing = before.notes.find((n) => n.title === "Lisbon packing");
  await page.evaluate(
    ({ id }) => window.__searchFixture.renameNote(id, "Lisbon packing renamed"),
    { id: packing.id },
  );
  // This fixture writes from a separate real actor: unknown authority clears the private query.
  await expect(
    page.getByRole("textbox", {
      name: "Search notes, clips and cards",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        window.__searchMotion.filter((event) => event.phase === "closing")
          .length,
    ),
  ).toBe(privacyExitCount);
  await page
    .getByRole("button", { name: "Search notes, clips and cards", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", {
      name: "Search notes, clips and cards",
      exact: true,
    }),
  ).toHaveValue("");
  await runQuery("lisbon");
  await expect(
    page.getByText("69 results for “lisbon”", { exact: true }),
  ).toBeVisible();
  // The actual UI writes through the same admitted App owner: retain raw query, require explicit rerun.
  await page
    .getByRole("region", { name: "Notes results", exact: true })
    .getByRole("button")
    .first()
    .click();
  const admittedTitle = page.getByRole("textbox", {
    name: "Note title",
    exact: true,
  });
  await admittedTitle.fill((await admittedTitle.inputValue()) + " via UI");
  await expect(
    page.getByText("Saved in this browser", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to search", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your library changed", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("69 results for “lisbon”", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Search again", exact: true }).click();
  await expect(
    page.getByText("69 results for “lisbon”", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Next Notes results", exact: true })
    .click();
  await expect(
    page.getByText("Notes 51–62 of 62", { exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Previous Notes results", exact: true })
    .click();
  await expect(
    page.getByText("Notes 1–50 of 62", { exact: true }),
  ).toBeFocused();
  const view = page.getByRole("region", { name: "Search", exact: true });
  async function stable() {
    await page
      .locator(".workspace-search[data-phase=open]")
      .evaluate(async (element) => {
        await document.fonts.ready;
        await Promise.all(
          element
            .getAnimations({ subtree: true })
            .filter((a) => a.effect?.getTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => {})),
        );
      });
    await expect(page.locator(".workspace-search[data-phase=open]")).toHaveCSS(
      "opacity",
      "1",
    );
    await expect(view).toHaveCSS("opacity", "1");
  }
  for (const theme of ["light", "dark", "dim"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    await view.evaluate((element) => {
      element.scrollTop = 0;
    });
    await stable();
    await page.screenshot({ path: output + `/search-${theme}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await view.evaluate((element) => {
    element.scrollTop = 0;
  });
  await stable();
  await page.screenshot({
    path: output + "/search-narrow-header-dim-reduced.png",
  });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Next Notes results", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: output + "/search-narrow-dim-reduced.png" });
  await page
    .getByRole("button", { name: "Next Notes results", exact: true })
    .click();
  await expect(
    page.getByText("Notes 51–62 of 62", { exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Cards 5", exact: true }).click();
  await page
    .getByRole("region", { name: "Cards results", exact: true })
    .getByRole("button")
    .first()
    .click();
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Show answer", exact: true }),
  ).toBeEnabled();
  await card.evaluate(async (element) => {
    await document.fonts.ready;
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((a) => a.finished.catch(() => {})),
    );
  });
  await page.screenshot({
    path: output + "/card-preview-narrow-dim-reduced.png",
  });
  await card
    .getByRole("button", { name: "Back to search", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cards 5", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "All 69", exact: true }).click();
  await page.setViewportSize({ width: 1160, height: 850 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.getByRole("button", { name: "Study", exact: true }).click();
  await page.getByRole("button", { name: /^Study \d+ cards?$/ }).click();
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Good/ })).toBeVisible();
  await page
    .getByRole("button", { name: "Search notes, clips and cards", exact: true })
    .click();
  await runQuery("lisbon");
  await expect(
    page.getByText("69 results for “lisbon”", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("region", { name: "Cards results", exact: true })
    .getByRole("button")
    .filter({ has: page.locator("b").filter({ hasText: "Train arrival" }) })
    .click();
  await expect(card).toBeVisible();
  await card
    .getByRole("button", { name: "Back to search", exact: true })
    .click();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Good/ })).toBeVisible();
  await page.getByRole("button", { name: "End session", exact: true }).click();
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Journal is locked", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Search notes, clips and cards", exact: true })
    .click();
  await runQuery("private-journal-sentinel");
  await expect(
    page.getByRole("heading", {
      name: "No results for “private-journal-sentinel”",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Journal is locked", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "All notes", exact: false }).click();
  await page
    .getByRole("button", { name: "Search notes, clips and cards", exact: true })
    .click();
  await runQuery("lisbon");
  await expect(
    page.getByText("69 results for “lisbon”", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("region", { name: "Notes results", exact: true })
    .getByRole("button")
    .first()
    .click();
  const title = page.getByRole("textbox", { name: "Note title", exact: true });
  await title.fill("Unsaved search guard");
  await title.press("Control+k");
  await expect(
    page.getByRole("textbox", {
      name: "Search notes, clips and cards",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Saved in this browser", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", {
      name: "Search notes, clips and cards",
      exact: true,
    }),
  ).toHaveCount(0);
  await title.press("Control+k");
  await expect(
    page.getByRole("textbox", {
      name: "Search notes, clips and cards",
      exact: true,
    }),
  ).toBeVisible();
  // Actual PM actor, selection and Undo survive origin A -> Search -> B -> Back/Clear.
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.getByRole("button", { name: "All notes", exact: false }).click();
  await page.getByRole("button", { name: /^Other ordinary note/ }).click();
  const originEditor = page.getByRole("textbox", {
    name: "Note content",
    exact: true,
  });
  await originEditor.fill("Origin actor Undo marker");
  await expect(
    page.getByText("Saved in this browser", { exact: true }),
  ).toBeVisible();
  await originEditor.press("Control+Home");
  await originEditor.press("Shift+End");
  await expect
    .poll(() =>
      originEditor.evaluate(
        (element) =>
          element.editor.state.selection.to -
          element.editor.state.selection.from,
      ),
    )
    .toBe("Origin actor Undo marker".length);
  const originalSelection = await originEditor.evaluate((element) => {
    window.__originNoteEditor = element;
    const view = element.editor.view;
    return { from: view.state.selection.from, to: view.state.selection.to };
  });
  expect(originalSelection.to - originalSelection.from).toBe(
    "Origin actor Undo marker".length,
  );
  await originEditor.press("Control+k");
  await runQuery("lisbon page 01");
  await expect(
    page.getByText("1 result for “lisbon page 01”", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("region", { name: "Notes results", exact: true })
    .getByRole("button")
    .click();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toHaveValue("Lisbon page 01");
  expect(await page.evaluate(() => window.__originNoteEditor.isConnected)).toBe(
    true,
  );
  expect(await page.locator(".note-actor").count()).toBe(2);
  expect(
    await page.evaluate(() => {
      const view = window.__originNoteEditor.editor.view;
      return { from: view.state.selection.from, to: view.state.selection.to };
    }),
  ).toEqual(originalSelection);
  await page
    .getByRole("button", { name: "Back to search", exact: true })
    .click();
  await expect(
    page.getByText("1 result for “lisbon page 01”", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Note title", exact: true }),
  ).toHaveValue("Other ordinary note");
  expect(
    await originEditor.evaluate(
      (element) => element === window.__originNoteEditor,
    ),
  ).toBe(true);
  expect(
    await originEditor.evaluate((element) => {
      const view = element.editor.view;
      return { from: view.state.selection.from, to: view.state.selection.to };
    }),
  ).toEqual(originalSelection);
  await originEditor.press("Control+z");
  await expect(originEditor).toHaveText("Independent writing.");
  await expect(
    page.getByText("Saved in this browser", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Search notes, clips and cards", exact: true })
    .click();
  await page.evaluate(() => window.__searchFixture.seedLarge());
  await runQuery("bounded");
  await expect(
    page.getByRole("heading", { name: "Search is paused", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel search", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Search your notes, clips and cards.",
      exact: true,
    }),
  ).toBeVisible();
  await runQuery("bounded");
  let rounds = 0;
  while (true) {
    await expect
      .poll(
        async () =>
          (await page
            .getByRole("heading", { name: "Search is paused", exact: true })
            .count()) ||
          (await page
            .getByText("3 results for “bounded”", { exact: true })
            .count()),
      )
      .toBeGreaterThan(0);
    if (
      await page.getByText("3 results for “bounded”", { exact: true }).count()
    )
      break;
    if (++rounds > 10) throw Error("Too many explicit search rounds");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await expect(
    page.getByText("3 results for “bounded”", { exact: true }),
  ).toBeVisible();
  expect(
    (await page.evaluate(() => window.__searchFixture.metadata())).eventCount,
  ).toBe(before.eventCount);
  expect(page.url()).not.toContain("bounded");
  await page.evaluate(() => window.__searchFixture.erase());
  await expect(
    page.getByRole("textbox", {
      name: "Search notes, clips and cards",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Search notes, clips and cards", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", {
      name: "Search notes, clips and cards",
      exact: true,
    }),
  ).toHaveValue("");
  // Last, separate disposable profile: genuine unnotified wrapping-proof replacement.
  const proofContext = await browser.newContext({
      viewport: { width: 1160, height: 850 },
    }),
    proofPage = await proofContext.newPage();
  diagnosticPage = proofPage;
  proofPage.on("pageerror", (error) => errors.push(error.message));
  await proofPage.goto(
    `${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179"}/tests/integration/search-browser.html`,
  );
  await expect(
    proofPage.getByRole("heading", { name: "All notes", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      proofPage.evaluate(async () => {
        const { checkClose } = await import("/src/desktop/closeGuard.ts");
        return checkClose();
      }),
    )
    .toBe("allowed");
  await proofPage
    .getByRole("button", { name: "Search notes, clips and cards", exact: true })
    .click();
  const proofQuery = proofPage.getByRole("textbox", {
    name: "Search notes, clips and cards",
    exact: true,
  });
  await proofQuery.fill("lisbon");
  await proofQuery.press("Enter");
  await expect(
    proofPage.getByText("69 results for “lisbon”", { exact: true }),
  ).toBeVisible();
  await proofPage
    .getByRole("region", { name: "Notes results", exact: true })
    .getByRole("button")
    .first()
    .click();
  await expect(proofPage.locator(".workspace-search")).toHaveCount(0);
  await proofPage.evaluate(() => {
    window.__staleSearchFlash = false;
    new MutationObserver(() => {
      const surface = document.querySelector(
        '.workspace-search:not([aria-hidden="true"])',
      );
      if (
        surface
          ?.querySelector(".search-heading p")
          ?.textContent?.includes("69 results")
      )
        window.__staleSearchFlash = true;
    }).observe(document.getElementById("main"), {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  await proofPage.evaluate(() =>
    window.__searchFixture.invalidateWrappingProof(),
  );
  await proofPage
    .getByRole("button", { name: "Back to search", exact: true })
    .click();
  await expect(proofPage.locator(".workspace-search")).toHaveCount(0);
  expect(await proofPage.evaluate(() => window.__staleSearchFlash)).toBe(false);
  await expect(proofPage.locator(".note-actor")).toHaveCount(0);
  await proofContext.close();
  diagnosticPage = page;
  const motion = await page.evaluate(() => window.__searchMotion);
  expect(
    motion.some(
      (event) =>
        event.phase === "open" &&
        event.duration === "0.24s" &&
        event.frames.some((frame) => frame.transform === "translateY(6px)"),
    ),
  ).toBe(true);
  expect(
    motion.some(
      (event) =>
        event.phase === "closing" &&
        event.duration === "0.17s" &&
        event.inert &&
        event.hidden === "true",
    ),
  ).toBe(true);
  expect(
    motion.some(
      (event) =>
        event.phase === "open" &&
        event.duration === "0.15s" &&
        event.name === "search-route-fade-in" &&
        event.transform === "none",
    ),
  ).toBe(true);
  expect(
    motion.some(
      (event) =>
        event.phase === "closing" &&
        event.duration === "0.15s" &&
        event.name === "search-route-fade-out" &&
        event.inert,
    ),
  ).toBe(true);
  expect(
    motion.some((event) => event.phase === "removed" && event.elapsed >= 120),
  ).toBe(true);
  expect(errors).toEqual([]);
  await writeFile(output + "/motion.json", JSON.stringify(motion, null, 2));
  await writeFile(
    output + "/result.json",
    JSON.stringify(
      {
        checks: [
          "69 exact counts including actual5cards",
          "50 PreviousNext pages",
          "guarded Note result and scroll-preserving return",
          "archived Clip internal reader no mutation",
          "actual card bounded preview and answer no review event",
          "Unicode full-fold/astral + escapedHTMLmatches",
          "Journal/sourcequote/Trash exclusion",
          "knownchanged explicitrerun",
          "paging focus +3themes/narrow/reduced +boundedcardpreview",
          "held revealedStudy +protectedJournalreturn",
          "actualdirtyCtrlK explicitretry",
          "genuine largecorpus pause/Continue/cancel",
          "erase clearsprivatequery/routes",
          "computed240/170 page motion and150 reduced opacity; privacy skips exit",
          "StrictMode actual PM actor/selection/Undo preserved origin A to B and Clear",
          "fresh reentry rejects genuine unnotified wrapping-proof tamper with no ready flash",
        ],
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("Search browser basic passed");
} catch (e) {
  await diagnosticPage.screenshot({
    path: output + "/failure.png",
    fullPage: true,
  });
  await writeFile(
    output + "/failure.txt",
    String(e) +
      "\nURL " +
      diagnosticPage.url() +
      "\n" +
      (await diagnosticPage.locator("body").innerText()),
  );
  throw e;
} finally {
  await browser.close();
}
