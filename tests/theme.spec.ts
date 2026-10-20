import { test, expect } from '@playwright/test';

test('slate dark surfaces stay distinct and readable across collections and settings', async ({ page, request }) => {
  const id = `slate_${Date.now()}`;
  expect((await request.post('/api/crm/apply', { data: {
    id: crypto.randomUUID(), title: 'Fictional theme review', operations: [
      { type: 'create_collection', id, name: 'Research', fields: [
        { key: 'status', name: 'Status', type: 'select', options: ['Collected', 'Review', 'Ready'] },
        { key: 'notes', name: 'Notes', type: 'longtext' },
      ] },
      ...['Cedar product research', 'Atlas partner directory', 'Fieldnote customer insights'].map((title, index) => ({ type: 'create_record', collectionId: id, collectionVersion: 1, title, values: { status: ['Collected', 'Review', 'Ready'][index], notes: 'Findings collected by an agent, ready for a human to inspect.' } })),
    ],
  } })).ok()).toBeTruthy();
  await page.addInitScript(() => localStorage.setItem('nextstep-theme-v1', 'dark'));
  await page.goto(`/#/collections/${id}`);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Board view', exact: true }).click();
  const surfaces = await page.evaluate(() => {
    const rgb = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const luminance = (color: string) => rgb(color).map(channel => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
    const shell = getComputedStyle(document.querySelector('.crm-shell')!);
    const card = getComputedStyle(document.querySelector('.crm-board article')!);
    const text = getComputedStyle(document.querySelector('.crm-board article span')!);
    return { darkestChannel: Math.max(...rgb(shell.backgroundColor)), cardContrast: contrast(card.color, card.backgroundColor), detailContrast: contrast(text.color, card.backgroundColor), distinct: shell.backgroundColor !== card.backgroundColor };
  });
  expect(surfaces.darkestChannel).toBeLessThanOrEqual(16);
  expect(surfaces.distinct).toBe(true);
  expect(surfaces.cardContrast).toBeGreaterThanOrEqual(4.5);
  expect(surfaces.detailContrast).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: 'test-results/slate-board.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Table view', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.screenshot({ path: 'test-results/slate-table.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Require review', exact: true })).toHaveCount(1);
  await page.screenshot({ path: 'test-results/slate-settings.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'New record', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Unsaved example');
  page.once('dialog', dialog => dialog.dismiss());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Unsaved example');
  await page.screenshot({ path: 'test-results/slate-record.png', animations: 'disabled' });
  page.once('dialog', dialog => dialog.accept());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/slate-mobile.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
