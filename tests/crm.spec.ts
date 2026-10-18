import { test, expect, type APIRequestContext } from '@playwright/test';
async function add(
  request: APIRequestContext,
  company: string,
  stage = 'prospect',
) {
  const response = await request.post('/api/opportunities', {
    data: { company, stage, notes: 'Keep these notes', role: 'Fictional role' },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).opportunity;
}
async function context(request: APIRequestContext) {
  return (await request.get('/api/crm/context')).json();
}
test('existing records and every collection share navigation, fields, actions and history', async ({
  page,
  request,
}) => {
  const kept = await add(request, 'Fictional shared keeper', 'interested');
  await page.goto('/jobs');
  await expect(
    page.getByRole('heading', { name: 'Job search', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Collections', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Other workspaces', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator('.crm-board article[aria-label="Fictional shared keeper"]'),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Actions for Fictional shared keeper',
      exact: true,
    })
    .click();
  await page.getByRole('menuitem', { name: 'Rejected', exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await (await request.get('/api/opportunities')).json()
        ).opportunities.find((r: { id: string }) => r.id === kept.id).stage,
    )
    .toBe('rejected');
  await page
    .getByRole('region', { name: 'Rejected column', exact: true })
    .locator('article[aria-label="Fictional shared keeper"] > button')
    .first()
    .click();
  await page
    .getByLabel('Notes', { exact: true })
    .fill('Updated through the shared editor');
  await page.getByRole('button', { name: 'Save record', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const c = await context(request);
  const record = (
    await (await request.get(`/api/crm/records/${kept.id}`)).json()
  ).record;
  expect(record.values.notes).toBe('Updated through the shared editor');
  expect(record.collectionId).toBe(c.compatibilityCollectionId);
  await page.evaluate(() => {
    document.documentElement.dataset.sameShell = 'yes';
  });
  await page.getByRole('link', { name: 'Workspace home', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Collections', exact: true })
    .getByRole('link', { name: 'Job search', exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`collections/${c.compatibilityCollectionId}$`),
  );
  await expect(page.locator('html')).toHaveAttribute('data-same-shell', 'yes');
  await expect(
    page.getByRole('link', { name: 'Agent progress', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/unified-existing-pipeline.png' });
});
test('dragging within a stage and across stages changes the same connector records', async ({
  page,
  request,
}) => {
  const a = await add(request, 'Fictional drag A'),
    b = await add(request, 'Fictional drag B');
  await page.goto('/jobs');
  const card = page.locator(`article[aria-label="${b.company}"]`);
  await card.dragTo(page.locator(`article[aria-label="${a.company}"]`));
  await expect
    .poll(async () => {
      const rows = (await (await request.get('/api/opportunities')).json())
        .opportunities;
      return (
        rows.findIndex((r: { id: string }) => r.id === b.id) <
        rows.findIndex((r: { id: string }) => r.id === a.id)
      );
    })
    .toBe(true);
  await expect(card).toHaveAttribute('draggable', 'true');
  await card.dragTo(
    page.getByRole('region', { name: 'Interested column', exact: true }),
  );
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/crm/records/${b.id}`)).json()).record
          .values.stage,
    )
    .toBe('interested');
  await page.reload();
  await expect(
    page
      .getByRole('region', { name: 'Interested column', exact: true })
      .locator(`article[aria-label="${b.company}"]`),
  ).toBeVisible();
});
test('stages can be named, reordered, hidden and added in the shared view', async ({
  page,
  request,
}) => {
  const row = await add(request, 'Fictional stage settings');
  await page.goto('/jobs');
  await page
    .getByRole('button', { name: 'View settings', exact: true })
    .click();
  await page.getByLabel('Stage name for Prospects').fill('Inbox');
  await page.getByLabel('Show Uninterested stage').uncheck();
  await page
    .getByRole('button', { name: 'Move Inbox earlier', exact: true })
    .click();
  await page.getByLabel('New stage name').fill('Follow up');
  await page.getByRole('button', { name: 'Add stage', exact: true }).click();
  await expect(page.getByLabel('Show Follow up stage')).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.crm-board > section').first()).toHaveAttribute(
    'aria-label',
    'Inbox column',
  );
  await expect(
    page.getByRole('region', { name: 'Uninterested column', exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Inbox column', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: `Actions for ${row.company}`, exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Follow up', exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await (await request.get('/api/opportunities')).json()
        ).opportunities.find((r: { id: string }) => r.id === row.id).stage,
    )
    .toBe('Follow up');
});
test('archived records keep their identity, values and history in both interfaces', async ({
  page,
  request,
}) => {
  const row = await add(request, 'Fictional archive');
  await page.goto('/jobs');
  await page
    .getByRole('button', { name: `Actions for ${row.company}`, exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'Archive record', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/crm/records/${row.id}`)).json()).record
          .archivedAt,
    )
    .not.toBeNull();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page
    .getByRole('button', { name: `Actions for ${row.company}`, exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'Restore record', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/crm/records/${row.id}`)).json()).record
          .archivedAt,
    )
    .toBeNull();
});
test('an external agent edit cannot be overwritten by a stale editor', async ({
  page,
  request,
}) => {
  const row = await add(request, 'Fictional conflict');
  await page.goto('/jobs');
  await page
    .locator(`article[aria-label="${row.company}"] > button`)
    .first()
    .click();
  await page.getByLabel('Notes', { exact: true }).fill('Stale edit');
  expect(
    (
      await request.patch(`/api/opportunities/${row.id}`, {
        data: { version: row.version, notes: 'Fresh connector edit' },
      })
    ).ok(),
  ).toBeTruthy();
  await page.getByRole('button', { name: 'Save record', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed');
  expect(
    (await (await request.get(`/api/crm/records/${row.id}`)).json()).record
      .values.notes,
  ).toBe('Fresh connector edit');
});
test('mobile navigation and dark appearance keep the same collection controls', async ({
  page,
  request,
}) => {
  await add(request, 'Fictional mobile');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/jobs');
    await expect(
      page.getByRole('heading', { name: 'Job search', exact: true }),
    ).toBeVisible();
    if (width < 900)
      await page
        .getByRole('button', { name: 'Open navigation', exact: true })
        .click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    if (width < 900)
      await page
        .getByRole('button', { name: 'Close navigation', exact: true })
        .click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `test-results/unified-mobile-${width}.png` });
  }
});
