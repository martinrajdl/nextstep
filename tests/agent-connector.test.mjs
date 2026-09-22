import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentConnector } from '../desktop/agent-connector.mjs';
const connection = {command:'/Applications/Fictional Nextstep.app/Contents/MacOS/Nextstep',args:['--mcp','--database','/tmp/fictional board.sqlite']};
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(),'nextstep-connector-'));
  mkdirSync(join(home,'Applications/Codex.app/Contents/Resources'),{recursive:true});
  writeFileSync(join(home,'Applications/Codex.app/Contents/Resources/codex'),'');
  mkdirSync(join(home,'Applications/Claude.app'),{recursive:true});
  t.after(() => rmSync(home,{recursive:true,force:true}));
  return {home,path:join(home,'.claude.json')};
}
test('Claude connection preserves all other settings, backs up locally and is idempotent',async t => {
  const {home,path} = fixture(t);
  const original = {theme:'dark',projects:{'/example':{setting:42}},mcpServers:{other:{command:'unchanged'}}};
  writeFileSync(path,JSON.stringify(original));
  const connector = createAgentConnector({home,platform:'darwin',env:{}});
  await connector.connect('claude-code',connection);
  const updated = JSON.parse(readFileSync(path,'utf8'));
  assert.deepEqual(updated.mcpServers.other,original.mcpServers.other); assert.deepEqual(updated.projects,original.projects);
  assert.deepEqual(updated.mcpServers.nextstep,{type:'stdio',...connection});
  const backups = () => readdirSync(home).filter(name => name.includes('nextstep-backup'));
  assert.equal(backups().length,1); assert.deepEqual(JSON.parse(readFileSync(join(home,backups()[0]),'utf8')),original);
  await connector.connect('claude-code',connection); assert.equal(backups().length,1);
});
test('Claude refuses malformed config, linked files and another database without changing them',async t => {
  const {home,path} = fixture(t); const connector = createAgentConnector({home,platform:'darwin',env:{}});
  for (const contents of ['not json','[]',JSON.stringify({mcpServers:{nextstep:{command:'other',args:['--database','/tmp/other.sqlite']}}})]) {
    writeFileSync(path,contents); await assert.rejects(connector.connect('claude-code',connection)); assert.equal(readFileSync(path,'utf8'),contents);
  }
  rmSync(path); const target=join(home,'linked.json'); writeFileSync(target,'{}'); symlinkSync(target,path);
  await assert.rejects(connector.connect('claude-code',connection)); assert.equal(readFileSync(target,'utf8'),'{}');
  await assert.rejects(connector.connect('unrecognized-agent',connection));
});
test('Codex uses fixed argv, verifies results and preserves other connections',async t => {
  const {home} = fixture(t); const calls=[]; let list=[{name:'another',transport:{type:'http',url:'https://example.com/mcp'}}];
  const run=async (command,args,options) => {
    calls.push({command,args,options});
    if (args[1] === 'add') { list.push({name:'nextstep',enabled:true,transport:{type:'stdio',command:args[4],args:args.slice(5)}}); return {stdout:''}; }
    return {stdout:JSON.stringify(list)};
  };
  const connector = createAgentConnector({home,platform:'darwin',env:{},run});
  await connector.connect('codex',connection);
  assert.deepEqual(calls.find(call => call.args[1] === 'add').args,['mcp','add','nextstep','--',connection.command,...connection.args]);
  assert.ok(calls.every(call => call.options.env.CODEX_HOME === join(home,'.codex')));
  assert.equal(list[0].name,'another'); await connector.connect('codex',connection);
  assert.equal(calls.filter(call => call.args[1] === 'add').length,1);
  list.find(server => server.name==='nextstep').transport.args=['--database','/tmp/other.sqlite'];
  await assert.rejects(connector.connect('codex',connection),/points somewhere else/);
  assert.equal(calls.filter(call => call.args[1] === 'add').length,1);
});
test('a conflicting Claude Desktop connection takes precedence and is left untouched',async t => {
  const {home,path} = fixture(t);
  const folder = join(home,'Library/Application Support/Claude'); mkdirSync(folder,{recursive:true});
  const original = JSON.stringify({mcpServers:{nextstep:{command:'/old/app',args:['--mcp','--database','/tmp/other.sqlite']}}});
  const desktop = join(folder,'claude_desktop_config.json'); writeFileSync(desktop,original); writeFileSync(path,'{}');
  const connector = createAgentConnector({home,platform:'darwin',env:{}});
  await assert.rejects(connector.connect('claude-code',connection));
  assert.equal(readFileSync(desktop,'utf8'),original); assert.equal(readFileSync(path,'utf8'),'{}');
});
