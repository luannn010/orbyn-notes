import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// jsdom exposes the CSS object model, not the applied result of a media query.
// The rendered proof for this fix is the Chromium run at 390 and 1280 in the
// issue evidence; this test guards the stylesheet rule from being lost.
const stylesheet = readFileSync("src/styles/study.css", "utf8");
const PHONE_BREAKPOINT = "max-width: 700px";

const style = document.createElement("style");
style.textContent = stylesheet;
document.head.append(style);
const sheet = style.sheet;
if (!sheet) throw new Error("study.css did not parse as a stylesheet");
const rules = Array.from(sheet.cssRules);

function isMediaRule(rule: CSSRule): rule is CSSMediaRule {
  return rule.constructor.name === "CSSMediaRule";
}
function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
  return rule.constructor.name === "CSSStyleRule";
}
function selectors(rule: CSSStyleRule) {
  return rule.selectorText.split(",").map((selector) => selector.trim());
}
function display(rule: CSSStyleRule) {
  return rule.style.getPropertyValue("display").trim();
}
function mentionsToast(rule: CSSStyleRule) {
  return selectors(rule).some((selector) => selector.includes(".study-toast"));
}

const phoneRules = rules
  .filter(isMediaRule)
  .filter((rule) => rule.conditionText.includes(PHONE_BREAKPOINT))
  .flatMap((rule) => Array.from(rule.cssRules))
  .filter(isStyleRule);

it("hides the keyboard shortcut inside the phone media query", () => {
  expect(
    rules
      .filter(isMediaRule)
      .some((rule) => rule.conditionText.includes(PHONE_BREAKPOINT)),
  ).toBe(true);
  const shortcut = phoneRules.filter((rule) =>
    selectors(rule).includes(".study-toast kbd"),
  );
  expect(shortcut).toHaveLength(1);
  expect(display(shortcut[0]!)).toBe("none");
});

it("leaves the rest of the phone toast styled and visible", () => {
  const toastRules = phoneRules.filter(mentionsToast);
  expect(toastRules.length).toBeGreaterThan(0);
  for (const rule of toastRules) {
    if (selectors(rule).includes(".study-toast kbd")) continue;
    expect(display(rule), rule.selectorText).not.toBe("none");
  }
  const margins = toastRules.filter(
    (rule) => rule.selectorText === ".study-toast",
  );
  expect(
    margins.some(
      (rule) => rule.style.getPropertyValue("margin-left") === "16px",
    ),
  ).toBe(true);
  expect(
    margins.some(
      (rule) => rule.style.getPropertyValue("margin-right") === "16px",
    ),
  ).toBe(true);
});

it("keeps the shortcut rendered at desktop widths", () => {
  const base = rules.filter(isStyleRule);
  const baseShortcut = base.filter((rule) =>
    selectors(rule).includes(".study-toast kbd"),
  );
  expect(baseShortcut).toHaveLength(1);
  expect(display(baseShortcut[0]!)).not.toBe("none");
  const toast = base.find((rule) => rule.selectorText === ".study-toast");
  expect(toast?.style.getPropertyValue("display")).toBe("flex");
  for (const rule of base) {
    if (!selectors(rule).includes(".study-toast kbd")) continue;
    expect(display(rule)).not.toBe("none");
  }
});
