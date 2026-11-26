import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5195";
const output = process.env.NOTES_UI_OUTPUT ?? "test-results/library-grid-real";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.NOTES_BROWSER_CHANNEL ?? "chrome",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1160, height: 800 },
  });
  await page.goto(`${base}/tests/integration/library-browser.html`);
  await page.getByRole("heading", { name: "All notes", exact: true }).waitFor();
  await page.evaluate(async () => {
    const { openNotesStore } = await import("/src/data/index.ts");
    const store = await openNotesStore({
      accountId: "33333333-3333-4333-8333-333333333333",
      deviceId: "44444444-4444-4444-8444-444444444444",
      email: "isolated-library-fixture@example.test",
      deviceState: "trusted",
    });
    for (const [title, text] of [
      ["Short", "brief"],
      [
        "Long title that extends across many words and wraps in a narrow card",
        "Long preview text ".repeat(30),
      ],
    ])
      await store.create({
        title,
        tags: [],
        document: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        },
      });
    store.close();
  });
  await page.reload();
  await page.getByRole("button", { name: "Grid view" }).click();
  const cards = page.locator(".note-collection.grid .note-open");
  await expect(cards).toHaveCount(2);
  for (const width of [1160, 390]) {
    await page.setViewportSize({ width, height: 800 });
    for (const theme of ["light", "dark", "dim"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const metrics = await cards.evaluateAll((els) =>
        els.map((el) => {
          const box = el.getBoundingClientRect(),
            row = el.closest(".note-row").getBoundingClientRect(),
            pin = el
              .closest(".note-row")
              .querySelector(".library-row-actions")
              .getBoundingClientRect(),
            title = el.querySelector("h2").getBoundingClientRect(),
            preview = el.querySelector("p").getBoundingClientRect(),
            footer = el.querySelector(".metadata").getBoundingClientRect(),
            cs = getComputedStyle(el),
            ts = getComputedStyle(el.querySelector("h2")),
            ps = getComputedStyle(el.querySelector("p"));
          return {
            title: el.querySelector("h2").textContent,
            left: title.left - box.left,
            surfaceTop: title.top - row.top,
            surfaceBottom: row.bottom - footer.bottom,
            pinLeft: pin.left,
            openRight: box.right,
            footerLeft: footer.left - box.left,
            footerRight: box.right - footer.right,
            footerBottom: box.bottom - footer.bottom,
            gap: preview.top - title.bottom,
            titleMargin: ts.margin,
            previewMargin: ps.margin,
            align: cs.alignItems,
            width: box.width,
            height: box.height,
          };
        }),
      );
      console.log(width, theme, JSON.stringify(metrics));
      for (const m of metrics) {
        expect(m.left).toBeCloseTo(14, 0);
        expect(m.surfaceTop).toBeCloseTo(14, 0);
        expect(m.surfaceBottom).toBeCloseTo(14, 0);
        expect(m.pinLeft).toBeGreaterThanOrEqual(m.openRight);
        expect(m.footerLeft).toBeCloseTo(14, 0);
        expect(m.footerRight).toBeCloseTo(14, 0);
        expect(m.footerBottom).toBeCloseTo(14, 0);
        expect(m.gap).toBeCloseTo(8, 0);
        expect(m.titleMargin).toBe("0px");
        expect(m.previewMargin).toBe("0px");
        expect(m.align).toBe("stretch");
        if (width === 390) expect(m.height).toBeGreaterThanOrEqual(44);
      }
      if (width === 390) {
        const pins = await page
          .locator(".grid .library-row-actions button")
          .evaluateAll((els) =>
            els.map((el) => ({
              width: el.getBoundingClientRect().width,
              height: el.getBoundingClientRect().height,
            })),
          );
        for (const pin of pins) {
          expect(pin.width).toBeGreaterThanOrEqual(44);
          expect(pin.height).toBeGreaterThanOrEqual(44);
        }
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          ),
        ).toBeLessThanOrEqual(1);
      }
      await page.screenshot({ path: `${output}/grid-${width}-${theme}.png` });
    }
  }
  await expect(page.getByRole("button", { name: "Grid view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
} finally {
  await browser.close();
}
