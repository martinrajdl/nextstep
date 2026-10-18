import { test, expect } from '@playwright/test';
test('agent setup explains direct writes and exposes the exact shared connection', async ({
  page,
}) => {
  await page.goto('/#/agents');
  await expect(
    page.getByRole('heading', { name: 'Connect your agent.' }),
  ).toBeVisible();
  await page
    .getByText('Other agents & advanced setup', { exact: true })
    .click();
  await expect(page.locator('.crm-advanced-body pre')).toContainText(
    'nextstep-crm',
  );
  await expect(page.locator('.crm-advanced-body pre')).toContainText(
    '--database',
  );
  await expect(
    page.getByText('Your agent can save changes directly.', { exact: false }),
  ).toBeVisible();
  await page.getByText('Read setup request', { exact: true }).click();
  await expect(page.locator('.crm-generated-brief')).toContainText(
    'nextstep_crm_apply',
  );
  await expect(
    page.getByText('Generate a trusted-write configuration', { exact: true }),
  ).toHaveCount(0);
});
test('review is an opt-in setting, persists after reload, and can be disabled', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByLabel('Require review', { exact: true }),
  ).not.toBeChecked();
  await page.getByLabel('Require review', { exact: true }).check();
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/crm/policy')).json()).reviewRequired,
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Review changes', exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByLabel('Require review', { exact: true }),
  ).toBeChecked();
  await page.getByLabel('Require review', { exact: true }).uncheck();
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/crm/policy')).json()).reviewRequired,
    )
    .toBe(false);
  await expect(
    page.getByLabel('Require review', { exact: true }),
  ).toBeEnabled();
  await page.route('**/api/crm/policy', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Could not save agent settings.' }),
        })
      : route.continue(),
  );
  await page.getByLabel('Require review', { exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  await expect(
    page.getByLabel('Require review', { exact: true }),
  ).not.toBeChecked();
  expect(
    (await (await request.get('/api/crm/policy')).json()).reviewRequired,
  ).toBe(false);
});
test('saved importer preferences remain editable from settings', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('button', { name: 'Importer preferences', exact: true })
    .click();
  await page
    .getByLabel('Roles and work you want')
    .fill('Fictional preferences to preserve');
  await page
    .getByRole('button', { name: 'Save preferences', exact: true })
    .click();
  expect((await (await request.get('/api/profile')).json()).profile.roles).toBe(
    'Fictional preferences to preserve',
  );
});
