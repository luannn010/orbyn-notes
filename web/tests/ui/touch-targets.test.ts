import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// jsdom cannot measure rendered sizes, so this only guards the stylesheet
// contract. Real 44x44 measurements were taken in Chromium at 390x844.
const css = readFileSync("src/styles/app.css", "utf8");

function phoneTouchTargetBlock(source: string) {
  const start = source.indexOf("/* Phone tap targets:");
  expect(start).toBeGreaterThan(-1);
  const open = source.indexOf("{", source.indexOf("@media (max-width: 899px)", start));
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error("Phone touch-target media query is not closed.");
}

it("declares 44px phone touch targets in the mobile media query", () => {
  const block = phoneTouchTargetBlock(css);
  expect(block).toMatch(/min-height:\s*44px/);
  expect(block).toMatch(/min-width:\s*44px/);
  for (const selector of [
    ".account-card button",
    ".mobile-header > button",
    ".sidebar .nav",
    ".note-editor-header .menu-anchor > button",
    ".editor-format-toolbar .editor-format-icon",
    ".action-menu button",
    ".clips-view button",
    ".study-view button",
    ".journal-view .journal-actions button",
    ".new-note-tile",
  ]) {
    expect(block).toContain(selector);
  }
});
