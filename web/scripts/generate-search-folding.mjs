// Rebuild the reviewed Unicode data adaptation from explicit local inputs.
// This script never downloads or executes upstream content.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const dataSha = "ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183";
const licenseSha = "e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96";
const inputs = process.argv.slice(2);
if (inputs.length !== 2) throw new Error("Pass the reviewed CaseFolding.txt and LICENSE.txt paths.");
const [data, license] = await Promise.all(inputs.map(path => readFile(path)));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
if (digest(data) !== dataSha || digest(license) !== licenseSha) throw new Error("Unicode source differs from the reviewed pin.");
const rows = new Map();
for (const line of data.toString("utf8").split(/\r?\n/)) {
  const body = line.split("#")[0].trim();
  if (!body) continue;
  const fields = body.split(";").map(value => value.trim());
  if (!/^[0-9A-F]{4,6}$/.test(fields[0]) || !["C", "F", "S", "T"].includes(fields[1])) throw new Error("Unexpected Unicode record.");
  if (fields[1] !== "C" && fields[1] !== "F") continue;
  const point = Number.parseInt(fields[0], 16);
  const targets = fields[2].split(" ").map(value => {
    if (!/^[0-9A-F]{4,6}$/.test(value)) throw new Error("Unexpected mapping.");
    const result = Number.parseInt(value, 16);
    if (result > 0x10ffff || (result >= 0xd800 && result <= 0xdfff)) throw new Error("Invalid mapping scalar.");
    return result;
  });
  if (point > 0x10ffff || rows.has(point) || targets.length > 3) throw new Error("Unexpected mapping bounds.");
  rows.set(point, String.fromCodePoint(...targets));
}
let maxUnits = 2;
for (const value of rows.values()) maxUnits = Math.max(maxUnits, value.length);
const table = [...rows].sort((a, b) => a[0] - b[0]).map(([point, value]) => `  0x${point.toString(16)}: ${JSON.stringify(value)},`).join("\n");
const output = `/* Generated from Unicode CaseFolding-17.0.0, statuses C+F (default full folding).
 * Copyright © 2025 Unicode, Inc. Unicode License V3; accompanying notice:
 * public/licenses/Unicode-3.0.txt. Source https://www.unicode.org/Public/17.0.0/ucd/CaseFolding.txt
 * SHA256 ${dataSha}. Rebuild with scripts/generate-search-folding.mjs.
 */
export const UNICODE_CASE_FOLDING_VERSION = "17.0.0";
export const MAX_CASE_FOLD_UTF16_UNITS = ${maxUnits};
const mapping: Readonly<Record<number, string>> = Object.freeze({
${table}
});
/** One code point only. Unknown values, including stored lone UTF16 units,
 * retain their exact identity. Query well-formedness is checked separately. */
export function foldCodePoint(point: number): string {
  if (!Number.isInteger(point) || point < 0 || point > 0x10ffff) throw new RangeError("Invalid code point.");
  return mapping[point] ?? String.fromCodePoint(point);
}
`;
await mkdir(new URL("../src/search/", import.meta.url), { recursive: true });
await mkdir(new URL("../public/licenses/", import.meta.url), { recursive: true });
await writeFile(new URL("../src/search/unicodeCaseFolding.ts", import.meta.url), output);
await writeFile(new URL("../public/licenses/Unicode-3.0.txt", import.meta.url), license);
await writeFile(new URL("../src/search/unicode-provenance.json", import.meta.url), JSON.stringify({
  version: "17.0.0", kind: "default full case folding, C+F; no Turkic override",
  source: "https://www.unicode.org/Public/17.0.0/ucd/CaseFolding.txt", sourceSha256: dataSha,
  license: "Unicode-3.0", licenseSource: "https://www.unicode.org/license.txt", licenseSha256: licenseSha,
  notice: "public/licenses/Unicode-3.0.txt", generatedMappings: rows.size,
  generatedSha256: digest(Buffer.from(output)), generator: "scripts/generate-search-folding.mjs",
}, null, 2) + "\n");
console.log(`Generated ${rows.size} reviewed Unicode17 mappings; maximum ${maxUnits} UTF16 units.`);
