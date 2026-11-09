import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/integration',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    baseURL: process.env.NOTES_E2E_URL ?? 'http://127.0.0.1:5176',
    viewport: { width: 1160, height: 700 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
    screenshot: 'only-on-failure',
    trace: 'off',
  },
});
