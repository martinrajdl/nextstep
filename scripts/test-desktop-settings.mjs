import { _electron as electron, expect } from '@playwright/test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';
import { startServer } from '../server/http.mjs';
import { root } from '../server/config.mjs';

const directory = mkdtempSync(join(tmpdir(), 'nextstep-desktop-settings-'));
const database = join(directory, 'local.sqlite'),
  userData = join(directory, 'profile');
const local = openStore(database);
local.create({
  company: 'Fictional local keeper',
  stage: 'interested',
  notes: 'Preserve this decision',
});
const originalJobs = local.list();
const makeCollection = (store, id, name) =>
  store.crm.apply({
    id: randomUUID(),
    title: name,
    operations: [{ type: 'create_collection', id, name, fields: [] }],
  });
makeCollection(local, 'local_contacts', 'Fictional local contacts');
const upstream = await startServer({
  port: 0,
  database: join(directory, 'self-hosted.sqlite'),
});
makeCollection(upstream.store, 'remote_contacts', 'Fictional remote contacts');
const executablePath = process.argv[2];
let app;
async function launch(initial = false) {
  const args = [
    ...(executablePath ? [] : [root]),
    ...(initial ? ['--database', database] : []),
  ];
  app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args,
    env: {
      ...process.env,
      NEXTSTEP_DB_PATH: '',
      DB_PATH: '',
      NEXTSTEP_DISABLE_UPDATES:'1', NEXTSTEP_USER_DATA: userData,
      NEXTSTEP_AGENT_CONFIG_HOME: join(directory, 'agents'),
    },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await expect(
    page.getByRole('heading', { name: 'Your workspace', exact:true }),
  ).toBeVisible();
  return page;
}
try {
  let page = await launch(true);
  await expect(page.locator('html')).toHaveAttribute('data-accent', '#777777');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const icon = await page.locator('.crm-brand img').getAttribute('src');
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu().getMenuItemById('appearance-blue').click(),
  );
  await expect(page.locator('html')).toHaveAttribute('data-accent', '#4473cf');
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('theme-dark').click());
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark');
  await expect(page.locator('.desktop-titlebar')).toHaveCount(0);
  expect((await page.locator('.crm-sidebar').boundingBox()).y).toBe(0);
  await expect(page.locator('.crm-brand img')).toHaveAttribute('src', icon);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Backend tunnel address').fill(upstream.url);
  await page
    .getByRole('button', { name: 'Connect to backend', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Fictional remote contacts',
      exact: true,
    }),
  ).toBeVisible();
  expect(new URL(page.url()).origin).not.toBe(upstream.url);
  await expect(page.locator('html')).toHaveAttribute('data-accent', '#4473cf');
  expect(await page.evaluate(() => window.nextstepDesktop.getAgents())).toEqual(
    [],
  );
  expect(
    await app.evaluate(({ BrowserWindow }) => {
      const p =
        BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return {
        sandbox: p.sandbox,
        nodeIntegration: p.nodeIntegration,
        contextIsolation: p.contextIsolation,
      };
    }),
  ).toEqual({ sandbox: true, nodeIntegration: false, contextIsolation: true });
  expect(local.list()).toEqual(originalJobs);
  expect(local.crm.collections().map((c) => c.id)).toEqual(['local_contacts']);
  await app.close();
  app = null;
  page = await launch();
  await expect(
    page.getByRole('heading', {
      name: 'Fictional remote contacts',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-accent', '#4473cf');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await upstream.close();
  await page
    .getByRole('button', { name: 'Refresh workspace', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('backend is unavailable');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Self-hosted backend');
  await page.screenshot({
    path: join(root, 'test-results/desktop-settings-self-hosted.png'),
  });
  await page
    .getByRole('button', { name: 'Use local database', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Fictional local contacts',
      exact: true,
    }),
  ).toBeVisible();
  expect(local.list()).toEqual(originalJobs);
  const saved = JSON.parse(
    readFileSync(join(userData, 'settings.json'), 'utf8'),
  );
  expect(saved).toMatchObject({
    database,
    backendUrl: null,
    accent: '#4473cf',
    theme: 'dark',
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const consent = page.getByRole('checkbox', { name: 'Share anonymous usage' });
  await expect(consent).not.toBeChecked();
  const isPackaged = await app.evaluate(({ app }) => app.isPackaged);
  // Exercise the packaged transport without ever contacting the real collector.
  await app.evaluate(({ BrowserWindow }) => {
    const originalFetch = globalThis.fetch;
    globalThis.usageTestRequests = [];
    globalThis.fetch = (url, options) => {
      if (url === 'https://nextstep-website-lemon.vercel.app/api/usage') {
        globalThis.usageTestRequests.push(JSON.parse(options.body));
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return originalFetch(url, options);
    };
    // Control foreground state without taking focus from a person's other apps.
    globalThis.usageTestFocused = false;
    BrowserWindow.getAllWindows()[0].isFocused = () => globalThis.usageTestFocused;
  });
  await consent.click();
  await expect(consent).toBeChecked();
  const optedIn = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'));
  expect(optedIn.usageAnalytics.enabled).toBe(true);
  expect(optedIn.usageAnalytics.seed).toMatch(/^[a-f0-9]{64}$/);
  expect(await app.evaluate(() => globalThis.usageTestRequests)).toEqual([]);
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.usageTestFocused = true;
    BrowserWindow.getAllWindows()[0].emit('focus');
  });
  if (isPackaged) {
    await expect.poll(() => app.evaluate(() => globalThis.usageTestRequests.length)).toBe(1);
    const [payload] = await app.evaluate(() => globalThis.usageTestRequests);
    expect(Object.keys(payload).sort()).toEqual(['dailyId', 'day', 'platform', 'schema', 'version']);
    expect(JSON.stringify(payload)).not.toContain(database);
    expect(payload.dailyId).not.toBe(optedIn.usageAnalytics.seed);
  } else expect(await app.evaluate(() => globalThis.usageTestRequests)).toEqual([]);
  await consent.click();
  await expect(consent).not.toBeChecked();
  const optedOut = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'));
  expect(optedOut.usageAnalytics).toEqual({ enabled: false });
  expect(optedOut.database).toBe(database);
  expect(optedOut.theme).toBe('dark');
  expect(local.list()).toEqual(originalJobs);
  await page.getByRole('button', { name: 'Light mode', exact: true }).click();
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu().getMenuItemById('appearance-neutral').click(),
  );
  await expect(page.locator('html')).toHaveAttribute('data-accent', '#777777');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({
    path: join(root, 'test-results/desktop-composable.png'),
  });
  console.log(
    'Desktop settings passed: persistent appearance, sandboxed UI, self-hosted backend and offline handling, optional usage with private transport stub, and exactly preserved local data.',
  );
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    console.error('Desktop settings failure state:', {
      url: page.url(),
      text: await page.locator('body').innerText(),
    });
    await page.screenshot({
      path: join(root, 'test-results/desktop-settings-failure.png'),
    });
  }
  throw error;
} finally {
  if (app) await app.close();
  await upstream.close();
  local.close();
  rmSync(directory, { recursive: true, force: true });
}
