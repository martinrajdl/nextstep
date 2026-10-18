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
      if (!trusted) store.crm.setPolicy({version:1,reviewRequired:true});
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
