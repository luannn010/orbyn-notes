import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("grid card aligns its content and keeps the designed gap", async ({ page }) => {
  const css = readFileSync("src/styles/app.css", "utf8");
  await page.setContent(`<style>${css}</style><div class="grid"><div class="note-row"><button class="note-open"><h2>Short</h2><p>Preview</p><span class="metadata">Today</span></button></div></div>`);
  const metrics = await page.locator(".note-open").evaluate((card) => {
    const [title, preview, footer] = Array.from(card.children, (child) => child.getBoundingClientRect());
    const box = card.getBoundingClientRect();
    return { left: title!.left - box.left, width: footer!.width, innerWidth: box.width - 28, gap: preview!.top - title!.bottom };
  });
  expect(metrics.left).toBe(14);
  expect(metrics.width).toBe(metrics.innerWidth);
  expect(metrics.gap).toBe(8);
});
