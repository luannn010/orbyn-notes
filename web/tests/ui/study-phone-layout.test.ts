import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// jsdom does not run layout, so this pins the phone composition rules from
// the approved st-home-phone and st-deck-phone frames in the stylesheet.
const css = readFileSync("src/styles/study.css", "utf8").replace(/\r\n/g, "\n");
const phone = css.slice(css.indexOf("@media (max-width: 700px)"));

describe("Study phone layout", () => {
  it("stacks table rows with metadata under the title, not five columns", () => {
    expect(phone).toMatch(
      /\.study-table,\s*\.study-table tbody \{\s*display: block;/,
    );
    expect(phone).toMatch(
      /\.study-table tr \{[^}]*display: flex;[^}]*flex-wrap: wrap;/,
    );
    expect(phone).toMatch(/\.study-table td:first-child \{\s*flex: 1 1 100%;/);
    expect(phone).toContain(`content: "${String.fromCharCode(92)}00b7";`);
  });

  it("keeps column headers for assistive tech and the card menu reachable", () => {
    expect(phone).toMatch(
      /\.study-table thead \{[^}]*clip-path: inset\(50%\);/,
    );
    expect(phone).toMatch(
      /\.study-table td:last-child:has\(\.menu-anchor\) \{[^}]*position: absolute;/,
    );
  });

  it("makes the Study action a full-width, first large action", () => {
    expect(phone).toMatch(
      /\.study-actions > \.primary \{[^}]*order: -1;[^}]*flex: 1 1 100%;[^}]*height: 40px;[^}]*border-radius: 12px;[^}]*font-size: 13\.5px;/,
    );
  });

  it("leaves the desktop table rules untouched outside the phone query", () => {
    const desktop = css.slice(0, css.indexOf("@media (max-width: 700px)"));
    expect(desktop).toContain("table-layout: fixed;");
    expect(desktop).not.toMatch(/\.study-table tr \{[^}]*display: flex/);
  });
});
