import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { openStore } from '../server/store.mjs';
import { createNextstepMcp } from '../mcp/server.mjs';
import { databaseArgument } from '../mcp/stdio.mjs';

test('MCP rejects missing databases and ambiguous relative paths',() => {
  const directory = mkdtempSync(join(tmpdir(),'nextstep-mcp-missing-')); const file = join(directory,'absent.sqlite');
  try { assert.throws(() => createNextstepMcp(file)); assert.equal(existsSync(file),false); assert.throws(() => databaseArgument(['--database','relative.sqlite'])); }
  finally { rmSync(directory,{recursive:true,force:true}); }
});
test('a real stdio client can collect using feedback without changing user decisions',async () => {
  const directory = mkdtempSync(join(tmpdir(),'nextstep-mcp-')); const file = join(directory,'test.sqlite');
  const store = openStore(file);
  const rejected = store.create({company:'Rejected company',stage:'uninterested'});
  const interested = store.create({company:'Interested company',role:'Example role',stage:'interested'});
  const original = store.list(); const history = store.activity(interested.id);
  const client = new Client({name:'nextstep-test',version:'1.0.0'});
  const transport = new StdioClientTransport({command:process.execPath,args:[resolve('mcp/stdio.mjs'),'--database',file],stderr:'pipe'});
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools.map(tool=>tool.name);
    assert.equal(tools.length,7); assert.ok(!tools.some(name=>/move|delete|shell|execute/.test(name)));
    const initial = (await client.callTool({name:'nextstep_get_context',arguments:{}})).structuredContent;
    assert.equal(initial.database,file); assert.equal(initial.byStage.uninterested[0].id,rejected.id);
    const jobs = [{company:'Rejected company',role:'New role',url:'https://example.com/jobs/rejected'},{company:'New company',role:'Example role',url:'https://example.com/jobs/new',notes:'Verified on a fictional test source'}];
    assert.equal((await client.callTool({name:'nextstep_import_prospects',arguments:{opportunities:jobs,dryRun:false}})).isError,true);
    const profile = await client.callTool({name:'nextstep_save_preferences',arguments:{version:0,roles:'The user\'s chosen kind of work'}}); assert.equal(profile.isError,undefined);
    const preview = (await client.callTool({name:'nextstep_import_prospects',arguments:{opportunities:jobs}})).structuredContent;
    assert.equal(preview.dryRun,true); assert.equal(preview.planned.length,1); assert.equal(store.list().length,2);
    const imported = (await client.callTool({name:'nextstep_import_prospects',arguments:{opportunities:jobs,dryRun:false}})).structuredContent;
    assert.equal(imported.created.length,1); assert.equal(imported.skipped.length,1);
    const again = (await client.callTool({name:'nextstep_import_prospects',arguments:{opportunities:jobs,dryRun:false}})).structuredContent; assert.equal(again.created.length,0);
    const report = await client.callTool({name:'nextstep_record_search',arguments:{id:'stdio-run-1',summary:'Saved one new verified example',learning:'Avoid the declined company.',evidenceIds:[rejected.id],importedIds:[imported.created[0].id]}}); assert.equal(report.isError,undefined);
    const schedule = store.updateSchedule({version:0,provider:'codex',cadence:'Daily at 10',timezone:'UTC'});
    assert.match((await client.callTool({name:'nextstep_get_setup',arguments:{}})).structuredContent.instructions,/Daily at 10/);
    const token = store.agentStatus().onboarding.connectionToken;
    const connected = await client.callTool({name:'nextstep_confirm_connection',arguments:{token}});
    assert.ok(connected.structuredContent.onboarding.connectedAt);
    assert.equal(store.agentStatus().onboarding.connectedProvider,'codex');
    const registration = await client.callTool({name:'nextstep_register_schedule',arguments:{version:schedule.version,taskId:'actual-test-task'}}); assert.equal(registration.structuredContent.schedule.taskId,'actual-test-task');
    const final = (await client.callTool({name:'nextstep_get_context',arguments:{}})).structuredContent;
    assert.equal(final.recentSearches.length,1); assert.equal(final.byStage.prospect[0].id,imported.created[0].id);
    for (const job of original) assert.deepEqual(store.get(job.id),job);
    assert.deepEqual(store.activity(interested.id),history);
  } finally { await client.close(); store.close(); rmSync(directory,{recursive:true,force:true}); }
});
