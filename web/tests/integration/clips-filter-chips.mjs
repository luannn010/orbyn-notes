// Issue #66. Run against Vite with NOTES_PREVIEW_URL; evidence stays outside Git.
// Design revision 9b69f7b, Notes blob 706a8d07, frame read-later, .filters/.pill.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const output = process.env.NOTES_UI_OUTPUT ?? "test-results/clips-filter-chips";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1160, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    `${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5194"}/tests/integration/clips-browser.html`,
  );
  await page.getByRole("button", { name: "Clips", exact: true }).click();
  const filters = page.getByRole("group", { name: "Filter clips" });
  const filter = (name) =>
    filters.getByRole("button", { name: new RegExp(`^${name} `) });
  async function save(title, suffix) {
    await page
      .getByRole("button", { name: "Save a link", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Save a link",
      exact: true,
    });
    await dialog.getByLabel("Clip URL").fill(`https://example.test/${suffix}`);
    await dialog.getByLabel("Title (optional)").fill(title);
    await dialog
      .getByRole("button", { name: "Save link", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Link saved" }),
    ).toBeVisible();
  }
  await save("Synthetic unread", "unread");
  await save("Synthetic later", "later");
  await page
    .locator(".clip-row")
    .filter({ hasText: "Synthetic later" })
    .click();
  await page.getByRole("button", { name: "Read later", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Added to read later" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark read", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Marked read" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "← Back to clips", exact: true })
    .click();
  await save("Synthetic archived", "archived");
  await page
    .locator(".clip-row")
    .filter({ hasText: "Synthetic archived" })
    .click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Clip archived" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "← Back to clips", exact: true })
    .click();
  for (const [name, title, count] of [
    ["Unread", "Synthetic unread", 1],
    ["Read later", "Synthetic later", 1],
    ["Archived", "Synthetic archived", 1],
    ["All", "", 2],
  ]) {
    await filter(name).click();
    await expect(filter(name)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".clip-row")).toHaveCount(count);
    if (title) await expect(page.locator(".clip-row")).toContainText(title);
  }
  await expect(filters.getByRole("button")).toHaveText([
    "All2",
    "Unread1",
    "Read later1",
    "Archived1",
  ]);
  for (const theme of ["light", "dark", "dim"]) {
    for (const width of [1160, 768, 600, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      // A keyboard event establishes :focus-visible, then exercise native activation.
      await filter("All").focus();
      await page.keyboard.press("Tab");
      await expect(filter("Unread")).toBeFocused();
      await page.keyboard.press("Space");
      await expect(filter("Unread")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".clip-row")).toContainText("Synthetic unread");
      // Move the pointer away so hover cannot mask the base token roles.
      await page.mouse.move(0, 0);
      await page.waitForTimeout(180); // Finish the existing 150ms color transition.
      const measurement = await filters.evaluate((group) => {
        const style = getComputedStyle(group);
        const resolve = (token) => {
          const probe = document.createElement("i");
          probe.style.color = `var(--${token})`;
          group.append(probe);
          const value = getComputedStyle(probe).color;
          probe.remove();
          return value;
        };
        const bounds = group.getBoundingClientRect();
        return {
          padding: style.padding,
          gap: style.gap,
          overflow: document.documentElement.scrollWidth > innerWidth,
          chips: [...group.querySelectorAll("button")].map((button) => {
            const css = getComputedStyle(button),
              rect = button.getBoundingClientRect();
            const selected = button.getAttribute("aria-pressed") === "true";
            return {
              height: rect.height,
              padding: css.padding,
              gap: css.gap,
              fontSize: css.fontSize,
              background: css.backgroundColor,
              color: css.color,
              countColor: getComputedStyle(button.querySelector("span")).color,
              expectedBackground: resolve(selected ? "btn" : "raise"),
              expectedColor: resolve(selected ? "btnt" : "t2"),
              contained: rect.left >= bounds.left && rect.right <= bounds.right,
              focused: button.matches(":focus-visible"),
              outline: css.outlineStyle,
              outlineWidth: css.outlineWidth,
            };
          }),
        };
      });
      // Preserve the existing 16px mobile content gutter below 650px.
      expect(measurement.padding).toBe(
        width <= 650 ? "4px 16px 10px" : "4px 28px 10px",
      );
      expect(measurement.gap).toBe("6px");
      expect(measurement.overflow).toBe(false);
      for (const chip of measurement.chips) {
        expect(chip.height).toBe(28);
        expect(chip.padding).toBe("0px 11px");
        expect(chip.gap).toBe("6px");
        expect(chip.fontSize).toBe("12px");
        expect(chip.background).toBe(chip.expectedBackground);
        expect(chip.color).toBe(chip.expectedColor);
        expect(chip.countColor).toBe(chip.color);
        expect(chip.contained).toBe(true);
        if (chip.focused) {
          expect(chip.outline).toBe("solid");
          expect(chip.outlineWidth).toBe("2px");
        }
      }
      expect(measurement.chips.some((chip) => chip.focused)).toBe(true);
      results.push({ theme, width, ...measurement });
      if ([1160, 390, 320].includes(width))
        await page.screenshot({ path: `${output}/${theme}-${width}.png` });
    }
  }
  // Stress only the rendered label, without inventing a production filter or state.
  await filter("Read later").evaluate((button) => {
    button.firstChild.textContent =
      "A deliberately long synthetic filter label that must stay reachable";
  });
  expect(
    await filters.evaluate((group) =>
      [...group.querySelectorAll("button")].every(
        (button) =>
          button.getBoundingClientRect().right <=
          group.getBoundingClientRect().right,
      ),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: `${output}/dim-320-long-label.png` });
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        designRevision: "9b69f7bfb2e84dd2ed22223adfa34833fb085045",
        designBlob: "706a8d07e5ccfb77850f4a490ab38e0c90a31a04",
        frame: "read-later",
        adapter:
          "Production Clips facade/WASM/IndexedDB; synthetic account only",
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    "Clips filter geometry, themes, keyboard and real-adapter filtering passed",
  );
} finally {
  await browser.close();
}
