// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  new URL("../../src/styles/app.css", import.meta.url),
  "utf8",
);

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`Missing rule: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("library-grid card composition (design frame library-grid)", () => {
  it("uses a raised surface with no border", () => {
    const card = rule(".grid .note-row");
    expect(card).toContain("background: var(--raise)");
    expect(card).toMatch(/border:\s*0\b/);
    expect(card).not.toMatch(/border:\s*1px/);
    expect(card).toContain("border-radius: 12px");
  });

  it("stacks the card as a column with 14px padding and an 8px gap", () => {
    const card = rule(".grid .note-open");
    expect(card).toContain("padding: 14px");
    expect(card).not.toContain("padding: 16px");
    expect(card).toContain("display: flex");
    expect(card).toContain("flex-direction: column");
    expect(card).toContain("gap: 8px");
    expect(card).toContain("min-height: 150px");
  });

  it("pins the footer to the card's bottom edge", () => {
    expect(rule(".grid .metadata")).toContain("margin-top: auto");
  });
});
