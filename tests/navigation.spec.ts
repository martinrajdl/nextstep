import { test, expect } from '@playwright/test';

test('collapsed navigation keeps destinations accessible, persists, and adapts to mobile', async ({ page, request }) => {
  const id = `navigation_${Date.now()}`;
  expect((await request.post('/api/crm/apply', { data: {
    id: crypto.randomUUID(), title: 'Fictional navigation example', operations: [
      { type: 'create_collection', id, name: 'Design projects', fields: [] },
    ],
  } })).ok()).toBeTruthy();
  await page.goto(`/#/collections/${id}`);
  const expandedWidth = (await page.locator('.crm-sidebar').boundingBox())!.width;
  const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true });
  await collapse.click();
  await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toHaveAttribute('aria-expanded', 'false');
  expect((await page.locator('.crm-sidebar').boundingBox())!.width).toBe(64);
  expect((await page.locator('.crm-main').boundingBox())!.x).toBe(64);
  const collection = page.getByRole('navigation', { name: 'Collections', exact: true }).getByRole('link', { name: 'Design projects', exact: true });
  await collection.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Design projects');
  await page.getByRole('link', { name: 'Agent', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agent', exact: true })).toBeVisible();
  const setup = page.getByRole('button', { name: 'Connection & instructions', exact: true });
  await expect(setup).toHaveAttribute('aria-expanded', 'false');
  await setup.click();
  await expect(page.getByRole('region', { name: 'Connection and instructions' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Connect Codex/ })).toBeVisible();
  await setup.click();
  await expect(page.getByRole('region', { name: 'Connection and instructions' })).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/agent-collapsed-sidebar.png' });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await collection.scrollIntoViewIfNeeded();
  await expect(collection).toBeInViewport();
  await expect(collection.locator('.crm-nav-label')).toBeVisible();
  await collection.click();
  await expect(page.getByRole('heading', { name: 'Design projects', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close navigation overlay', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.setViewportSize({ width: 1512, height: 982 });
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  expect((await page.locator('.crm-sidebar').boundingBox())!.width).toBe(expandedWidth);
  await page.getByRole('link', { name: 'Agent', exact: true }).click();
  await page.screenshot({ path: 'test-results/agent-expanded-sidebar.png' });
});
