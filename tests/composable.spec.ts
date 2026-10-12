import { test, expect, type APIRequestContext } from '@playwright/test';
const change = (operations: object[]) => ({
  id: crypto.randomUUID(),
  title: 'Fictional browser change',
  operations,
});
async function createCollection(
  request: APIRequestContext,
  id: string,
  fields: object[] = [],
) {
  const result = await request.post('/api/crm/apply', {
    data: change([
      { type: 'create_collection', id, name: `Example ${id}`, fields },
    ]),
  });
  expect(result.ok()).toBeTruthy();
}
async function createRecord(
  request: APIRequestContext,
  collectionId: string,
  title: string,
  values: object = {},
) {
  const res = await request.post('/api/crm/apply', {
    data: change([
      {
        type: 'create_record',
        collectionId,
        collectionVersion: 1,
        title,
        values,
      },
    ]),
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).result[0].after;
}

test('workspace starts without records and supports a custom schema, persistent record, board movement and history', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /Make room for/ }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/composable-overview.png',
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Create a collection', exact: true })
    .click();
  await page
    .getByLabel('Collection name', { exact: true })
    .fill('Fictional collaborators');
  await page.getByRole('button', { name: 'Add field', exact: true }).click();
  await page.getByLabel('Field 1 name', { exact: true }).fill('Status');
  await page.getByLabel('Field 1 type', { exact: true }).selectOption('select');
  await page.getByLabel('Field 1 options', { exact: true }).fill('New,Active');
  await page
    .getByRole('button', { name: 'Create collection', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Fictional collaborators', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New record', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Example Avery');
  await page.getByLabel('Status', { exact: true }).selectOption('New');
  await page.getByRole('button', { name: 'Add record', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Example Avery/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: /Example Avery/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Board view', exact: true }).click();
  await page
    .getByLabel('Move Example Avery', { exact: true })
    .selectOption('Active');
  await expect
    .poll(async () => {
      const data = await (
        await request.post('/api/crm/query', {
          data: { collectionId: 'fictional_collaborators' },
        })
      ).json();
      return data.records[0].values.status;
    })
    .toBe('Active');
  await page.getByRole('button', { name: /Example Avery/ }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue(
    'Active',
  );
  await page.getByRole('button', { name: /History ·/ }).click();
  await expect(
    page.getByRole('button', { name: 'Use these values' }),
  ).toHaveCount(2);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Table view', exact: true }).click();
  await page.screenshot({
    path: 'test-results/composable-collection.png',
    fullPage: true,
  });
});
test('JSON import stays a proposal until reviewed; before/after diff is inspectable and approval persists', async ({
  page,
  request,
}) => {
  await createCollection(request, 'notes_review', [
    { key: 'source', name: 'Source', type: 'url' },
  ]);
  await page.goto('/#/collections/notes_review');
  await page.getByRole('button', { name: 'Import JSON', exact: true }).click();
  await page.getByLabel('Change set', { exact: true }).fill(
    JSON.stringify({
      records: [
        {
          title: 'Fictional field notes',
          values: { source: 'https://example.com/notes' },
          externalKey: 'notes-1',
        },
      ],
    }),
  );
  await page
    .getByRole('button', { name: 'Validate & preview', exact: true })
    .click();
  await expect(page.getByText(/Validated · 1 operations/)).toBeVisible();
  await page
    .getByRole('button', { name: 'Send to review', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Review inbox', exact: true }),
  ).toBeVisible();
  const before = await (
    await request.post('/api/crm/query', {
      data: { collectionId: 'notes_review' },
    })
  ).json();
  expect(before.total).toBe(0);
  await page
    .getByRole('button', { name: /Import 1 records into Example notes_review/ })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Fictional field notes');
  await page.screenshot({
    path: 'test-results/composable-review.png',
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Approve change', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: /Example notes_review/ }).click();
  await expect(
    page.getByRole('button', { name: /Fictional field notes/ }),
  ).toBeVisible();
  const exportResult = await (await request.get('/api/crm/export')).json();
  expect(
    exportResult.records.some(
      (r: { title: string }) => r.title === 'Fictional field notes',
    ),
  ).toBeTruthy();
});
test('schema relations, saved filters, archive and restore work through the user interface', async ({
  page,
  request,
}) => {
  await createCollection(request, 'linked_people');
  const person = await createRecord(request, 'linked_people', 'Example Rowan');
  await createCollection(request, 'linked_projects', [
    {
      key: 'people',
      name: 'People',
      type: 'relation',
      collection: 'linked_people',
    },
    { key: 'status', name: 'Status', type: 'select', options: ['New', 'Done'] },
  ]);
  await page.goto('/#/collections/linked_projects');
  await page.getByRole('button', { name: 'New record', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Fictional project');
  await page.getByLabel('Example Rowan', { exact: true }).check();
  await page.getByLabel('Status', { exact: true }).selectOption('New');
  await page.getByRole('button', { name: 'Add record', exact: true }).click();
  await expect(page.getByText('Example Rowan', { exact: true })).toBeVisible();
  const records = await (
    await request.post('/api/crm/query', {
      data: { collectionId: 'linked_projects' },
    })
  ).json();
  expect(records.records[0].values.people).toEqual([person.id]);
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('button', { name: 'Add filter', exact: true }).click();
  await page.getByLabel('Filter 1 field').selectOption('status');
  await page.getByLabel('Filter 1 operator').selectOption('eq');
  await page.getByLabel('Filter 1 value').fill('New');
  await page.getByRole('button', { name: 'Save a view', exact: true }).click();
  await page.getByLabel('View name', { exact: true }).fill('New projects');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'New projects', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Fictional project/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Fictional project/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Archive', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Fictional project/ }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('button', { name: /Fictional project/ }).click();
  await page
    .getByRole('button', { name: 'Restore record', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Fictional project/ }),
  ).toBeVisible();
});
test('stale edits preserve the draft, and stale agent approvals never partially apply', async ({
  page,
  request,
}) => {
  await createCollection(request, 'conflict_example');
  const record = await createRecord(
    request,
    'conflict_example',
    'Original example',
  );
  await page.goto('/#/collections/conflict_example');
  await page.getByRole('button', { name: /Original example/ }).click();
  await page.getByLabel('Title', { exact: true }).fill('Keep this draft');
  await request.post('/api/crm/apply', {
    data: change([
      {
        type: 'update_record',
        id: record.id,
        version: 1,
        collectionVersion: 1,
        title: 'External edit',
      },
    ]),
  });
  await page.getByRole('button', { name: 'Save record', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('This item changed');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    'Keep this draft',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('button', { name: 'Refresh workspace', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: /External edit/ }),
  ).toBeVisible();
  const proposal = await (
    await request.post('/api/crm/proposals', {
      data: {
        ...change([
          {
            type: 'create_record',
            collectionId: 'conflict_example',
            collectionVersion: 1,
            title: 'Never insert',
          },
          {
            type: 'update_record',
            id: record.id,
            version: 2,
            collectionVersion: 1,
            title: 'Agent edit',
          },
        ]),
        title: 'Stale example proposal',
      },
    })
  ).json();
  await request.post('/api/crm/apply', {
    data: change([
      {
        type: 'update_record',
        id: record.id,
        version: 2,
        collectionVersion: 1,
        title: 'Newest human edit',
      },
    ]),
  });
  await page.getByRole('link', { name: /Review inbox/ }).click();
  await page.getByRole('button', { name: /Stale example proposal/ }).click();
  await page
    .getByRole('button', { name: 'Approve change', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('This item changed');
  const data = await (
    await request.post('/api/crm/query', {
      data: { collectionId: 'conflict_example' },
    })
  ).json();
  expect(data.total).toBe(1);
  expect(data.records[0].title).toBe('Newest human edit');
  expect(
    (await (await request.get(`/api/crm/changes/${proposal.id}`)).json())
      .status,
  ).toBe('pending');
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('mobile workspace and agent setup are usable, expose exact connection paths, and preserve Jobs navigation', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /Make room for/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: 'test-results/composable-mobile.png',
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Open navigation', exact: true })
    .click();
  await page
    .getByRole('link', { name: 'Agent connection', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'A shared language for your data.' }),
  ).toBeVisible();
  const context = await (await request.get('/api/crm/context')).json();
  await expect(page.locator('pre')).toContainText(
    context.connection.mcpServers['nextstep-crm'].args.at(-1),
  );
  await page.getByLabel('Generate a trusted-write configuration').check();
  await expect(page.locator('pre')).toContainText('--allow-writes');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByRole('button', { name: 'Open navigation', exact: true })
    .click();
  await page.getByRole('link', { name: 'Job search', exact: true }).click();
  await expect(page).toHaveURL(/\/jobs$/);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('appearance persists across workspaces while the neutral icon stays unchanged', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-accent', '#777777');
  const icon = await page.locator('.crm-brand img').getAttribute('src');
  const surface = await page
    .locator('.crm-sidebar')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Blue accent', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', '#4473cf');
  expect(
    await page
      .locator('.crm-sidebar')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).not.toBe(surface);
  await expect(page.locator('.crm-brand img')).toHaveAttribute('src', icon!);
  await page.screenshot({
    path: 'test-results/composable-settings-blue.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-accent', '#4473cf');
  await page.getByRole('link', { name: 'Job search', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', '#4473cf');
});

test('agent progress links real proposals and reports applied work after human review', async ({
  page,
  request,
}) => {
  const flowId = 'browser-agent-flow';
  const report = await request.post('/api/crm/flows/report', {
    data: {
      id: flowId,
      reportId: 'sourcing',
      version: 0,
      goal: 'Find fictional studio contacts',
      actor: 'Example research agent',
      stage: 'sourcing',
      message: 'Reading fictional studio sources.',
      sources: [{ label: 'Example studio', url: 'https://example.com/studio' }],
    },
  });
  expect(report.ok()).toBeTruthy();
  await page.goto('/#/flows');
  await page
    .getByRole('button', { name: /Find fictional studio contacts/ })
    .click();
  await expect(page.getByRole('dialog')).toContainText(
    'Reading fictional studio sources.',
  );
  await expect(
    page
      .getByRole('dialog')
      .getByRole('link', { name: 'Example studio', exact: true })
      .first(),
  ).toHaveAttribute('href', 'https://example.com/studio');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const proposal = await (
    await request.post('/api/crm/proposals', {
      data: {
        ...change([
          {
            type: 'create_collection',
            id: 'flow_contacts',
            name: 'Flow contacts',
            fields: [],
          },
        ]),
        title: 'Create the contact workspace',
      },
    })
  ).json();
  const progress = await request.post('/api/crm/flows/report', {
    data: {
      id: flowId,
      reportId: 'review',
      version: 1,
      stage: 'review',
      message: 'The contact workspace is ready for review.',
      changeIds: [proposal.id],
    },
  });
  expect(progress.ok()).toBeTruthy();
  await expect(
    page.getByRole('button', { name: /Find fictional studio contacts/ }),
  ).toContainText('Waiting for your review', { timeout: 10000 });
  await page
    .getByRole('button', { name: /Find fictional studio contacts/ })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('link', { name: /Create the contact workspace/ })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Flow contacts');
  await page
    .getByRole('button', { name: 'Approve change', exact: true })
    .click();
  await page.getByRole('link', { name: 'Agent flows', exact: true }).click();
  await page
    .getByRole('button', { name: /Find fictional studio contacts/ })
    .click();
  await expect(page.getByRole('dialog')).toContainText('1 operations applied');
  await page.screenshot({
    path: 'test-results/composable-agent-flow.png',
    fullPage: true,
  });
  const flow = await (await request.get('/api/crm/flows/' + flowId)).json();
  expect(flow.appliedCount).toBe(1);
  expect(flow.pendingCount).toBe(0);
});
