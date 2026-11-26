import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("slash options and study exit have 44px targets on phones", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const css = ["app.css", "study.css"].map((file) => readFileSync(`src/styles/${file}`, "utf8")).join("\n");
  await page.setContent(`<style>${css}\n*, *::before, *::after { animation: none !important; transition: none !important; }</style><div class="slash-menu"><button>Paragraph</button></div><section class="study-view"><header class="study-review-heading"><button aria-label="End session">×</button></header></section>`);
  for (const name of ["Paragraph", "End session"]) {
    const box = await page.getByRole("button", { name }).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});
