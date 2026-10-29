import { test, expect } from '@playwright/test';

test('black surfaces stay neutral and readable with aligned records and spaced history', async ({ page, request }) => {
  const id = `theme_${Date.now()}`;
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
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
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
    const neutralSurfaces = ['.crm-shell', '.crm-sidebar', '.crm-board > section', '.crm-board article'].every(selector => {
      const channels = rgb(getComputedStyle(document.querySelector(selector)!).backgroundColor);
      return channels.every(channel => channel === channels[0]);
    });
    return { darkestChannel: Math.max(...rgb(shell.backgroundColor)), neutralSurfaces, cardContrast: contrast(card.color, card.backgroundColor), detailContrast: contrast(text.color, card.backgroundColor), distinct: shell.backgroundColor !== card.backgroundColor };
  });
  expect(surfaces.darkestChannel).toBe(0);
  expect(surfaces.neutralSurfaces).toBe(true);
  expect(surfaces.distinct).toBe(true);
  expect(surfaces.cardContrast).toBeGreaterThanOrEqual(4.5);
  expect(surfaces.detailContrast).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: 'test-results/black-board.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Table view', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  const markerPositions = await page.locator('.crm-table .crm-record-mark').evaluateAll(markers => markers.map(marker => marker.getBoundingClientRect().left));
  expect(markerPositions).toHaveLength(3);
  expect(Math.max(...markerPositions) - Math.min(...markerPositions)).toBeLessThan(1);
  await page.screenshot({ path: 'test-results/black-table.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Require review', exact: true })).toHaveCount(1);
  await page.screenshot({ path: 'test-results/black-settings.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'New record', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Unsaved example');
  page.once('dialog', dialog => dialog.dismiss());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Unsaved example');
  await page.screenshot({ path: 'test-results/black-record.png', animations: 'disabled' });
  page.once('dialog', dialog => dialog.accept());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'History', exact: true }).click();
  const history = page.locator('.crm-activity-list > button');
  await expect(history.nth(1)).toBeVisible();
  await expect.poll(() => history.evaluateAll(events => {
    const first = events[0].getBoundingClientRect(), second = events[1].getBoundingClientRect();
    return second.top - first.bottom;
  })).toBeGreaterThanOrEqual(6);
  await page.screenshot({ path: 'test-results/black-history.png', animations: 'disabled' });
  await history.first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto(`/#/collections/${id}`);
  await expect(page.getByRole('table')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/black-mobile.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
