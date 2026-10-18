import { test, expect, type APIRequestContext } from '@playwright/test';
const change = (operations: object[]) => ({
  id: crypto.randomUUID(),
  title: 'Fictional browser change',
  operations,
});

async function existingWorkspace(request: APIRequestContext, company: string) {
  const response = await request.post('/api/opportunities', { data: { company } });
  expect(response.ok()).toBeTruthy();
  const { opportunity } = await response.json();
  // Historical data keeps its workspace reachable without filling later board fixtures.
  expect((await request.delete(`/api/opportunities/${opportunity.id}`, { data: { version: opportunity.version } })).ok()).toBeTruthy();
}
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
  await expect(page.getByRole('heading', { name: 'Connect your agent.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Job search', exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Other workspaces', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: /Connect your agent.|Your workspace/ }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/composable-overview.png',
    fullPage: true,
  });
  await page.getByText('Other agents & advanced setup',{exact:true}).click();
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
    page.getByRole('button', { name: /^(?!Actions).*Example Avery/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: /^(?!Actions).*Example Avery/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Board view', exact: true }).click();
  await page.getByRole('button',{name:'Actions for Example Avery',exact:true}).click();
  await page.getByRole('menuitem',{name:'Active',exact:true}).click();
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
  await page.getByRole('button', { name: /^(?!Actions).*Example Avery/ }).click();
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
  await page.getByRole('button', { name: 'Collection actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Import JSON', exact: true }).click();
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
    page.getByRole('heading', { name: 'Review changes', exact: true }),
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
    page.getByRole('button', { name: /^(?!Actions).*Fictional field notes/ }),
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
  await page.getByRole('button', { name: 'Collection actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save a view', exact: true }).click();
  await page.getByLabel('View name', { exact: true }).fill('New projects');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Collection actions', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'New projects', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /^(?!Actions).*Fictional project/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^(?!Actions).*Fictional project/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Archive', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /^(?!Actions).*Fictional project/ }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('button', { name: /^(?!Actions).*Fictional project/ }).click();
  await page
    .getByRole('button', { name: 'Restore record', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /^(?!Actions).*Fictional project/ }),
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
  await page.getByRole('button', { name: /^(?!Actions).*Original example/ }).click();
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
    page.getByRole('button', { name: /^(?!Actions).*External edit/ }),
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
  await page.getByRole('link', { name: /Review changes/ }).click();
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
test('mobile workspace and agent setup are usable, expose exact connection paths, and keep all collections in one sidebar', async ({
  page,
  request,
}) => {
  await existingWorkspace(request, 'Fictional existing workspace');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /Connect your agent.|Your workspace/ }),
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
    .getByRole('link', { name: 'Agent', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Agent', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Connection & instructions', exact: true }).click();
  await page.getByText('Other agents & advanced setup',{exact:true}).click();
  const context = await (await request.get('/api/crm/context')).json();
  await expect(page.locator('pre')).toContainText(
    context.connection.mcpServers['nextstep-crm'].args.at(-1),
  );
  await expect(page.getByText('Your agent can save changes directly.',{exact:false})).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByRole('button', { name: 'Open navigation', exact: true })
    .click();
  await page.getByRole('link', { name: 'Job search', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`collections/${context.compatibilityCollectionId}$`));
  await expect(page.getByRole('heading',{name:'Job search',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('appearance persists across workspaces while the neutral icon stays unchanged', async ({
  page,
  request,
}) => {
  await existingWorkspace(request, 'Fictional appearance workspace');
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
  await expect(page.getByRole('heading', { name: 'Agent', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Agent', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: /^(Agent progress|Your agent)$/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Connection and instructions' })).not.toBeVisible();
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
  await page.getByRole('link', { name: 'Agent', exact: true }).click();
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

test('light, dark and system modes persist across Jobs and collections without changing data', async ({page,request}) => {
  await page.emulateMedia({colorScheme:'dark'});
  await page.goto('/');
  await expect(page).toHaveTitle('Workspace home · Nextstep');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  const before = await (await request.get('/api/opportunities')).json();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Dark mode',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(23, 25, 30)');
  await page.getByRole('button',{name:'Blue accent',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent','#4473cf');
  await page.screenshot({path:'test-results/settings-dark.png'});
  await page.getByRole('button',{name:'Done',exact:true}).click();
  const {onboarding} = await (await request.get('/api/agent')).json();
  if (onboarding.status === 'new') await request.patch('/api/onboarding',{data:{version:onboarding.version,step:0,status:'dismissed'}});
  await page.getByRole('link',{name:'Job search',exact:true}).click();
  const setup = page.getByRole('dialog');
  if (await setup.isVisible()) await page.getByRole('button',{name:'Close setup',exact:true}).click();
  await expect(page).toHaveTitle('Job search · Nextstep');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'System mode',exact:true}).click();
  await page.emulateMedia({colorScheme:'light'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.emulateMedia({colorScheme:'dark'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button',{name:'Light mode',exact:true}).click();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  expect(await (await request.get('/api/opportunities')).json()).toEqual(before);
});

test('board actions replace status selects, hidden stages persist, and saved views expose the same choices to agents', async ({page,request}) => {
  await createCollection(request,'action_pipeline',[{key:'status',name:'Status',type:'select',options:['New','Active','Done','Rejected']},{key:'notes',name:'Notes',type:'text'}]);
  await createRecord(request,'action_pipeline','Fictional action record',{status:'New',notes:'Preserve this note'});
  await page.goto('/#/collections/action_pipeline');
  await page.getByRole('button',{name:'Board view',exact:true}).click();
  await expect(page.locator('.crm-board article select')).toHaveCount(0);
  await page.getByRole('button',{name:'View settings',exact:true}).click();
  await expect(page.getByLabel('Done quick action',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Rejected quick action',{exact:true})).toBeChecked();
  await page.getByRole('button',{name:'Move Active earlier',exact:true}).click();
  await page.getByLabel('New stage name',{exact:true}).fill('Paused');
  await page.getByRole('button',{name:'Add stage',exact:true}).click();
  await expect(page.getByLabel('Stage name for Paused',{exact:true})).toBeVisible();
  await page.getByLabel('Stage name for New',{exact:true}).fill('Inbox');
  await page.getByLabel('Show Rejected stage',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByRole('region',{name:'Rejected column',exact:true})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Inbox column',exact:true})).toBeVisible();
  await expect(page.locator('.crm-board > section').nth(1)).toHaveAttribute('aria-label','Active column');
  await page.getByRole('button',{name:'Actions for Fictional action record',exact:true}).press('Enter');
  await page.getByRole('menuitem',{name:'Rejected',exact:true}).click();
  const records=async () => (await (await request.post('/api/crm/query',{data:{collectionId:'action_pipeline'}})).json()).records;
  await expect.poll(async () => (await records())[0].values.status).toBe('Rejected');
  await page.reload();
  await page.getByRole('button',{name:'Board view',exact:true}).click();
  await expect(page.getByRole('region',{name:'Rejected column',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:/View settings/}).click();
  await page.getByLabel('Show Rejected stage',{exact:true}).check();
  await page.getByLabel('Show Done stage',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByRole('region',{name:'Rejected column'}).getByRole('article')).toBeVisible();
  const transfer=await page.evaluateHandle(() => new DataTransfer());
  await page.getByRole('article',{name:'Fictional action record'}).dispatchEvent('dragstart',{dataTransfer:transfer});
  await page.getByRole('region',{name:'Done drop target',exact:true}).dispatchEvent('drop',{dataTransfer:transfer});
  await expect.poll(async () => (await records())[0].values.status).toBe('Done');
  expect((await records())[0].values.notes).toBe('Preserve this note');
  await page.getByRole('button',{name:'Collection actions',exact:true}).click();
  await page.getByRole('menuitem',{name:'Save a view',exact:true}).click();
  await page.getByLabel('View name',{exact:true}).fill('Focus pipeline');
  await page.getByRole('button',{name:'Save view',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const context=await (await request.get('/api/crm/context')).json();
  expect(context.collections.find((c:{id:string}) => c.id==='action_pipeline').views[0]).toMatchObject({hiddenGroups:['Done'],quickActions:['Done','Rejected'],stageOrder:['','Active','New','Done','Rejected'],stageNames:{New:'Inbox'}});
  await page.getByRole('button',{name:'Table view',exact:true}).click();
  await page.screenshot({path:'test-results/board-actions-overview.png'});
  await page.getByRole('button',{name:'Actions for Fictional action record',exact:true}).click();
  await page.getByRole('menuitem',{name:'Archive record',exact:true}).click();
  await expect.poll(async () => (await records()).length).toBe(0);
  await page.getByRole('button',{name:'Archive',exact:true}).click();
  await page.getByRole('button',{name:'Actions for Fictional action record',exact:true}).click();
  await page.getByRole('menuitem',{name:'Restore record',exact:true}).click();
  await expect.poll(async () => (await records()).length).toBe(1);
});

test('slow collection loading keeps the shell and never presents a false empty workspace', async ({page,request}) => {
  await createCollection(request,'loading_example');
  await createRecord(request,'loading_example','Fictional loading record');
  let release: (() => void) | undefined;
  await page.route('**/api/crm/query',async route => { await new Promise<void>(resolve => {release=resolve;}); await route.continue(); });
  await page.goto('/#/collections/loading_example');
  await expect(page.locator('.board-skeleton')).toBeVisible();
  await expect(page.getByRole('heading',{name:'A clean slate.'})).toHaveCount(0);
  await expect(page.locator('.crm-sidebar')).toBeVisible();
  await expect.poll(() => Boolean(release)).toBe(true);release!();
  await expect(page.getByRole('button',{name:/^(?!Actions).*Fictional loading record/})).toBeVisible();
  await page.unroute('**/api/crm/query');
  expect(await page.locator('.crm-table').evaluate(el => getComputedStyle(el.parentElement!).opacity)).toBe('1');
});

test('long board content stays inside cards and remains available in the record editor', async ({ page, request }) => {
  const id = 'card_layout_examples';
  const title = 'Fictional collaborator with an unusually long name and ' + 'UnbrokenReference'.repeat(5);
  const stage = 'Waiting for a detailed review of the collected information';
  const summary = 'A long summary gathered by an agent. '.repeat(12).trim();
  const source = `https://example.com/research/${'long-reference-'.repeat(12)}`;
  await createCollection(request, id, [
    { key: 'stage', name: 'Stage', type: 'select', options: ['New', stage, 'Done'] },
    { key: 'summary', name: 'Summary', type: 'longtext' },
    { key: 'source', name: 'Source', type: 'url' },
    { key: 'context', name: 'Detailed collection context and source notes', type: 'text' },
    { key: 'next_step', name: 'Next step', type: 'text' },
  ]);
  await createRecord(request, id, title, {
    stage, summary, source,
    context: 'ContextWithoutSpaces'.repeat(12),
    next_step: 'Compare the findings, inspect the original sources, and decide which contact to follow up with.',
  });
  expect((await request.post('/api/crm/apply', {
    data: change([{ type: 'create_view', collectionId: id, name: 'Pipeline', layout: 'board', groupBy: 'stage', columns: ['summary', 'source', 'context', 'next_step'] }]),
  })).ok()).toBeTruthy();
  await page.goto(`/#/collections/${id}`);
  const card = page.getByRole('article', { name: title, exact: true });
  await expect(card).toBeVisible();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    const bounds = await card.evaluate(node => {
      const content = node.querySelector('button:not(.record-actions-trigger)')!;
      const contentBounds = content.getBoundingClientRect();
      const titleBounds = content.querySelector('strong')!.getBoundingClientRect();
      const actionsBounds = node.querySelector('.record-actions-trigger')!.getBoundingClientRect();
      const header = node.closest('.crm-board > section')!.querySelector('header')!;
      return {
        fieldOverflow: [...content.querySelectorAll('span, small')].some(field => {
          const rect = field.getBoundingClientRect();
          return rect.right > contentBounds.right + 1 || rect.left < contentBounds.left - 1;
        }),
        titleOverlapsActions: titleBounds.right > actionsBounds.left - 4,
        cardOverflow: node.scrollWidth > node.clientWidth + 1,
        headerOverflow: header.scrollWidth > header.clientWidth + 1,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(bounds).toEqual({ fieldOverflow: false, titleOverlapsActions: false, cardOverflow: false, headerOverflow: false, pageOverflow: false });
    await page.screenshot({ path: `test-results/board-long-content-${width}.png` });
  }
  await card.locator('button:not(.record-actions-trigger)').click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(title);
  await expect(page.getByLabel('Summary', { exact: true })).toHaveValue(summary);
  await expect(page.getByLabel('Source', { exact: true })).toHaveValue(source);
});

test('collection controls stay compact and the pipeline fills every window width', async ({ page, request }) => {
  const id = 'full_width_examples';
  await createCollection(request, id, [
    { key: 'status', name: 'Status', type: 'select', required: true, options: ['New', 'Review', 'Ready', 'Done'] },
    { key: 'summary', name: 'Summary', type: 'text' },
  ]);
  for (const [index, status] of ['New', 'Review', 'Ready', 'Done'].entries()) {
    await createRecord(request, id, `Example ${index + 1}`, { status, summary: 'Collected by an agent, ready to inspect.' });
  }
  expect((await request.post('/api/crm/apply', { data: change([
    { type: 'create_view', collectionId: id, name: 'Pipeline', layout: 'board', groupBy: 'status', columns: ['summary'] },
    { type: 'create_view', collectionId: id, name: 'A saved view with a long descriptive name', layout: 'table', columns: ['status', 'summary'] },
  ]) })).ok()).toBeTruthy();
  await page.goto(`/#/collections/${id}`);
  await page.getByRole('button', { name: 'Collection actions', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Pipeline', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(4);
  for (const width of [2560, 1920, 1280, 800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const layout = await page.locator('.crm-main').evaluate(main => {
      const mainBounds = main.getBoundingClientRect();
      const board = main.querySelector('.crm-board')!.getBoundingClientRect();
      const controls = main.querySelector('.crm-collection-controls')!.getBoundingClientRect();
      return {
        leftInset: board.left - mainBounds.left,
        rightInset: mainBounds.right - board.right,
        boardTop: board.top,
        controlsHeight: controls.height,
        controlsOverflow: [...main.querySelectorAll('.crm-collection-controls button, .crm-collection-controls select, .crm-collection-controls input')].some(control => {
          const bounds = control.getBoundingClientRect();
          return bounds.left < controls.left - 1 || bounds.right > controls.right + 1;
        }),
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(layout.leftInset).toBe(16);
    expect(layout.rightInset).toBe(16);
    expect(layout.controlsOverflow).toBe(false);
    expect(layout.pageOverflow).toBe(false);
    if (width >= 1280) {
      expect(layout.controlsHeight).toBeLessThanOrEqual(32);
      expect(layout.boardTop).toBeLessThanOrEqual(100);
    }
    await page.screenshot({ path: `test-results/collection-compact-${width}.png` });
  }
  await page.getByRole('button', { name: 'Collection actions', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'A saved view with a long descriptive name', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('button', { name: 'Collection actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit fields', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('collections fill the window and scroll records independently beneath fixed headers', async ({ page, request }) => {
  const id = `scroll_${Date.now()}`;
  await createCollection(request, id, [
    { key: 'status', name: 'Status', type: 'select', options: ['New', 'Ready'] },
    { key: 'summary', name: 'Summary', type: 'text' },
  ]);
  expect((await request.post('/api/crm/apply', { data: change(Array.from({ length: 36 }, (_, index) => ({
    type: 'create_record', collectionId: id, collectionVersion: 1,
    title: `Fictional record ${String(index + 1).padStart(2, '0')}`,
    values: { status: index % 2 ? 'Ready' : 'New', summary: 'Agent-collected information for human review.' },
  }))) })).ok()).toBeTruthy();
  await page.goto(`/#/collections/${id}`);
  for (const width of [1512, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: 'Table view', exact: true }).click();
    const table = page.getByRole('region', { name: 'Collection records', exact: true });
    await expect(table.locator('tbody tr')).toHaveCount(36);
    const before = await page.locator('.crm-pagination').boundingBox();
    await table.focus();
    await page.keyboard.press('End');
    await expect.poll(() => table.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => table.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
    const tableBounds = await table.boundingBox();
    const heading = await table.locator('thead').boundingBox();
    expect(Math.abs(heading!.y - tableBounds!.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(tableBounds!.y + tableBounds!.height - before!.y + 10)).toBeLessThanOrEqual(2);
    expect(before!.y + before!.height).toBeLessThanOrEqual(844);
    expect(before!.y + before!.height).toBeGreaterThan(820);
    await page.screenshot({ path: `test-results/table-full-height-${width}.png` });

    await page.getByRole('button', { name: 'Board view', exact: true }).click();
    const cards = page.getByRole('region', { name: 'New records', exact: true });
    const neighbor = page.getByRole('region', { name: 'Ready records', exact: true });
    const columnHeader = page.getByRole('heading', { name: 'New', exact: true });
    const headerBefore = await columnHeader.boundingBox();
    await cards.focus();
    await page.keyboard.press('End');
    await expect.poll(() => cards.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => cards.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
    expect(await neighbor.evaluate(node => node.scrollTop)).toBe(0);
    expect((await columnHeader.boundingBox())!.y).toBe(headerBefore!.y);
    expect(await page.locator('.crm-pagination').boundingBox()).toEqual(before);
    const frame = await page.locator('.crm-board').evaluate(node => ({
      bottom: node.getBoundingClientRect().bottom,
      verticalOverflow: node.scrollHeight > node.clientHeight,
      documentOverflow: document.documentElement.scrollHeight > innerHeight,
      pageScroll: window.scrollY,
    }));
    expect(Math.abs(frame.bottom - before!.y + 10)).toBeLessThanOrEqual(2);
    expect(frame.verticalOverflow).toBe(false);
    expect(frame.documentOverflow).toBe(false);
    expect(frame.pageScroll).toBe(0);
    await page.screenshot({ path: `test-results/board-full-height-${width}.png` });
  }
});
