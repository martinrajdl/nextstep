import { test, expect, type Locator, type Page } from '@playwright/test';

async function expectNoFocusEdges(control: Locator, focused = true) {
  if (focused) await expect(control).toBeFocused();
  const style = await control.evaluate(node => {
    const s = getComputedStyle(node);
    return { outline: s.outlineStyle, shadow: s.boxShadow, borders: ['top', 'right', 'bottom', 'left'].map(side => ({
      width: s.getPropertyValue(`border-${side}-width`),
      style: s.getPropertyValue(`border-${side}-style`),
      color: s.getPropertyValue(`border-${side}-color`),
    })) };
  });
  expect(style.outline).toBe('none');
  expect(style.shadow).toBe('none');
  expect(style.borders.filter(border => border.width !== '0px' && border.style !== 'none' && border.color !== 'rgba(0, 0, 0, 0)')).toEqual([]);
}

async function focusWithKeyboard(page: Page, control: Locator, surface = control) {
  await expect(control).toBeEnabled();
  await control.evaluate(node => (node as HTMLElement).blur());
  const before = await control.boundingBox();
  const background = await surface.evaluate(node => getComputedStyle(node).backgroundColor);
  await control.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expectNoFocusEdges(control);
  if (surface !== control) await expectNoFocusEdges(surface, false);
  expect(await control.evaluate(node => node.matches(':focus-visible'))).toBe(true);
  await expect.poll(() => surface.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(background);
  const after = await control.boundingBox();
  expect(after?.width).toBe(before?.width);
  expect(after?.height).toBe(before?.height);
}

for (const theme of ['light', 'dark']) {
  test(`keyboard focus uses a borderless surface throughout the ${theme} app`, async ({ page, request }) => {
    const collectionId = `focus_${theme}`;
    expect((await request.post('/api/crm/apply', { data: {
      id: crypto.randomUUID(), title: 'Fictional keyboard examples', operations: [
        { type: 'create_collection', id: collectionId, name: 'Keyboard examples', fields: [
          { key: 'status', name: 'Status', type: 'select', options: ['New', 'Done'] },
          { key: 'notes', name: 'Notes', type: 'longtext' },
        ] },
        { type: 'create_record', collectionId, collectionVersion: 1, title: 'Example contact', values: { status: 'New', notes: 'Fictional notes for keyboard review.' } },
      ],
    } })).ok()).toBeTruthy();
    expect((await request.post('/api/opportunities', { data: { company: `Example ${theme} importer` } })).ok()).toBeTruthy();
    await page.goto(`/#/collections/${collectionId}`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }' });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: `${theme === 'light' ? 'Light' : 'Dark'} mode`, exact: true }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await focusWithKeyboard(page, page.getByRole('link', { name: 'Home', exact: true }));
    await focusWithKeyboard(page, page.getByRole('button', { name: 'Table view', exact: true }));
    const search = page.getByPlaceholder('Search this collection…');
    await focusWithKeyboard(page, search, page.locator('.crm-search'));
    await focusWithKeyboard(page, page.getByRole('button', { name: 'New record', exact: true }));
    await page.getByRole('button', { name: 'Board view', exact: true }).click();
    await focusWithKeyboard(page, page.getByLabel('Board group', { exact: true }));
    const card = page.getByRole('article', { name: 'Example contact', exact: true });
    await focusWithKeyboard(page, card.locator('button').first(), card);
    await page.screenshot({ path: `test-results/focus-${theme}-board.png` });
    const actions = page.getByRole('button', { name: 'Actions for Example contact', exact: true });
    await focusWithKeyboard(page, actions);
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await expectNoFocusEdges(page.locator('[role="menuitem"]:focus'));
    await page.keyboard.press('Escape');
    await expect(actions).toBeFocused();
    await card.locator('button').first().click();
    await focusWithKeyboard(page, page.getByLabel('Title', { exact: true }));
    await focusWithKeyboard(page, page.getByLabel('Status', { exact: true }));
    await focusWithKeyboard(page, page.getByLabel('Notes', { exact: true }));
    await page.screenshot({ path: `test-results/focus-${theme}-editor.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const review = page.getByLabel('Require review', { exact: true });
    const checked = await review.isChecked();
    await focusWithKeyboard(page, review, page.locator('label').filter({ has: review }));
    await expect(review).toBeChecked({ checked });
    await page.screenshot({ path: `test-results/focus-${theme}-settings.png` });
    await focusWithKeyboard(page, page.getByRole('button', { name: 'Blue accent', exact: true }));
    await page.getByRole('button', { name: 'Importer preferences', exact: true }).click();
    await focusWithKeyboard(page, page.getByLabel('Roles and work you want'));
    await page.screenshot({ path: `test-results/focus-${theme}-importer.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'View settings', exact: true }).click();
    await focusWithKeyboard(page, page.getByLabel('Stage name for New'));
    await page.keyboard.press('Escape');
  });
}
