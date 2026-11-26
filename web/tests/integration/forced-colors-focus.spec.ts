import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("selected navigation keeps a visible keyboard focus outline in forced colors", async ({ page }) => {
  const css = ["app.css", "sample-workspace.css"].map((name) => readFileSync(`src/styles/${name}`, "utf8")).join("\n");
  await page.emulateMedia({ forcedColors: "active" });
  await page.setContent(`<style>${css}</style><button class="nav active">Navigation</button><button class="sample-nav active">Sample</button><span id="canvas-text" style="color: CanvasText"></span>`);
  const canvasText = await page.locator("#canvas-text").evaluate((node) => getComputedStyle(node).color);
  for (const name of ["Navigation", "Sample"]) {
    await page.keyboard.press("Tab");
    const button = page.getByRole("button", { name });
    await expect(button).toBeFocused();
    expect(await button.evaluate((node) => getComputedStyle(node).outlineColor)).toBe(canvasText);
    const outline = await button.evaluate((node) => ({ style: getComputedStyle(node).outlineStyle, width: parseFloat(getComputedStyle(node).outlineWidth) }));
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThan(0);
  }
});
