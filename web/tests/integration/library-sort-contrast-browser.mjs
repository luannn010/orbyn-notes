import { chromium, expect } from "@playwright/test";

// Run against the local Vite server with a disposable browser profile.
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5187";
const channel = process.env.PLAYWRIGHT_CHANNEL ?? "chrome";
const browser = await chromium.launch({ channel, headless: true });

try {
  const page = await browser.newPage();
  await page.goto(`${base}/tests/integration/library-browser.html`);
  const sort = page.getByRole("combobox", { name: "Sort notes" });
  await expect(sort).toBeVisible();
  const options = sort.locator("option");
  await expect(options).toHaveText(["Edited", "Created", "Title"]);

  for (const theme of ["light", "dark", "dim"]) {
    const colors = await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      const probe = document.createElement("span");
      probe.style.cssText = "background-color: var(--main); color: var(--t1)";
      document.body.append(probe);
      const { backgroundColor, color } = getComputedStyle(probe);
      probe.remove();
      return { backgroundColor, color };
    }, theme);

    for (const option of await options.all()) {
      await expect(option).toHaveCSS(
        "background-color",
        colors.backgroundColor,
      );
      await expect(option).toHaveCSS("color", colors.color);
    }
  }

  await sort.press("End");
  await expect(sort).toHaveValue("title");
  await expect(sort).toBeEnabled();
  await page.reload();
  await expect(sort).toHaveValue("title");
  console.log(
    `Sort option colors and keyboard selection passed in ${channel}.`,
  );
} finally {
  await browser.close();
}
