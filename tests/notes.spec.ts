import { test, expect } from '@playwright/test';

test('notes write Markdown, persist, filter tags and recover from trash', async ({
  page,
  request,
}) => {
  await page.goto('/#/notes');
  await page
    .getByRole('button', { name: 'New note', exact: true })
    .first()
    .click();
  await page
    .getByLabel('Note title', { exact: true })
    .fill('Fictional project notebook');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const body =
    '# A useful conversation\n\nWrite it down and keep it close.\n\n- [ ] Follow up\n\n#project/research';
  await page.getByLabel('Markdown source').fill(body);
  await expect(page.locator('output')).toHaveText('Saved');
  const id = new URLSearchParams(page.url().split('?')[1]).get('note');
  await expect
    .poll(
      async () => (await (await request.get(`/api/notes/${id}`)).json()).body,
    )
    .toBe(body);
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'A useful conversation', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Note title')).toHaveValue(
    'Fictional project notebook',
  );
  await expect(
    page.getByRole('heading', { name: 'A useful conversation', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Search notes').fill('useful conversation');
  await expect(
    page
      .getByLabel('Note list')
      .getByRole('button')
      .filter({ hasText: 'Fictional project notebook' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '#project/research', exact: true })
    .click();
  await expect(page.getByLabel('Note list')).toContainText(
    'Fictional project notebook',
  );
  await page.screenshot({
    path: 'test-results/notes-light.png',
    animations: 'disabled',
  });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({
    path: 'test-results/notes-dark.png',
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Note actions' }).click();
  await page
    .getByRole('menuitem', { name: 'Move note to trash', exact: true })
    .click();
  await expect
    .poll(
      async () => (await (await request.get(`/api/notes/${id}`)).json()).state,
    )
    .toBe('trash');
  await page.getByRole('button', { name: 'Note actions' }).click();
  await page
    .getByRole('menuitem', { name: 'Restore note', exact: true })
    .click();
  await expect
    .poll(
      async () => (await (await request.get(`/api/notes/${id}`)).json()).state,
    )
    .toBe('active');
  await page.getByRole('button', { name: 'Note actions' }).click();
  await page
    .getByRole('menuitem', { name: 'Note history', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Document history' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Folder sync', exact: false }).click();
  await expect(
    page.getByRole('dialog', { name: 'Sync your notes' }),
  ).toContainText('Choose a folder in the desktop app to sync');
  await expect(
    page.getByRole('button', { name: 'Enable folder sync' }),
  ).toBeDisabled();
});

test('an overlapping agent edit never overwrites a typing buffer', async ({
  page,
  request,
}) => {
  const id = crypto.randomUUID();
  await request.post('/api/crm/apply', {
    data: {
      id: crypto.randomUUID(),
      title: 'Fictional conflict example',
      operations: [
        {
          type: 'create_note',
          id,
          title: 'Conflict example',
          body: 'Original',
        },
      ],
    },
  });
  await page.goto(`/#/notes?note=${id}`);
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  let intercepted = false;
  await page.route('**/api/crm/apply', async (route) => {
    const data = route.request().postDataJSON();
    if (!intercepted && data.operations[0].type === 'update_note') {
      intercepted = true;
      const current = await (await request.get(`/api/notes/${id}`)).json();
      await request.post('/api/crm/apply', {
        data: {
          id: crypto.randomUUID(),
          title: 'Incoming edit',
          operations: [
            {
              type: 'update_note',
              id,
              version: current.version,
              body: 'Agent version',
            },
          ],
        },
      });
    }
    await route.continue();
  });
  await page.getByLabel('Markdown source').fill('My local writing');
  await expect(
    page.getByText('This note changed elsewhere. Your writing is preserved.'),
  ).toBeVisible();
  await expect(page.getByLabel('Markdown source')).toHaveValue(
    'My local writing',
  );
  await page.getByRole('button', { name: 'Save both', exact: true }).click();
  await expect(page.getByLabel('Markdown source')).toHaveValue('Agent version');
  await expect
    .poll(async () => {
      const list = await (
        await request.get('/api/notes?search=My%20local%20writing')
      ).json();
      return list.total;
    })
    .toBe(1);
});

test('notes link to CRM records through record details', async ({
  page,
  request,
}) => {
  const collectionId = `notes_example_${Date.now()}`,
    recordId = crypto.randomUUID();
  await request.post('/api/crm/apply', {
    data: {
      id: crypto.randomUUID(),
      title: 'Fictional linked-record example',
      operations: [
        {
          type: 'create_collection',
          id: collectionId,
          name: 'Fictional projects',
          fields: [],
        },
        {
          type: 'create_record',
          id: recordId,
          collectionId,
          collectionVersion: 1,
          title: 'Example project',
          values: {},
        },
      ],
    },
  });
  await page.goto(`/#/collections/${collectionId}`);
  await page
    .getByRole('button', { name: 'EX Example project', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.getByLabel('Note title')).toHaveValue(
    'Notes on Example project',
  );
  const list = await (
    await request.get(`/api/notes?linkedTo=${recordId}`)
  ).json();
  expect(list.total).toBe(1);
  await page.setViewportSize({ width: 750, height: 850 });
  await expect(page.getByLabel('Note title')).toBeVisible();
  await page.screenshot({
    path: 'test-results/notes-narrow.png',
    animations: 'disabled',
  });
});

test('visual Markdown preserves GFM structures through a human edit and restart', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const id = crypto.randomUUID();
  const body =
    '# Heading one\n\n## Heading two\n\n### Heading three\n\n#### Heading four\n\n##### Heading five\n\n###### Heading six\n\n**Bold** and *italic* and ~~removed~~ and `inline code`.\n\n> A quotation\n\n1. First\n2. Second\n\n- Bullet\n  - Nested\n\n- [ ] Open task\n- [x] Done task\n\n```js\nconst example = 1;\n```\n\n---\n\n| Name | Value |\n| --- | --- |\n| Example | 42 |\n\n[Website](https://example.com)\n\n![Fictional illustration](https://example.com/illustration.png)';
  await page.route('https://example.com/**', (route) =>
    route.fulfill({ status: 204, body: '' }),
  );
  await request.post('/api/crm/apply', {
    data: {
      id: crypto.randomUUID(),
      title: 'Fictional Markdown test',
      operations: [
        { type: 'create_note', id, title: 'Markdown reference', body },
      ],
    },
  });
  await page.goto(`/#/notes?note=${id}`);
  await expect(
    page.getByRole('heading', { name: 'Heading six', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.notes-prose table')).toContainText('42');
  await expect(page.locator('.notes-prose img')).toHaveAttribute(
    'alt',
    'Fictional illustration',
  );
  await expect(page.locator('.notes-prose blockquote')).toContainText(
    'A quotation',
  );
  await expect(page.locator('.notes-prose pre')).toContainText(
    'const example = 1;',
  );
  await page.locator('.notes-prose > p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' An extra thought.');
  await expect
    .poll(
      async () => (await (await request.get(`/api/notes/${id}`)).json()).body,
    )
    .toContain('An extra thought.');
  await page.reload();
  await expect(page.locator('.notes-prose img')).toHaveAttribute(
    'alt',
    'Fictional illustration',
  );
  await expect(page.locator('.notes-prose table')).toContainText('42');
  await expect(page.locator('.notes-prose s')).toHaveText('removed');
  await expect(page.locator('.notes-prose hr')).toHaveCount(1);
  await expect(page.locator('.notes-prose input[type=checkbox]')).toHaveCount(
    2,
  );
  await expect(page.locator('.notes-prose a')).toHaveAttribute(
    'href',
    'https://example.com',
  );
  await expect(page.getByLabel('Note list')).toContainText(
    'Markdown reference',
  );
  await page.screenshot({
    path: 'test-results/notes-markdown-light.png',
    animations: 'disabled',
  });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({
    path: 'test-results/notes-markdown-dark.png',
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
});

test('extended Markdown remains lossless in source mode and failed saves retain the buffer', async ({
  page,
  request,
}) => {
  const id = crypto.randomUUID(),
    body =
      'Text with a footnote[^1].\n\n[^1]: Keep this definition.\n\n<!-- Keep this comment -->\n<details><summary>More</summary>Raw HTML</details>\n\nInline ![example](https://example.com/image.png) image.';
  await request.post('/api/crm/apply', {
    data: {
      id: crypto.randomUUID(),
      title: 'Extended Markdown test',
      operations: [{ type: 'create_note', id, title: 'Extended syntax', body }],
    },
  });
  await page.goto(`/#/notes?note=${id}`);
  await expect(page.getByLabel('Markdown source')).toHaveValue(body);
  await page.route('**/api/crm/apply', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Fictional unavailable backend' }),
    }),
  );
  await page
    .getByLabel('Markdown source')
    .fill(body + '\n\nKeep the unsaved thought.');
  await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
  await expect(page.getByLabel('Markdown source')).toHaveValue(
    body + '\n\nKeep the unsaved thought.',
  );
  await page.unroute('**/api/crm/apply');
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expect
    .poll(
      async () => (await (await request.get(`/api/notes/${id}`)).json()).body,
    )
    .toBe(body + '\n\nKeep the unsaved thought.');
  await page.reload();
  await expect(page.getByLabel('Markdown source')).toHaveValue(
    body + '\n\nKeep the unsaved thought.',
  );
});
