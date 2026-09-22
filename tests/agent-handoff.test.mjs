import test from 'node:test';
import assert from 'node:assert/strict';
import { agentHandoffUrl } from '../desktop/agent-handoff.mjs';
import { setupInstructions, searchInstructions } from '../server/agent-instructions.mjs';

test('both agents open new local coding conversations with the complete request and folder',() => {
  const database = '/tmp/Fictional board & research/nextstep.sqlite';
  const workspace = '/tmp/Nextstep Research + notes';
  for (const provider of ['claude-code','codex']) {
    const requests = [setupInstructions({provider,cadence:'Daily at 09:00',timezone:'UTC'},{connectionToken:'test-connection-token'},database),searchInstructions(database)];
    for (const instructions of requests) {
      const url = new URL(agentHandoffUrl(provider,instructions,workspace));
      const claude = provider === 'claude-code';
      assert.equal(url.protocol,claude ? 'claude:' : 'codex:');
      assert.equal(url.host,claude ? 'code' : 'threads');
      assert.equal(url.pathname,'/new');
      assert.equal(url.searchParams.get(claude ? 'q' : 'prompt'),instructions);
      assert.equal(url.searchParams.get(claude ? 'folder' : 'path'),workspace);
      if (!claude) assert.equal(url.searchParams.get('mode'),'codex');
      assert.match(instructions,/Do not search a connector marketplace/);
      assert.ok(instructions.includes(database));
    }
  }
});

test('handoff never accepts arbitrary protocols, relative folders or silently truncated requests',() => {
  assert.throws(() => agentHandoffUrl('https://example.com','request','/tmp/research'));
  assert.throws(() => agentHandoffUrl('claude-code','request','relative/folder'));
  assert.throws(() => agentHandoffUrl('codex',' ','/tmp/research'));
  assert.throws(() => agentHandoffUrl('claude-code','x'.repeat(12001),'/tmp/research'));
  const prompt = 'Research café roles. Keep A&B, +, #, %, ? and\nnewlines intact.';
  const url = new URL(agentHandoffUrl('claude-code',prompt,'/tmp/research'));
  assert.equal(url.searchParams.get('q'),prompt);
  assert.deepEqual([...url.searchParams.keys()],['q','folder']);
});
