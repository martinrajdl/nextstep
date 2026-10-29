import { _electron as electron, expect } from '@playwright/test';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { root } from '../server/config.mjs';
const directory = mkdtempSync(join(tmpdir(), 'nextstep-notes-desktop-'));
const database = join(directory, 'example.sqlite');
openStore(database).close();
let app;
try {
  const executablePath = process.argv[2];
  app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [root]), '--database', database],
    env: {
      ...process.env,
      NEXTSTEP_DB_PATH: '',
      DB_PATH: '',
      NEXTSTEP_DISABLE_UPDATES: '1',
      NEXTSTEP_DISABLE_USAGE: '1',
      NEXTSTEP_DEV_ICON: '1',
      NEXTSTEP_USER_DATA: join(directory, 'settings'),
      NEXTSTEP_AGENT_CONFIG_HOME: join(directory, 'agents'),
    },
    timeout: 30000,
  });
  const page = await app.firstWindow(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('link', { name: 'Notes', exact: true }).click();
  await page
    .getByRole('button', { name: 'New note', exact: true })
    .first()
    .click();
  await page
    .getByLabel('Note title', { exact: true })
    .fill('Fictional desktop note');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await page
    .getByLabel('Markdown source')
    .fill('# Local writing\n\nKeep this note after reopening. #desktop');
  await expect(page.locator('output')).toHaveText('Saved');
  await page.reload();
  await expect(page.getByLabel('Note title')).toHaveValue(
    'Fictional desktop note',
  );
  await expect(
    page.getByRole('heading', { name: 'Local writing', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Folder sync', exact: false }).click();
  await expect(
    page.getByRole('dialog', { name: 'Sync your notes' }),
  ).toBeVisible();
  const folder = join(directory, 'sync');
  mkdirSync(folder);
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, folder);
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByLabel('Notes folder')).toHaveValue(
    join(realpathSync(folder), 'Nextstep Notes'),
  );
  await page
    .getByRole('button', { name: 'Enable folder sync', exact: true })
    .click();
  await expect
    .poll(
      () =>
        readdirSync(join(folder, 'Nextstep Notes')).filter((f) =>
          f.endsWith('.md'),
        ).length,
    )
    .toBe(1);
  expect(
    readFileSync(
      join(
        folder,
        'Nextstep Notes',
        readdirSync(join(folder, 'Nextstep Notes')).find((f) =>
          f.endsWith('.md'),
        ),
      ),
      'utf8',
    ),
  ).toContain('Keep this note after reopening.');
  await expect.poll(()=>page.evaluate(async()=>(await (await fetch('/api/notes/sync')).json()).pending)).toBe(0);
  expect(errors).toEqual([]);
  await app.close();
  app = null;
  const store = openStore(database);
  expect(store.crm.notes.list().total).toBe(1);
  expect(store.crm.notes.pending().length).toBe(0);
  store.close();
  console.log(
    'Desktop notes capture, persistence and folder sync passed using a temporary database.',
  );
} finally {
  if (app) await app.close();
  rmSync(directory, { recursive: true, force: true });
}
