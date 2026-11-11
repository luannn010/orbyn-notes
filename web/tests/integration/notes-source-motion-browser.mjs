// Genuine encrypted Notes source motion/placement regression driver; synthetic disposable contexts only.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "../..");
const require = createRequire(join(web, "package.json"));
const { chromium, expect } = require("@playwright/test");
const focusOnly = process.argv.includes("--focus-only");
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5179";
const output =
  process.env.NOTES_UI_OUTPUT ??
  resolve(web, "test-results/notes-source-motion-browser");
await mkdir(output, { recursive: true });
const sources = [
  "src/ui/RichEditor.tsx",
  "src/ui/SourceCardComposer.tsx",
  "src/ui/NoteEditor.tsx",
  "src/styles/study-source.css",
  "src/ui/primitives.tsx",
  "src/styles/app.css",
  "tests/integration/study-source-browser.tsx",
];
async function hashes() {
  return Promise.all(
    sources.map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(join(web, path)))
        .digest("hex"),
    })),
  );
}
const before = await hashes(),
  runs = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
let activePage;
async function stable(locator) {
  await locator.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  await expect(locator).toHaveCSS("opacity", "1");
}
async function sample(page, selector) {
  return page
    .locator(selector)
    .first()
    .evaluateAll((elements) => {
      const element = elements[0];
      if (!element) return { present: false };
      const css = getComputedStyle(element),
        rect = element.getBoundingClientRect();
      return {
        present: true,
        classes: element.className,
        inert: element.inert,
        ariaHidden: element.getAttribute("aria-hidden"),
        opacity: css.opacity,
        transform: css.transform,
        animation: css.animationName,
        duration: css.animationDuration,
        easing: css.animationTimingFunction,
        pointerEvents: css.pointerEvents,
        borderColor: css.borderBottomColor,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        activeInside: element.contains(document.activeElement),
        focusable: [
          ...element.querySelectorAll("button,textarea,select,input"),
        ].filter((control) => !control.disabled).length,
      };
    });
}
async function mark(page, value) {
  await page.evaluate((value) => (window.__sourceAudit.phase = value), value);
}
async function selection(page) {
  const editor = page.getByLabel("Note content", { exact: true });
  await editor.click();
  await editor.press("Control+Home");
  for (let i = 0; i < 7; i++) await editor.press("ArrowRight");
  for (let i = 0; i < 14; i++) await editor.press("Shift+ArrowRight");
  await expect(
    page.getByRole("toolbar", { name: "Selection tools", exact: true }),
  ).toBeVisible();
}
async function open(page) {
  await selection(page);
  await page
    .getByRole("toolbar", { name: "Selection tools", exact: true })
    .getByRole("button", { name: "Make a card", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Make a card",
    exact: true,
    includeHidden: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}
function row(events, name, phase) {
  return events.filter(
    (event) =>
      event.kind === "animationend" &&
      event.name === name &&
      (!phase || event.phase === phase),
  );
}
try {
  for (const mode of [
    { id: "normal", os: "no-preference", motion: "system" },
    { id: "os-reduced", os: "reduce", motion: "system" },
    { id: "explicit-on-os-reduced", os: "reduce", motion: "on" },
    { id: "explicit-reduced", os: "no-preference", motion: "reduced" },
  ].slice(0, focusOnly ? 1 : 4)) {
    const reduced =
      mode.motion === "reduced" ||
      (mode.os === "reduce" && mode.motion !== "on");
    const context = await browser.newContext({
      viewport: { width: 1160, height: 850 },
      reducedMotion: mode.os,
    });
    await context.addInitScript(
      (motion) => localStorage.setItem("notes.motion", motion),
      mode.motion,
    );
    const page = await context.newPage();
    activePage = page;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/tests/integration/study-source-browser.html`);
    await page.waitForFunction(() => window.__studySourceFixture);
    const setup = page.getByRole("dialog", {
      name: "Set up Orbyn Notes",
      exact: true,
    });
    await expect(setup).toBeVisible();
    {
      await setup.getByRole("button", { name: "Skip", exact: true }).click();
      await setup.getByRole("button", { name: "Skip", exact: true }).click();
      await expect(setup).toHaveCount(0);
    }
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await import("/src/desktop/closeGuard.ts")).checkClose(),
        ),
      )
      .toBe("allowed");
    await page.getByRole("button", { name: "Study", exact: true }).click();
    await page
      .getByRole("button", { name: "New deck", exact: true })
      .first()
      .click();
    let dialog = page.getByRole("dialog", { name: "New deck", exact: true });
    await dialog.getByLabel("Name").fill("Motion audit deck");
    await dialog
      .getByRole("button", { name: "Create deck", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: /^All notes/ }).click();
    await page
      .getByRole("button", { name: "New note", exact: true })
      .first()
      .click();
    await page.getByLabel("Note title").fill("Synthetic source motion audit");
    const editor = page.getByLabel("Note content", { exact: true });
    await editor.click();
    await page.keyboard.type("Before NADH and FADH2 after.");
    await expect(
      page.getByText("Saved in this browser", { exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      const audit = (window.__sourceAudit = {
          phase: "ready",
          events: [],
          frames: [],
          dom: [],
        }),
        ids = new WeakMap();
      let next = 0;
      const selector =
        ".source-card-popover,.source-card-notice,.study-source-annotation,.study-selection-toolbar";
      const id = (element) => {
        if (!ids.has(element)) ids.set(element, ++next);
        return ids.get(element);
      };
      const snapshot = (element) => {
        const css = getComputedStyle(element);
        return {
          id: id(element),
          at: performance.now(),
          phase: audit.phase,
          classes: element.className,
          connected: element.isConnected,
          opacity: css.opacity,
          transform: css.transform,
          borderColor: css.borderBottomColor,
          animation: css.animationName,
          duration: css.animationDuration,
          easing: css.animationTimingFunction,
          pointerEvents: css.pointerEvents,
          inert: element.inert,
          ariaHidden: element.getAttribute("aria-hidden"),
        };
      };
      for (const kind of [
        "animationstart",
        "animationend",
        "animationcancel",
      ]) {
        document.addEventListener(
          kind,
          (event) => {
            const element = event.target;
            if (!(element instanceof Element) || !element.matches(selector))
              return;
            audit.events.push({
              ...snapshot(element),
              kind,
              name: event.animationName,
              elapsed: event.elapsedTime,
              keyframes: element.getAnimations().flatMap((animation) =>
                animation.effect
                  .getKeyframes()
                  .map(({ opacity, transform, borderBottomColor, offset }) => ({
                    opacity,
                    transform,
                    borderBottomColor,
                    offset,
                  })),
              ),
            });
            if (kind === "animationstart") {
              const deadline = performance.now() + 450;
              let frames = 0;
              const frame = () => {
                if (
                  element.isConnected &&
                  performance.now() < deadline &&
                  frames++ < 40
                ) {
                  audit.frames.push(snapshot(element));
                  requestAnimationFrame(frame);
                }
              };
              requestAnimationFrame(frame);
            }
          },
          true,
        );
      }
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "attributes" && record.target.matches(selector))
            audit.dom.push({ ...snapshot(record.target), kind: "attribute" });
          for (const [nodes, kind] of [
            [record.addedNodes, "added"],
            [record.removedNodes, "removed"],
          ])
            for (const node of nodes) {
              if (!(node instanceof Element)) continue;
              for (const element of [node, ...node.querySelectorAll(selector)])
                if (element.matches(selector))
                  audit.dom.push({ ...snapshot(element), kind });
            }
        }
      }).observe(document.getElementById("root"), {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class", "inert", "aria-hidden"],
      });
    });
    const observations = {
      mode,
      policy: await page.evaluate(() => ({
        effective: document.documentElement.dataset.motion,
        os: matchMedia("(prefers-reduced-motion: reduce)").matches,
      })),
    };
    await editor.evaluate((node) => {
      window.__sourceEditorBefore = node;
      window.__sourceHTMLBefore = node.innerHTML;
    });
    await mark(page, "clean-escape");
    dialog = await open(page);
    observations.enter = await sample(page, ".source-card-popover");
    await stable(dialog);
    await expect(
      dialog.getByRole("textbox", { name: "Front", exact: true }),
      "Opening Front receives focus after visible placement",
    ).toBeFocused();
    await page.screenshot({ path: join(output, `${mode.id}-popover.png`) });
    if (focusOnly) {
      runs.push({ mode, openingFrontFocused: true, pageErrors: errors });
      await context.close();
      break;
    }
    await dialog
      .getByRole("textbox", { name: "Front", exact: true })
      .press("Escape");
    observations.escapeClosing = await sample(page, ".source-card-popover");
    expect(observations.escapeClosing).toMatchObject({
      inert: true,
      ariaHidden: "true",
      pointerEvents: "none",
    });
    await expect(dialog).toHaveCount(0);
    observations.escapeFocusImmediate = await page.evaluate(() => ({
      label: document.activeElement?.getAttribute("aria-label"),
      selectedPassage: window.getSelection()?.toString() === "NADH and FADH2",
      nativeSelection: window.getSelection()?.toString(),
      activeTag: document.activeElement?.tagName,
    }));
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    observations.escapeFocusSettled = await page.evaluate(() => ({
      label: document.activeElement?.getAttribute("aria-label"),
      selectedPassage: window.getSelection()?.toString() === "NADH and FADH2",
      nativeSelection: window.getSelection()?.toString(),
      activeTag: document.activeElement?.tagName,
    }));
    await writeFile(
      join(output, `${mode.id}-escape-state.json`),
      JSON.stringify(observations.escapeFocusSettled, null, 2),
    );
    await expect(editor).toBeFocused();
    expect(observations.escapeFocusSettled.selectedPassage).toBe(true);
    observations.editorIdentity = await editor.evaluate((node) => ({
      sameDOM: node === window.__sourceEditorBefore,
      sameHTML: node.innerHTML === window.__sourceHTMLBefore,
      pmSelection: node.pmViewDesc?.view?.state?.selection
        ? {
            from: node.pmViewDesc.view.state.selection.from,
            to: node.pmViewDesc.view.state.selection.to,
          }
        : null,
    }));
    expect(observations.editorIdentity.sameDOM).toBe(true);
    expect(observations.editorIdentity.sameHTML).toBe(true);
    await mark(page, "clean-outside");
    dialog = await open(page);
    await stable(dialog);
    await page.getByRole("button", { name: "Study", exact: true }).click();
    observations.outsideAfterClick = await sample(page, ".source-card-popover");
    expect(observations.outsideAfterClick).toMatchObject({
      present: true,
      inert: true,
      ariaHidden: "true",
    });
    await page.getByRole("button", { name: "Study", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(editor).toBeVisible();
    await expect(
      page.getByRole("status").filter({
        hasText: "Finish or cancel this card draft before leaving.",
      }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Your latest changes are only in this window." }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Study", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Motion audit deck", exact: true }),
    )
      .toBeVisible()
      .catch(async () => {
        await expect(
          page.getByRole("button", { name: /Motion audit deck/ }),
        ).toBeVisible();
      });
    await page.getByRole("button", { name: /^All notes/ }).click();
    await page
      .getByRole("button", { name: /Synthetic source motion audit/ })
      .first()
      .click();
    await expect(editor).toBeVisible();
    observations.freshNavigation = true;
    await mark(page, "dirty-escape");
    dialog = await open(page);
    await stable(dialog);
    await dialog
      .getByRole("textbox", { name: "Front", exact: true })
      .fill("User-authored audit question");
    await dialog
      .getByRole("textbox", { name: "Front", exact: true })
      .press("Escape");
    const discard = page.getByRole("dialog", {
      name: "Discard card draft?",
      exact: true,
    });
    await expect(discard).toBeVisible();
    await discard
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await expect(
      dialog.getByRole("textbox", { name: "Front", exact: true }),
    ).toHaveValue("User-authored audit question");
    observations.dirtyKept = true;
    await mark(page, "commit");
    await dialog.getByRole("button", { name: "Add card", exact: true }).click();
    observations.commitClosing = await sample(page, ".source-card-popover");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".study-source-annotation")).toHaveCount(1);
    const meta = await page.evaluate(() =>
      window.__studySourceFixture.metadata(),
    );
    observations.actualCounts = {
      entries: meta.entries.length,
      cards: meta.cards.length,
      notes: meta.notes.length,
    };
    expect(observations.actualCounts.entries).toBe(1);
    expect(observations.actualCounts.cards).toBe(1);
    await expect(page.locator(".source-card-notice")).toContainText(
      "Card added to Motion audit deck",
    );
    observations.annotation = await sample(page, ".study-source-annotation");
    await stable(page.locator(".source-card-notice"));
    await page.screenshot({ path: join(output, `${mode.id}-added.png`) });
    await mark(page, "toast-dismiss");
    await page
      .getByRole("button", { name: "Dismiss card notification", exact: true })
      .click();
    observations.toastClosing = await sample(page, ".source-card-notice");
    await expect(page.locator(".source-card-notice")).toHaveCount(0);
    await mark(page, "narrow");
    await page.setViewportSize({ width: 390, height: 844 });
    dialog = await open(page);
    await stable(dialog);
    observations.narrow = await sample(page, ".source-card-popover");
    await dialog
      .getByRole("button", { name: "Add card", exact: true })
      .scrollIntoViewIfNeeded();
    observations.narrowActions = {
      cancel: await dialog
        .getByRole("button", { name: "Cancel", exact: true })
        .isVisible(),
      add: await dialog
        .getByRole("button", { name: "Add card", exact: true })
        .isVisible(),
      overflow: await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    };
    await page.screenshot({ path: join(output, `${mode.id}-narrow.png`) });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const trace = await page.evaluate(() => window.__sourceAudit);
    observations.expected = {
      reduced,
      popEnterMs: reduced ? 150 : 200,
      popExitMs: reduced ? 150 : 140,
      underlineMs: reduced ? 0 : 150,
    };
    observations.measured = {
      enterEnds: trace.events.filter(
        (event) =>
          event.phase === "clean-escape" &&
          event.kind === "animationend" &&
          !event.classes.includes("source-closing"),
      ),
      escapeExitEnds: trace.events.filter(
        (event) =>
          event.phase === "clean-escape" &&
          event.kind === "animationend" &&
          event.classes.includes("source-closing"),
      ),
      outsideExitEnds: trace.events.filter(
        (event) =>
          event.phase === "clean-outside" &&
          event.kind === "animationend" &&
          event.classes.includes("source-closing"),
      ),
      underlineEnds: row(trace.events, "source-mark-in"),
      toastExitEnds: trace.events.filter(
        (event) =>
          event.phase === "toast-dismiss" && event.kind === "animationend",
      ),
    };
    const enter = observations.measured.enterEnds.find(
      (event) => event.name === (reduced ? "source-fade" : "source-pop-in"),
    );
    expect(enter).toBeTruthy();
    expect(enter.elapsed).toBeCloseTo(reduced ? 0.15 : 0.2, 3);
    const exit = observations.measured.escapeExitEnds.find(
      (event) =>
        event.name === (reduced ? "source-fade-out" : "source-pop-out"),
    );
    expect(exit).toBeTruthy();
    expect(exit.elapsed).toBeCloseTo(reduced ? 0.15 : 0.14, 3);
    const outsideExit = observations.measured.outsideExitEnds.find(
      (event) =>
        event.name === (reduced ? "source-fade-out" : "source-pop-out"),
    );
    expect(outsideExit).toBeTruthy();
    expect(outsideExit.elapsed).toBeCloseTo(reduced ? 0.15 : 0.14, 3);
    expect(observations.annotation.animation).toBe(
      reduced ? "none" : "source-mark-in",
    );
    if (!reduced)
      expect(observations.measured.underlineEnds[0].elapsed).toBeCloseTo(
        0.15,
        3,
      );
    expect(observations.narrowActions.overflow).toBe(false);
    expect(errors).toEqual([]);
    runs.push({ ...observations, trace, pageErrors: errors });
    await writeFile(
      join(output, `${mode.id}.json`),
      JSON.stringify(runs.at(-1), null, 2),
    );
    await context.close();
  }
  const after = await hashes();
  const drift = before.filter(
    (item, index) => item.sha256 !== after[index].sha256,
  );
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        qualification:
          "Disposable synthetic identity; actual production Workspace/editor/source writer/WASM/IDB; no backend login/native input claim",
        before,
        after,
        drift,
        runs: runs.map(({ trace, ...run }) => run),
      },
      null,
      2,
    ),
  );
  if (drift.length)
    throw Error("Source drift: evidence is not a single candidate");
  console.log(
    `Source motion audit captured ${runs.length} policy contexts in ${output}`,
  );
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: join(output, "failure.png") });
    await writeFile(
      join(output, "failure-state.json"),
      JSON.stringify(
        await activePage.evaluate(() => ({
          trace: window.__sourceAudit,
          body: document.body.innerText,
        })),
        null,
        2,
      ),
    );
  }
  await writeFile(join(output, "failure.txt"), String(error));
  await writeFile(
    join(output, "failure-hashes.json"),
    JSON.stringify({ before, after: await hashes() }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
