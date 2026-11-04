import { test, expect } from '@playwright/test';

test('note controls reflect the selected formatting and retain Markdown through mode changes', async ({
  page,
  request,
}) => {
  const id = crypto.randomUUID(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await request.post('/api/crm/apply', {
    data: {
      id: crypto.randomUUID(),
      title: 'Fictional writing review',
      operations: [
        {
          type: 'create_note',
          id,
          title:
            'A research notebook for the next product conversation and the decisions we want to keep close',
          body: '',
        },
      ],
    },
  });
  await page.goto(`/#/notes?note=${id}`);
  const editor = page.getByRole('textbox', { name: 'Note body', exact: true });
  await editor.click();
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Bold', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.type('A decision worth keeping.');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Bold', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Text style', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Heading 2', exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(editor).toBeFocused();
  await page.keyboard.type('Next steps');
  await expect(
    page.getByRole('button', { name: 'Text style', exact: true }),
  ).toContainText('Heading 2');
  await page.keyboard.press('Enter');
  await page.keyboard.type(
    'Ask better questions, capture the context, and keep the next action clear.',
  );
  await expect
    .poll(
      async () => (await (await request.get(`/api/notes/${id}`)).json()).body,
    )
    .toContain('## Next steps');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  expect(await page.getByLabel('Markdown source').inputValue()).toContain(
    '**A decision worth keeping.**',
  );
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Next steps', exact: true }),
  ).toBeVisible();
  expect(
    await page
      .getByLabel('Note title', { exact: true })
      .evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
  ).toBe(true);
  await expect(page.getByLabel('Note list')).toContainText(
    'A research notebook',
  );
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) =>
        document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    await page.screenshot({
      path: `test-results/design-notes-${theme}.png`,
      animations: 'disabled',
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .getByLabel('Note title', { exact: true })
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/design-notes-narrow.png',
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Focus mode', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Exit focus mode', exact: true }),
  ).toBeVisible();
  await expect(editor).toBeVisible();
  expect(errors).toEqual([]);
});
