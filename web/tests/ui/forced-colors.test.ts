import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styleFiles = [
  "app.css",
  "study.css",
  "journal.css",
  "study-settings.css",
  "sample-workspace.css",
] as const;

/** Vitest rewrites `import.meta.url`, so locate the styles from the cwd. */
const found = [
  resolve(process.cwd(), "src/styles"),
  resolve(process.cwd(), "web/src/styles"),
].find((directory) => existsSync(join(directory, "app.css")));
if (found === undefined) throw new Error(`No src/styles under ${process.cwd()}`);
const stylesRoot: string = found;

function read(file: (typeof styleFiles)[number]): string {
  return readFileSync(join(stylesRoot, file), "utf8");
}

/** Every `@media (forced-colors: active)` block, in source order. */
function forcedBlocks(css: string): string[] {
  const blocks: string[] = [];
  const opening = /@media\s*\(forced-colors:\s*active\)\s*\{/g;
  for (let match = opening.exec(css); match; match = opening.exec(css)) {
    let depth = 1;
    let index = opening.lastIndex;
    while (index < css.length && depth > 0) {
      const character = css[index];
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      index += 1;
    }
    blocks.push(css.slice(match.index, index));
  }
  return blocks;
}

function forcedRules(file: (typeof styleFiles)[number]): string {
  return forcedBlocks(read(file)).join("\n");
}

/** The stylesheet with forced-colours blocks and comments removed. */
function outsideForcedColors(file: (typeof styleFiles)[number]): string {
  const css = read(file);
  return forcedBlocks(css)
    .reduce((rest, block) => rest.replace(block, ""), css)
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const systemColor =
  /:\s*[^;{}]*\b(?:Canvas|CanvasText|ButtonFace|ButtonText|Highlight|HighlightText|GrayText|LinkText|Field|FieldText)\b/;
const literalColor = /#[0-9a-fA-F]{3,8}\b/;

describe("forced-colors styles", () => {
  it("declares a forced-colors query in every stylesheet that carries a fix", () => {
    for (const file of styleFiles) {
      expect(forcedBlocks(read(file)), file).not.toHaveLength(0);
    }
  });

  it("restores control boundaries and current-item cues", () => {
    const rules = forcedRules("app.css");
    // Transparent/translucent fills are replaced, so buttons need a real edge.
    expect(rules).toMatch(
      /button\s*\{[^}]*border:\s*1px solid ButtonText/,
    );
    // Current and pressed controls use the theme's selection pair.
    expect(rules).toMatch(/\.nav\.active[\s\S]*background:\s*Highlight/);
    expect(rules).toMatch(/color:\s*HighlightText/);
    expect(rules).toMatch(/forced-color-adjust:\s*none/);
    // The translucent moving highlight is retired; the item itself carries it.
    expect(rules).toMatch(
      /\.sidebar-selection-highlight\s*\{[^}]*display:\s*none/,
    );
    // The avatar's coloured disc is gone without an outline.
    expect(rules).toMatch(
      /\.sidebar-account-avatar\s*\{[^}]*border:\s*1px solid CanvasText/,
    );
    // Menus draw their edge with a shadow, which forced colours remove.
    expect(rules).toMatch(
      /\.action-menu[\s\S]*border:\s*1px solid CanvasText/,
    );
    expect(rules).toMatch(
      /\.slash-menu[\s\S]*border:\s*1px solid CanvasText/,
    );
    // Custom toggles lose their fills; the native control always shows state.
    expect(rules).toMatch(
      /\.settings-row input\[type="checkbox"\]\s*\{[^}]*appearance:\s*auto/,
    );
  });

  it("keeps chart bars, the study toast and the journal tick visible", () => {
    const study = forcedRules("study.css");
    expect(study).toMatch(
      /\.study-toast\s*\{[^}]*border:\s*1px solid CanvasText/,
    );
    expect(study).toMatch(
      /\.study-forecast i\s*\{[^}]*forced-color-adjust:\s*none[^}]*background:\s*CanvasText/,
    );
    expect(study).toMatch(
      /\.study-forecast > div:first-child i\s*\{[^}]*background:\s*Highlight/,
    );

    const journal = forcedRules("journal.css");
    expect(journal).toMatch(
      /\.journal-check\s*\{[^}]*background:\s*HighlightText/,
    );
    expect(journal).toMatch(
      /\.journal-check-mark\s*\{[^}]*border-color:\s*Highlight/,
    );
    expect(journal).toMatch(
      /button\[aria-current="date"\]\s*\{[^}]*outline:\s*2px solid CanvasText/,
    );

    expect(forcedRules("study-settings.css")).toMatch(
      /input\[type="checkbox"\]\s*\{[^}]*appearance:\s*auto/,
    );
    expect(forcedRules("sample-workspace.css")).toMatch(
      /\.sample-nav\.active\s*\{[^}]*background:\s*Highlight/,
    );
  });

  it("uses only system colours inside the forced-colors queries", () => {
    for (const file of styleFiles) {
      expect(forcedRules(file), file).not.toMatch(literalColor);
    }
  });

  it("changes nothing outside the forced-colors queries", () => {
    // Normal Light, Dark and Dim rendering must stay exactly as designed.
    for (const file of styleFiles) {
      const rest = outsideForcedColors(file);
      expect(rest, file).not.toMatch(systemColor);
      expect(rest, file).not.toMatch(/forced-color-adjust/);
      expect(rest, file).not.toMatch(/@media\s*\(forced-colors/);
    }
  });
});
