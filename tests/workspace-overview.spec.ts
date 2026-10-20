import { test, expect } from '@playwright/test';

test('workspace cards stay compact with long descriptions and open the complete collection', async ({ page, request }) => {
  const prefix = `overview_${Date.now()}`;
  const description = 'Research potential partners, keep source links, and review the next conversation. '.repeat(20).trim();
  const collections = [
    { id: `${prefix}_people`, name: 'People', description: '', fields: [{ key: 'company', name: 'Company', type: 'text' }] },
    { id: `${prefix}_research`, name: 'Research library', description: `Source: https://example.com/${'research'.repeat(24)}`, fields: [] },
    { id: `${prefix}_partners`, name: 'Partner outreach and relationship research for the next product launch', description, fields: [] },
  ];
  expect((await request.post('/api/crm/apply', { data: {
    id: crypto.randomUUID(), title: 'Fictional workspace overview examples',
    operations: [
      ...collections.map(collection => ({ type: 'create_collection', ...collection })),
      { type: 'create_record', collectionId: collections[0].id, collectionVersion: 1, title: 'Alex Example', values: { company: 'Example Studio' } },
    ],
  } })).ok()).toBeTruthy();
  // Keep the overview deterministic when other tests have added collections.
  await page.route('**/api/crm/context', async route => {
    const response = await route.fetch();
    const context = await response.json();
    await route.fulfill({ response, json: {
      ...context,
      collections: context.collections.filter((collection: { id: string }) => collection.id.startsWith(prefix)),
      recentFlows: [],
    } });
  });
  await page.goto('/#/overview');
  const cards = page.locator('.crm-collection-cards > button');
  await expect(cards).toHaveCount(3);
  await page.screenshot({ path: 'test-results/workspace-overview-desktop.png', animations: 'disabled' });

  for (const width of [1512, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await cards.evaluateAll(nodes => nodes.map(node => {
      const bounds = node.getBoundingClientRect();
      const icon = node.querySelector('svg')!.getBoundingClientRect();
      const preview = node.querySelector('p');
      const footer = node.querySelector('small')!.getBoundingClientRect();
      return {
        height: bounds.height,
        width: bounds.width,
        top: bounds.top,
        footerBottom: footer.bottom,
        iconTop: icon.top - bounds.top,
        overflow: node.scrollWidth > node.clientWidth + 1,
        previewLines: preview ? preview.getBoundingClientRect().height / parseFloat(getComputedStyle(preview).lineHeight) : 0,
      };
    }));
    for (const card of metrics) {
      expect(card.height, `card height at ${width}px`).toBeLessThanOrEqual(184);
      expect(card.iconTop, `top alignment at ${width}px`).toBeLessThanOrEqual(28);
      expect(card.previewLines, `description length at ${width}px`).toBeLessThanOrEqual(2.1);
      expect(card.overflow, `card overflow at ${width}px`).toBe(false);
    }
    const firstRow = metrics.filter(card => Math.abs(card.top - metrics[0].top) < 1);
    expect(Math.max(...firstRow.map(card => card.footerBottom)) - Math.min(...firstRow.map(card => card.footerBottom))).toBeLessThanOrEqual(1);
    if (width <= 390) {
      expect(firstRow).toHaveLength(1);
      expect(metrics[0].width).toBeCloseTo((await page.locator('.crm-collection-cards').boundingBox())!.width, 0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(cards).toHaveCount(3);
  await page.screenshot({ path: 'test-results/workspace-overview-mobile.png', animations: 'disabled' });
  const people = cards.filter({ has: page.getByRole('heading', { name: 'People', exact: true }) });
  await expect(people.locator('small')).toHaveText('1 record · 1 field');
  await expect(people.locator('p')).toHaveCount(0);

  await page.setViewportSize({ width: 1512, height: 982 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.screenshot({ path: 'test-results/workspace-overview-dark.png', animations: 'disabled' });
  const partners = cards.filter({ has: page.getByRole('heading', { name: collections[2].name, exact: true }) });
  await partners.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`collections/${collections[2].id}$`));
  await page.getByRole('button', { name: 'Collection actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit fields', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit collection fields', exact: true });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(description);
});
