import { test as base, chromium, expect, type Page } from '@playwright/test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const launchOptions = {
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  headless: true,
  viewport: { width: 1160, height: 700 },
  baseURL: process.env.NOTES_E2E_URL ?? 'http://127.0.0.1:5176',
};
const test = base.extend<{ profile: string }>({
  profile: async ({}, use) => {
    const profile = await mkdtemp(join(tmpdir(), 'notes-beta-e2e-'));
    try { await use(profile); } finally { await rm(profile, { recursive: true, force: true }); }
  },
  context: async ({ profile }, use) => {
    const context = await chromium.launchPersistentContext(profile, launchOptions);
    context.setDefaultTimeout(10_000);
    try { await use(context); } finally { await context.close(); }
  },
});

const invite = process.env.NOTES_E2E_INVITE;
const mailbox = process.env.NOTES_E2E_MAILBOX_DIR;
test.skip(!invite || !mailbox, 'Requires a local engine, an unused synthetic invite and a TLS test mailbox.');

async function verificationCode(email: string) {
  let code = '';
  await expect.poll(async () => {
    for (const name of await readdir(mailbox!)) {
      if (!name.endsWith('.eml')) continue;
      const body = await readFile(join(mailbox!, name), 'utf8');
      if (!body.includes(email)) continue;
      const match = body.match(/Subject: Your Orbyn code is ([A-Z0-9]{4}-[A-Z0-9]{4})/i);
      if (match) { code = match[1]!; return true; }
    }
    return false;
  }, { timeout: 40_000, message: 'Real engine email must reach the local TLS mailbox' }).toBe(true);
  return code;
}

async function signIn(page: Page, email: string, password: string) {
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#main').getByRole('button', { name: 'New note', exact: true }).first()).toBeVisible();
}

test('invited account can write, reopen offline, export and lock its local library', async ({ page, context, profile }, testInfo) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    const metrics = { lcp: 0, cls: 0, shifts: [] as unknown[] };
    (window as unknown as { __notesPerf: typeof metrics }).__notesPerf = metrics;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) metrics.lcp = entry.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node?: Element; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] };
        if (!shift.hadRecentInput) {
          metrics.cls += shift.value;
          metrics.shifts.push({ startTime: shift.startTime, value: shift.value, sources: shift.sources?.map(source => ({ tag: source.node?.tagName, className: source.node?.getAttribute('class'), previousRect: source.previousRect.toJSON(), currentRect: source.currentRect.toJSON() })) });
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  const origin = new URL(process.env.NOTES_E2E_URL ?? 'http://127.0.0.1:5176');
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(origin.hostname);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return route.abort('blockedbyclient');
    return route.continue();
  });
  const email = `notes-${crypto.randomUUID()}@example.test`;
  const password = `Synthetic-${crypto.randomUUID()}!`;
  const errors: string[] = [];
  page.on('pageerror', error => { errors.push(error.message); console.error('Notes runtime error:', error.message); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Invite code', { exact: true }).fill(invite!);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.getByLabel('Verification code', { exact: true }).fill(await verificationCode(email));
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('#main').getByRole('button', { name: 'New note', exact: true }).first().click();
  await page.getByLabel('Note title', { exact: true }).fill('Beta persistence proof');
  await page.getByRole('textbox', { name: 'Note content', exact: true }).fill('Encrypted local content survives offline reload.');
  await page.getByLabel('Note tags, separated by commas').fill('beta-proof');
  await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Back to notes/ }).click();
  await expect(page.getByText('Beta persistence proof', { exact: true })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: /beta-proof/ }).click();
  await expect(page.locator('.note-row')).toHaveCount(1);
  await page.getByRole('button', { name: /All notes/ }).click();
  await page.getByRole('button', { name: 'Grid view', exact: true }).click();
  await expect(page.locator('.note-collection')).toHaveClass(/grid/);
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await page.getByText('Beta persistence proof', { exact: true }).click();
  await page.getByRole('button', { name: 'Note menu', exact: true }).click();
  await page.getByRole('button', { name: 'Move to Trash', exact: true }).click();
  await page.getByRole('button', { name: /^Trash/ }).click();
  await expect(page.getByText('Beta persistence proof', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Trash is empty' })).toBeVisible();
  await page.getByRole('button', { name: /All notes/ }).click();
  if (process.env.NOTES_E2E_SCALE === '1') {
    for (let start = 0; start < 999; start += 100) {
      const count = Math.min(100, 999 - start);
      await page.locator('input[type=file]').setInputFiles(Array.from({ length: count }, (_, offset) => {
        const i = start + offset;
        return { name: `scale-${String(i).padStart(4, '0')}.md`, mimeType: 'text/markdown',
          buffer: Buffer.from(`# Scale note ${String(i).padStart(4, '0')}\n\nSynthetic performance library. No personal data.\n`) };
      }));
      await expect(page.getByRole('dialog').getByRole('button', { name: 'Import remaining', exact: true })).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: 'Import remaining', exact: true }).click();
      await expect(page.locator('.note-row')).toHaveCount(1 + start + count, { timeout: 45_000 });
    }
  }
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Beta persistence proof', { exact: true })).toBeVisible();
  if (process.env.NOTES_E2E_SCALE === '1') {
    await expect(page.locator('.note-row')).toHaveCount(1000);
    await page.screenshot({ path: testInfo.outputPath('library-1000.png') });
    const metrics = await page.evaluate(() => (window as unknown as { __notesPerf: { lcp:number;cls:number } }).__notesPerf);
    await writeFile(testInfo.outputPath('performance.json'), JSON.stringify({ profile:'Chromium, 1160x700, no CPU throttle, cached shell, 1000 encrypted local notes', ...metrics }, null, 2));
    await testInfo.attach('offline-library-performance', { body: JSON.stringify({ profile:'Chromium, 1160x700, no CPU throttle, cached shell, 1000 encrypted local notes', ...metrics }), contentType:'application/json' });
    expect(metrics.lcp).toBeGreaterThan(0);
    expect(metrics.lcp).toBeLessThan(2500);
    expect(metrics.cls).toBe(0);
  }
  await context.setOffline(false);
  await page.getByLabel('Search notes', { exact: true }).fill('Beta persistence proof');
  await expect(page.locator('.note-row')).toHaveCount(1);
  await page.getByLabel('Search notes', { exact: true }).fill('');
  await page.getByText('Beta persistence proof', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toContainText('survives offline reload');
  await page.getByRole('button', { name: 'Note menu', exact: true }).click();
  await page.getByRole('button', { name: 'Export Markdown', exact: true }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: /Download/ }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  await page.getByRole('button', { name: /Back to notes/ }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('dialog', { name: 'Sign out of Notes?', exact: true }).getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Beta persistence proof', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await signIn(page, email, password);
  await expect(page.getByText('Beta persistence proof', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
  const restarted = await chromium.launchPersistentContext(profile, launchOptions);
  try {
    await restarted.setOffline(true);
    const reopened = await restarted.newPage();
    await reopened.goto('/');
    await expect(reopened.getByText('Beta persistence proof', { exact: true })).toBeVisible();
    await reopened.getByText('Beta persistence proof', { exact: true }).click();
    await expect(reopened.getByRole('textbox', { name: 'Note content', exact: true })).toContainText('survives offline reload');
  } finally { await restarted.close(); }
});
