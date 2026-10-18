import { _electron as electron, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';
import { root } from '../server/config.mjs';
import { crmAgentRequest } from '../lib/crm-agent-request.ts';
const directory = mkdtempSync(join(tmpdir(), 'nextstep-crm-desktop-')),
  database = join(directory, 'example.sqlite'),
  userData = join(directory, 'profile');
const store = openStore(database),
  executablePath = process.argv[2];
const client = new Client({ name: 'nextstep-crm-check', version: '1.0.0' });
let app,
  connected = false;
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  return result.structuredContent;
}
try {
  app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [root]), '--database', database],
    env: {
      ...process.env,
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
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(
    page.getByRole('heading', { name: 'Connect your agent.' }),
  ).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  const navigation = await page
    .getByRole('navigation', { name: 'Workspace navigation', exact: true })
    .innerText();
  const agents = await page.evaluate(() => window.nextstepDesktop.getAgents()),
    agent = agents.find((a) => a.canConnect);
  if (!agent)
    throw new Error(
      'An installed desktop agent is needed for the native handoff check.',
    );
  await app.evaluate(({ shell }) => {
    shell.openExternal = async (url) => {
      globalThis.crmSetupUrl = url;
    };
  });
  await page
    .getByRole('button', { name: new RegExp(`Connect ${agent.label}`) })
    .click();
  await expect(page.locator('.crm-setup-status')).toContainText(
    `Send the prepared request in ${agent.label}`,
    { timeout: 30000 },
  );
  const opened = new URL(await app.evaluate(() => globalThis.crmSetupUrl));
  expect(
    opened.searchParams.get(agent.provider === 'codex' ? 'prompt' : 'q'),
  ).toBe(crmAgentRequest);
  const connection = await page.evaluate(
    async () =>
      (await (await fetch('/api/crm/context')).json()).connection.mcpServers[
        'nextstep-crm'
      ],
  );
  expect(connection.args.slice(-2)).toEqual(['--database', database]);
  expect(connection.args).toContain('--crm-mcp');
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
  expect((await call('nextstep_crm_context')).access).toBe('write');
  await call('nextstep_crm_report_flow', {
    id: 'first-workspace',
    reportId: 'start',
    version: 0,
    goal: 'Organize fictional collaborators',
    stage: 'shaping',
    message: 'Building the workspace.',
  });
  const input = {
    id: randomUUID(),
    title: 'Create collaborators',
    operations: [
      {
        type: 'create_collection',
        id: 'people',
        name: 'People',
        fields: [
          {
            key: 'relationship',
            name: 'Relationship',
            type: 'select',
            options: ['New', 'In touch', 'Collaborating'],
          },
          { key: 'email', name: 'Email', type: 'email' },
        ],
      },
      {
        type: 'create_record',
        collectionId: 'people',
        collectionVersion: 1,
        title: 'Fictional Avery',
        values: { relationship: 'New', email: 'avery@example.com' },
      },
      {
        type: 'create_view',
        collectionId: 'people',
        name: 'Relationships',
        layout: 'board',
        groupBy: 'relationship',
      },
    ],
  };
  expect((await call('nextstep_crm_preview', input)).diffs).toHaveLength(3);
  expect(store.crm.collections()).toHaveLength(0);
  expect((await call('nextstep_crm_apply', input)).status).toBe('applied');
  await app.evaluate(({ app, BrowserWindow }) => {
    app.focus({ steal: true });
    BrowserWindow.getAllWindows()[0].focus();
  });
  await expect(
    page.getByRole('heading', { name: 'People', exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.locator('.crm-board article[aria-label="Fictional Avery"]'),
  ).toBeVisible();
  expect(
    await page
      .getByRole('navigation', { name: 'Workspace navigation', exact: true })
      .innerText(),
  ).toBe(navigation);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Require review')).not.toBeChecked();
  await page.getByLabel('Require review').check();
  await expect.poll(() => store.crm.policy().reviewRequired).toBe(true);
  const record = store.crm.query({ collectionId: 'people' }).records[0];
  const edit = {
    id: randomUUID(),
    title: 'Introduce Avery',
    operations: [
      {
        type: 'update_record',
        id: record.id,
        version: record.version,
        collectionVersion: 1,
        values: { relationship: 'In touch' },
      },
    ],
  };
  expect((await call('nextstep_crm_context')).access).toBe('review-required');
  expect((await call('nextstep_crm_apply', edit)).status).toBe('pending');
  expect(store.crm.getRecord(record.id).values.relationship).toBe('New');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('link', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: /Introduce Avery/ }).click();
  await page
    .getByRole('button', { name: 'Approve change', exact: true })
    .click();
  await expect
    .poll(() => store.crm.getRecord(record.id).values.relationship)
    .toBe('In touch');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Require review')).toBeChecked();
  await page.getByLabel('Require review').uncheck();
  await expect.poll(() => store.crm.policy().reviewRequired).toBe(false);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect((await call('nextstep_crm_context')).access).toBe('write');
  const directAgain = {
    id: randomUUID(),
    title: 'Continue the collaboration',
    operations: [
      {
        type: 'update_record',
        id: record.id,
        version: store.crm.getRecord(record.id).version,
        collectionVersion: 1,
        values: { relationship: 'Collaborating' },
      },
    ],
  };
  expect((await call('nextstep_crm_apply', directAgain)).status).toBe(
    'applied',
  );
  await call('nextstep_crm_report_flow', {
    id: 'first-workspace',
    reportId: 'complete',
    version: 1,
    stage: 'complete',
    message: 'Workspace ready.',
    changeIds: [input.id, edit.id, directAgain.id],
  });
  await page.getByRole('link', { name: 'Workspace home', exact: true }).click();
  await expect(page.getByText('Workspace ready.', { exact: true })).toBeVisible(
    { timeout: 15000 },
  );
  mkdirSync(join(root, 'test-results'), { recursive: true });
  await page.screenshot({
    path: join(root, 'test-results/desktop-crm-complete.png'),
  });
  expect(errors).toEqual([]);
  await app.close();
  app = null;
  expect(
    (await call('nextstep_crm_query', { collectionId: 'people' })).records,
  ).toHaveLength(1);
  console.log(
    'Desktop CRM passed: native unsent handoff, exact MCP config, direct writes by default, consistent sidebar, live opt-in review and approval, shared board, progress and continued agent access.',
  );
} finally {
  if (connected) await client.close();
  if (app) await app.close();
  store.close();
  rmSync(directory, { recursive: true, force: true });
}
