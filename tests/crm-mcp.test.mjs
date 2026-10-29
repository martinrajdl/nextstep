import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { openStore } from '../server/store.mjs';
import { createCrmMcp } from '../mcp/crm-server.mjs';

test('CRM MCP cannot silently create a missing established database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nextstep-crm-missing-'));
  const file = join(directory, 'absent.sqlite');
  try {
    assert.throws(() => createCrmMcp(file));
    assert.equal(existsSync(file), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
for (const trusted of [false, true])
  test(`real MCP session supports ${trusted ? 'default direct writes' : 'opt-in review'} without changing legacy jobs`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextstep-crm-mcp-')),
      file = join(directory, 'test.sqlite');
    const store = openStore(file);
    const job = store.create({
      company: 'Fictional preserved choice',
      stage: 'uninterested',
      notes: 'Keep this decision',
    });
    const client = new Client({ name: 'crm-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        resolve('mcp/crm-stdio.mjs'),
        '--database',
        file,
        ...(trusted ? ['--allow-writes'] : []),
      ],
      stderr: 'pipe',
    });
    try {
      if (!trusted) store.crm.setPolicy({ version: 1, reviewRequired: true });
      await client.connect(transport);
      const names = (await client.listTools()).tools.map((t) => t.name);
      assert.equal(names.includes('nextstep_crm_apply'), true);
      assert.ok(!names.some((n) => /_(approve|review|shell|delete)$/.test(n)));
      const context = (
        await client.callTool({ name: 'nextstep_crm_context', arguments: {} })
      ).structuredContent;
      assert.equal(context.access, trusted ? 'write' : 'review-required');
      assert.equal(context.collections.length, 1);
      const flow = await client.callTool({
        name: 'nextstep_crm_report_flow',
        arguments: {
          id: 'mcp-example-flow',
          reportId: 'start',
          version: 0,
          goal: 'Organize fictional research',
          stage: 'sourcing',
          message: 'Reading the available context.',
        },
      });
      assert.equal(flow.isError, undefined);
      assert.equal(flow.structuredContent.version, 1);
      assert.equal(
        (
          await client.callTool({
            name: 'nextstep_crm_flows',
            arguments: { id: 'mcp-example-flow' },
          })
        ).structuredContent.updates.length,
        1,
      );
      const input = {
        id: randomUUID(),
        title: 'Fictional research collection',
        operations: [
          {
            type: 'create_collection',
            id: 'research',
            name: 'Research',
            fields: [],
          },
          {
            type: 'create_record',
            collectionId: 'research',
            collectionVersion: 1,
            title: 'Fictional note',
          },
        ],
      };
      assert.equal(
        (
          await client.callTool({
            name: 'nextstep_crm_preview',
            arguments: input,
          })
        ).structuredContent.diffs.length,
        2,
      );
      assert.equal(store.crm.collections().length, 1);
      const result = await client.callTool({
        name: 'nextstep_crm_apply',
        arguments: input,
      });
      assert.equal(result.isError, undefined);
      assert.equal(
        result.structuredContent.status,
        trusted ? 'applied' : 'pending',
      );
      if (!trusted) {
        assert.equal(store.crm.collections().length, 1);
        store.crm.review(input.id, { version: 1, decision: 'approve' });
      }
      const query = await client.callTool({
        name: 'nextstep_crm_query',
        arguments: { collectionId: 'research' },
      });
      assert.equal(query.structuredContent.records[0].title, 'Fictional note');
      assert.deepEqual(store.get(job.id), job);
    } finally {
      await client.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

for (const connectionReview of [false, true])
  test(`notes typed MCP API supports safe writes and review (connection review: ${connectionReview})`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextstep-note-api-')),
      file = join(directory, 'test.sqlite');
    const store = openStore(file),
      client = new Client({ name: 'notes-test', version: '1' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        resolve('mcp/crm-stdio.mjs'),
        '--database',
        file,
        ...(connectionReview ? ['--require-review'] : []),
      ],
      stderr: 'pipe',
    });
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      return result.structuredContent;
    };
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools;
      assert.ok(tools.some((t) => t.name === 'nextstep_crm_write_note'));
      const context = await call('nextstep_crm_context', {});
      assert.ok(context.operationGuide.notes.append_note);
      const input = {
        changeId: randomUUID(),
        title: 'Capture fictional research',
        mode: 'preview',
        actor: 'Example agent',
        operation: {
          type: 'create_note',
          title: 'Research notebook',
          body: 'Original passage. #research',
        },
      };
      assert.equal(
        (await call('nextstep_crm_write_note', input)).diffs.length,
        1,
      );
      assert.equal(store.crm.notes.list().total, 0);
      input.mode = 'apply';
      const created = await call('nextstep_crm_write_note', input);
      assert.equal(created.status, connectionReview ? 'pending' : 'applied');
      if (connectionReview) {
        assert.equal(store.crm.notes.list().total, 0);
        store.crm.review(created.id, { version: 1, decision: 'approve' });
      }
      const n = store.crm.notes.list().notes[0];
      assert.equal(
        (
          await call('nextstep_crm_notes', {
            search: 'Original',
            tag: 'research',
            limit: 1,
          })
        ).notes[0].id,
        n.id,
      );
      assert.equal(
        (await call('nextstep_crm_notes', { id: n.id })).note.body,
        'Original passage. #research',
      );
      const appended = {
        changeId: randomUUID(),
        title: 'Append research',
        mode: 'apply',
        operation: {
          type: 'append_note',
          id: n.id,
          version: n.version,
          text: 'Another thought.',
        },
      };
      const result = await call('nextstep_crm_write_note', appended);
      if (connectionReview)
        store.crm.review(result.id, { version: 1, decision: 'approve' });
      await call('nextstep_crm_write_note', appended);
      assert.equal(
        store.crm.notes.get(n.id).body,
        'Original passage. #research\n\nAnother thought.',
      );
      const stale = await client.callTool({
        name: 'nextstep_crm_write_note',
        arguments: { ...appended, changeId: randomUUID() },
      });
      assert.equal(stale.isError, true);
      const current = store.crm.notes.get(n.id);
      const edit = {
        changeId: randomUUID(),
        title: 'Revise a passage',
        mode: 'apply',
        operation: {
          type: 'edit_note',
          id: n.id,
          version: current.version,
          find: 'Original passage.',
          replace: 'Revised passage.',
        },
      };
      const edited = await call('nextstep_crm_write_note', edit);
      if (connectionReview)
        store.crm.review(edited.id, { version: 1, decision: 'approve' });
      assert.equal(
        store.crm.notes.get(n.id).body,
        'Revised passage. #research\n\nAnother thought.',
      );
      const fresh = store.crm.notes.get(n.id);
      const noMatch = await client.callTool({
        name: 'nextstep_crm_write_note',
        arguments: {
          ...edit,
          changeId: randomUUID(),
          operation: {
            ...edit.operation,
            version: fresh.version,
            find: 'Not present',
          },
        },
      });
      assert.equal(noMatch.isError, true);
      store.crm.setPolicy({
        version: store.crm.policy().version,
        reviewRequired: true,
      });
      const pending = await call('nextstep_crm_write_note', {
        ...edit,
        changeId: randomUUID(),
        operation: {
          type: 'append_note',
          id: n.id,
          version: fresh.version,
          text: 'Needs approval',
        },
      });
      assert.equal(pending.status, 'pending');
      assert.equal(store.crm.notes.get(n.id).body, fresh.body);
      store.crm.apply({
        id: randomUUID(),
        title: 'Human edit',
        operations: [
          {
            type: 'update_note',
            id: n.id,
            version: fresh.version,
            body: 'Human decision',
          },
        ],
      });
      assert.throws(
        () => store.crm.review(pending.id, { version: 1, decision: 'approve' }),
        /changed/,
      );
      assert.equal(store.crm.notes.get(n.id).body, 'Human decision');
    } finally {
      await client.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
