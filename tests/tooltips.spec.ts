import { test, expect } from '@playwright/test';

test('compact view toggle and shared tooltips work with mouse, keyboard, menus and dialogs', async ({ page, request }) => {
  const id = `tooltips_${Date.now()}`;
  expect((await request.post('/api/crm/apply', { data: {
    id: crypto.randomUUID(), title: 'Fictional tooltip examples', operations: [
      { type: 'create_collection', id, name: 'Projects', fields: [
        { key: 'status', name: 'Status', type: 'select', options: ['New', 'Done'] },
      ] },
      { type: 'create_record', collectionId: id, collectionVersion: 1, title: 'Example project', values: { status: 'New' } },
      { type: 'create_view', collectionId: id, name: 'Pipeline', layout: 'board', groupBy: 'status', columns: ['status'] },
    ],
  } })).ok()).toBeTruthy();
  await page.goto(`/#/collections/${id}`);
  await expect(page.getByLabel('Saved view', { exact: true })).toHaveCount(0);
  const table = page.getByRole('button', { name: 'Table view', exact: true });
  const board = page.getByRole('button', { name: 'Board view', exact: true });
  await expect(board).toHaveAttribute('aria-pressed', 'true');
  await table.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Table view');
  await expect(table).not.toHaveAttribute('title');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await table.click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('tooltip')).toHaveCount(0);

  // Keyboard focus reveals the same help without activating the control.
  await table.focus();
  await page.keyboard.press('Tab');
  await expect(board).toBeFocused();
  await expect(page.getByRole('tooltip')).toHaveText('Board view');
  await expect(table).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);

  const actions = page.getByRole('button', { name: 'Collection actions', exact: true });
  await actions.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Collection actions');
  await actions.click();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.getByRole('menuitemradio', { name: 'All records', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await actions.click();
  await page.getByRole('menuitemradio', { name: 'Pipeline', exact: true }).click();
  await expect(board).toHaveAttribute('aria-pressed', 'true');

  const previous = page.getByRole('button', { name: 'Previous', exact: true });
  await expect(previous).toBeDisabled();
  await previous.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Previous');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('button', { name: `${theme} mode`, exact: true }).click();
    const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
    await close.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toHaveText('Close dialog');
    expect(await tooltip.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return Boolean(node.closest('[role=dialog]')) && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('[role="tooltip"]') === node;
    })).toBe(true);
    await page.screenshot({ path: `test-results/tooltip-settings-${theme.toLowerCase()}.png` });
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await expect(dialog).toBeVisible();
  }
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await table.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Table view');
  await page.screenshot({ path: 'test-results/compact-toggle-tooltip.png' });
  // Every rendered button participates in the same tooltip behavior.
  expect(await page.locator('button').evaluateAll(buttons => buttons.filter(button => !button.hasAttribute('data-base-ui-tooltip-trigger')).map(button => button.textContent))).toEqual([]);
});

test('unavailable board view explains its requirement on hover', async ({ page, request }) => {
  const id = `tooltip_empty_${Date.now()}`;
  expect((await request.post('/api/crm/apply', { data: {
    id: crypto.randomUUID(), title: 'Fictional empty collection', operations: [
      { type: 'create_collection', id, name: 'Research', fields: [] },
    ],
  } })).ok()).toBeTruthy();
  await page.goto(`/#/collections/${id}`);
  const board = page.getByRole('button', { name: 'Board view', exact: true });
  await expect(board).toBeDisabled();
  await board.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Add a select field to use a board');
});
