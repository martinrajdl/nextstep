import { _electron as electron, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { root } from '../server/config.mjs';
const directory = mkdtempSync(join(tmpdir(), 'nextstep-desktop-')),
  database = join(directory, 'example.sqlite');
const store = openStore(database);
store.updateProfile({ version: 0, roles: 'Fictional user-selected work' });
const choice = store.create({
  company: 'Fictional Keeper',
  stage: 'interested',
  notes: 'Keep this choice',
});
const schedule = store.updateSchedule({
  version: 0,
  provider: 'codex',
  cadence: 'Weekdays at 10:00',
  timezone: 'UTC',
});
store.updateSchedule(
  { version: schedule.version, taskId: 'fictional-existing-task' },
  { registration: true },
);
const before = {
  record: store.get(choice.id),
  profile: store.getProfile(),
  agent: store.agentStatus(),
};
const executablePath = process.argv[2],
  userData = join(directory, 'profile');
const client = new Client({
  name: 'nextstep-compatibility-check',
  version: '1.0.0',
});
let app,
  connected = false;
try {
  app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [root]), '--database', database],
    env: {
      ...process.env,
      NEXTSTEP_DEV_ICON: '1',
      NEXTSTEP_DB_PATH: '',
      DB_PATH: '',
      NEXTSTEP_DISABLE_UPDATES: '1',
      NEXTSTEP_USER_DATA: userData,
      NEXTSTEP_AGENT_CONFIG_HOME: join(directory, 'agents'),
    },
    timeout: 30000,
  });
  const page = await app.firstWindow(),
    errors = [];
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe('Nextstep Dev');
  page.on('pageerror', (e) => errors.push(e.message));
  await page
    .getByRole('navigation', { name: 'Collections', exact: true })
    .getByRole('link', { name: 'Job search', exact: true })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Interested column', exact: true })
      .locator('article[aria-label="Fictional Keeper"]'),
  ).toBeVisible();
  expect((await page.locator('.crm-sidebar').boundingBox()).y).toBe(0);
  const connection = await page.evaluate(
    async () =>
      (await (await fetch('/api/agent')).json()).connection.mcpServers.nextstep,
  );
  await client.connect(
    new StdioClientTransport({
      ...connection,
      env: {
        NEXTSTEP_DISABLE_UPDATES: '1',
        NEXTSTEP_USER_DATA: join(directory, 'helper'),
      },
      stderr: 'pipe',
    }),
  );
  connected = true;
  const context = (
    await client.callTool({ name: 'nextstep_get_context', arguments: {} })
  ).structuredContent;
  expect(context.byStage.interested[0].id).toBe(choice.id);
  expect(context.schedule.taskId).toBe('fictional-existing-task');
  const result = await client.callTool({
    name: 'nextstep_import_prospects',
    arguments: {
      opportunities: [
        {
          company: 'Fictional Connector Import',
          role: 'Example',
          url: 'https://example.com/import',
        },
      ],
      dryRun: false,
    },
  });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  await app.evaluate(({ app, BrowserWindow }) => {
    app.focus({ steal: true });
    BrowserWindow.getAllWindows()[0].focus();
  });
  await expect(
    page.locator('article[aria-label="Fictional Connector Import"]'),
  ).toBeVisible({ timeout: 15000 });
  await page
    .getByRole('button', {
      name: 'Actions for Fictional Connector Import',
      exact: true,
    })
    .click();
  await page.getByRole('menuitem', { name: 'Rejected', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await client.callTool({ name: 'nextstep_get_context', arguments: {} }))
          .structuredContent.byStage.rejected[0]?.company,
    )
    .toBe('Fictional Connector Import');
  await page.reload();
  await expect(
    page
      .getByRole('region', { name: 'Rejected column', exact: true })
      .locator('article[aria-label="Fictional Connector Import"]'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('button', { name: 'Importer preferences', exact: true })
    .click();
  await expect(page.getByLabel('Roles and work you want')).toHaveValue(
    before.profile.roles,
  );
  await page
    .getByRole('button', { name: 'Close', exact: true })
    .first()
    .click();
  await page.getByRole('link', { name: 'Workspace home', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your workspace', exact: true }),
  ).toBeVisible();
  mkdirSync(join(root, 'test-results'), { recursive: true });
  await page.screenshot({
    path: join(root, 'test-results/desktop-unified.png'),
  });
  expect(store.get(choice.id)).toEqual(before.record);
  expect(store.getProfile()).toEqual(before.profile);
  expect(store.agentStatus()).toEqual(before.agent);
  expect(errors).toEqual([]);
  await app.close();
  app = null;
  expect(
    (await client.callTool({ name: 'nextstep_get_context', arguments: {} }))
      .structuredContent.byStage.rejected[0].company,
  ).toBe('Fictional Connector Import');
  console.log(
    'Desktop compatibility passed: shared collection UI, original MCP connection and importer, live refresh, actions, history, saved preferences/schedule, and agent access after closing.',
  );
} finally {
  if (connected) await client.close();
  if (app) await app.close();
  store.close();
  rmSync(directory, { recursive: true, force: true });
}
