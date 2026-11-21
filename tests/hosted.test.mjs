import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import { createHostedDatabase, postgresOptions } from '../server/hosted/postgres.mjs';
import { migrateHosted } from '../server/hosted/migrate.mjs';
import { openWorkspaceEngine, readWorkspaceRows, fingerprint } from '../server/hosted/workspace-engine.mjs';
import { workspaceOperation } from '../server/hosted/operations.mjs';
import { createHostedHandler } from '../server/hosted/http.mjs';
import { selectWorkspaceRows, importTransfer } from '../server/hosted/transfer.mjs';
import { createRemoteCrm } from '../mcp/remote-crm.mjs';
import { hostedAuth } from '../server/hosted/auth.mjs';
import { remoteCrmArgument } from '../mcp/remote-options.mjs';

const owner = { id: randomUUID(), email: 'owner@example.com', kind: 'person' };
const editor = { id: randomUUID(), email: 'editor@example.com', kind: 'person' };
const outsider = { id: randomUUID(), email: 'outsider@example.com', kind: 'person' };
const viewer = { id: randomUUID(), email: 'viewer@example.com', kind: 'person' };
const workspaceId = randomUUID(), otherWorkspaceId = randomUUID();
const collection = { type: 'create_collection', id: 'people', name: 'People', fields: [{ key:'status',name:'Status',type:'select',options:['New','Contacted'] }] };
const change = (operations) => ({ id: randomUUID(), title: 'Fictional change', actor: 'Untrusted actor', operations });

test('hosted connector arguments reject incomplete setup without choosing local storage',()=>{
  assert.equal(remoteCrmArgument([],{}),undefined);
  assert.throws(()=>remoteCrmArgument(['--workspace',workspaceId],{}),/--server/);
  assert.throws(()=>remoteCrmArgument(['--server','--workspace',workspaceId],{}),/--server/);
  assert.throws(()=>remoteCrmArgument(['--server','https://nextstep.example.com','--workspace',workspaceId,'--database','/example.sqlite'],{}),/either/);
  const directory=mkdtempSync(join(tmpdir(),'nextstep-hosted-arguments-')), file=join(directory,'credential');
  try {
    writeFileSync(file,`nextstep_${'a'.repeat(43)}`,{mode:0o600});
    const args=['--server','https://nextstep.example.com','--workspace',workspaceId,'--credential-file',file];
    assert.ok(remoteCrmArgument(args,{}).context);
    chmodSync(file,0o644);
    assert.throws(()=>remoteCrmArgument(args,{}),/chmod 600/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('hosted migrations are repeatable and keep existing workspace rows',async t=>{
  const db=new PGlite(); t.after(()=>db.close());
  await db.exec('CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE ROLE anon; CREATE ROLE authenticated;');
  const client={query:(sql,params)=>db.query(sql,params)};
  // PGlite uses one connection; multi-statement schema execution uses exec.
  client.query=(sql,params)=>!params && sql.includes('create schema if not exists nextstep;') ? db.exec(sql) : db.query(sql,params);
  assert.equal((await migrateHosted(client)).status,'migrated');
  await db.query('INSERT INTO nextstep.workspaces(id,name) VALUES($1,$2)',[workspaceId,'Fictional retained workspace']);
  assert.equal((await migrateHosted(client)).status,'up_to_date');
  assert.equal((await db.query('SELECT name FROM nextstep.workspaces WHERE id=$1',[workspaceId])).rows[0].name,'Fictional retained workspace');
});

test('Postgres connections require full certificate verification and preserve an explicit CA',()=>{
  assert.throws(()=>postgresOptions('postgresql://nextstep_app:example@db.example.com/postgres?sslmode=require'));
  assert.throws(()=>postgresOptions('postgresql://nextstep_app:example@db.example.com/postgres'));
  const options=postgresOptions('postgresql://nextstep_app:example@db.example.com/postgres?sslmode=verify-full','PUBLIC\\nCERTIFICATE');
  assert.deepEqual(options.ssl,{rejectUnauthorized:true,ca:'PUBLIC\nCERTIFICATE'});
  assert.equal(new URL(options.connectionString).searchParams.has('sslmode'),false);
});

async function fixture(t) {
  const db = new PGlite();
  await db.exec('CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE ROLE anon; CREATE ROLE authenticated;');
  await db.exec(readFileSync(new URL('../server/hosted/schema.sql',import.meta.url),'utf8'));
  for (const person of [owner,editor,outsider,viewer]) await db.query('INSERT INTO auth.users(id) VALUES($1)',[person.id]);
  await db.query('INSERT INTO nextstep.workspaces(id,name) VALUES($1,$2),($3,$4)',[workspaceId,'Fictional team',otherWorkspaceId,'Separate team']);
  for (const [person,role] of [[owner,'owner'],[editor,'editor'],[viewer,'viewer']]) await db.query('INSERT INTO nextstep.members(workspace_id,email,role) VALUES($1,$2,$3)',[workspaceId,person.email,role]);
  let queue = Promise.resolve();
  let entityReads = 0;
  const pool = {
    async connect() {
      const previous = queue;
      let release;
      queue = new Promise(resolve => { release=resolve; });
      await previous;
      await db.exec('SET ROLE nextstep_app');
      return { query: (sql,params) => { if(sql.startsWith('SELECT table_name')) entityReads++; return db.query(sql,params); }, release };
    },
    end: async () => {},
  };
  const hosted = createHostedDatabase({ pool });
  const admin = async (sql,params) => { await queue; await db.exec('RESET ROLE'); return db.query(sql,params); };
  for (const person of [owner,editor,viewer]) assert.equal((await hosted.memberships(person,{claim:true})).length,1);
  const run = (person, method, path, input = {}) => {
    const op = workspaceOperation(method,path,new URLSearchParams(),input,person,'https://nextstep.example.com');
    return hosted.withWorkspace(person,workspaceId,op,op.run);
  };
  t.after(async()=>{ await queue; await db.close(); });
  return { db,hosted,admin,run,pool,entityReads:()=>entityReads };
}

test('Apple login uses PKCE and secure HttpOnly cookies without a browser token store',async()=>{
  const headers={};
  const response={getHeader:name=>headers[name],setHeader:(name,value)=>headers[name]=value};
  const auth=hostedAuth({headers:{}},response,{appUrl:'https://nextstep.example.com',supabaseUrl:'https://project.supabase.co',publishableKey:'sb_publishable_example'});
  const url=new URL(await auth.login());
  assert.equal(url.searchParams.get('provider'),'apple');
  assert.equal(url.searchParams.get('code_challenge_method'),'s256');
  assert.equal(url.searchParams.get('redirect_to'),'https://nextstep.example.com/api/auth/callback');
  assert.ok(url.searchParams.get('code_challenge'));
  assert.ok(headers['Set-Cookie'].every(cookie=>cookie.includes('HttpOnly')&&cookie.includes('Secure')&&cookie.includes('SameSite=Lax')));
  assert.ok(headers['Cache-Control'].includes('no-store'));
});

test('warm reads avoid transferring history again, recheck membership and reload when another instance writes',async t=>{
  const {pool,hosted,run,entityReads,admin}=await fixture(t);
  await run(owner,'POST','/api/crm/apply',change([collection]));
  const first=entityReads();
  await run(owner,'GET','/api/crm/context');
  await run(editor,'GET','/api/crm/context');
  assert.equal(entityReads(),first);
  const another=createHostedDatabase({pool});
  const op=workspaceOperation('POST','/api/crm/apply',new URLSearchParams(),change([{type:'create_record',collectionId:'people',collectionVersion:1,title:'Fictional separate-instance edit'}]),editor,'https://nextstep.example.com');
  await another.withWorkspace(editor,workspaceId,op,op.run);
  assert.equal((await run(owner,'POST','/api/crm/query',{collectionId:'people'})).total,1);
  assert.ok(entityReads()>first);
  await admin('UPDATE nextstep.members SET disabled_at=now() WHERE user_id=$1',[editor.id]);
  await assert.rejects(hosted.withWorkspace(editor,workspaceId,{},()=>({})),{status:403});
});

test('hosted membership is invite-only and every database query enforces workspace isolation', async t => {
  const {hosted,pool,admin}=await fixture(t);
  assert.deepEqual(await hosted.memberships(outsider,{claim:true}),[]);
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('nextstep.user_id',$1,true),set_config('nextstep.email',$2,true)",[owner.id,owner.email]);
    assert.equal((await client.query('SELECT * FROM nextstep.workspaces')).rows.length,1);
    assert.equal((await client.query('SELECT * FROM nextstep.members')).rows.length,1);
    await assert.rejects(client.query("INSERT INTO nextstep.entities VALUES($1,'crm_meta','1',$2)",[otherWorkspaceId,JSON.stringify({id:1,version:3})]));
    await client.query('ROLLBACK');
    await assert.rejects(client.query('UPDATE nextstep.members SET role=$1 WHERE user_id=$2',['owner',editor.id]));
  } finally { client.release(); }
  await admin('UPDATE nextstep.members SET disabled_at=now() WHERE user_id=$1',[editor.id]);
  assert.deepEqual(await hosted.memberships(editor),[]);
  await assert.rejects(hosted.withWorkspace(editor,workspaceId,{},()=>({})),{status:403});
});

test('hosted edits preserve validation, history, preview, retries, review and simultaneous-edit protection', async t => {
  const {run,hosted,admin}=await fixture(t);
  await run(owner,'POST','/api/crm/apply',change([collection]));
  const id=randomUUID(), create=change([{type:'create_record',id,collectionId:'people',collectionVersion:1,title:'Fictional Avery',values:{status:'New'}}]);
  await run(editor,'POST','/api/crm/preview',create);
  assert.equal((await run(owner,'POST','/api/crm/query',{collectionId:'people'})).total,0);
  await run(editor,'POST','/api/crm/apply',create);
  assert.equal((await run(editor,'POST','/api/crm/apply',create)).replayed,true);
  assert.equal((await run(owner,'GET','/api/crm/history')).events[0].actor,editor.email);
  await run(owner,'POST','/api/crm/apply',change([{type:'update_record',id,version:1,collectionVersion:1,values:{status:'Contacted'}}]));
  await assert.rejects(run(editor,'POST','/api/crm/apply',change([{type:'update_record',id,version:1,collectionVersion:1,title:'Stale overwrite'}])),{status:409});
  await assert.rejects(run(viewer,'POST','/api/crm/apply',change([{type:'archive_record',id,version:2}])),{status:403});
  await assert.rejects(run(editor,'PATCH','/api/crm/policy',{version:1,reviewRequired:true}),{status:403});
  await run(owner,'PATCH','/api/crm/policy',{version:1,reviewRequired:true});
  const token=await hosted.createToken(editor,workspaceId,'Fictional agent');
  const agent=await hosted.authenticateAgent(token.token);
  const pending=await run(agent,'POST','/api/crm/apply',change([{type:'archive_record',id,version:2}]));
  assert.equal(pending.status,'pending');
  assert.throws(()=>run(agent,'POST',`/api/crm/changes/${pending.id}/review`,{version:1,decision:'approve'}),{status:403});
  await run(owner,'POST',`/api/crm/changes/${pending.id}/review`,{version:1,decision:'approve'});
  assert.equal((await run(owner,'POST','/api/crm/query',{collectionId:'people',archived:true})).total,1);
  const rows=(await admin('SELECT user_id,agent_token_id FROM nextstep.audit WHERE agent_token_id IS NOT NULL')).rows;
  assert.equal(rows[0].user_id,editor.id);
  assert.equal(rows[0].agent_token_id,token.id);
  await hosted.revokeToken(editor,workspaceId,token.id);
  await assert.rejects(hosted.authenticateAgent(token.token),{status:401});
});

test('agent admission is revoked when the person loses membership, including a previously verified credential',async t=>{
  const {hosted,admin}=await fixture(t);
  const token=await hosted.createToken(editor,workspaceId,'Fictional agent');
  const identity=await hosted.authenticateAgent(token.token);
  await admin('UPDATE nextstep.members SET disabled_at=now() WHERE user_id=$1',[editor.id]);
  await assert.rejects(hosted.authenticateAgent(token.token),{status:401});
  await assert.rejects(hosted.withWorkspace(identity,workspaceId,{},()=>({})),{status:403});
});

test('selective transfers exclude personal records, notes, mixed change metadata and sync paths; imports are checked and idempotent',async t=>{
  const engine=openWorkspaceEngine();
  const contactId=randomUUID(), privateId=randomUUID(), noteId=randomUUID();
  engine.crm.apply(change([collection,{...collection,id:'private',name:'Private'}]));
  const mixed=change([{type:'create_record',id:contactId,collectionId:'people',collectionVersion:1,title:'Fictional contact'},{type:'create_record',id:privateId,collectionId:'private',collectionVersion:1,title:'PRIVATE_SENTINEL'}]);
  mixed.title='PRIVATE_SENTINEL'; mixed.summary='PRIVATE_SENTINEL';
  engine.crm.apply(mixed);
  engine.crm.apply(change([{type:'create_note',id:noteId,title:'Fictional outreach note',body:'Keep this exact note.',links:[contactId]}]));
  const before=engine.rows();
  const rows=selectWorkspaceRows(before,{collectionIds:['people'],noteIds:[noteId]});
  assert.ok(!JSON.stringify(rows).includes('PRIVATE_SENTINEL'));
  assert.deepEqual(engine.rows(),before);
  const reopened=openWorkspaceEngine(rows);
  assert.equal(reopened.crm.notes.get(noteId).body,'Keep this exact note.');
  assert.equal(reopened.crm.getRecord(contactId).version,1);
  assert.equal(reopened.crm.history({entityId:contactId}).length,1);
  reopened.close();engine.close();
  const {admin}=await fixture(t);
  const transfer={format:'nextstep-hosted-transfer',version:1,rows,fingerprint:fingerprint(rows),counts:{records:2}};
  const client={query:admin};
  assert.equal((await importTransfer(client,workspaceId,transfer)).status,'preview');
  assert.equal((await importTransfer(client,workspaceId,transfer,{apply:true})).status,'imported');
  assert.equal((await importTransfer(client,workspaceId,transfer,{apply:true})).status,'already_imported');
  await assert.rejects(importTransfer(client,workspaceId,{...transfer,rows:rows.slice(1)},{apply:true}));
});

function request(method,path,body,headers={}) {
  const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);
  req.method=method; req.url=path;req.headers={host:'nextstep.example.com',...(body===undefined?{}:{'content-type':'application/json'}),...headers};
  let text='';
  const res={statusCode:200,headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=value;},getHeader(name){return this.headers[name.toLowerCase()];},end(value){text=value||'';}};
  return {req,res,result:()=>({status:res.statusCode,headers:res.headers,body:text?JSON.parse(text):null})};
}
test('a second hosted origin has its own sign-in callback and rejects cross-origin requests', async () => {
  const primary = 'https://nextstep.example.com';
  const additional = 'https://crm.example.com';
  const handler = createHostedHandler({
    config: { appUrl: primary, additionalAppUrl: additional },
    database: {},
    authFactory: (_req, _res, { appUrl }) => ({
      login: async () => `${appUrl}/api/auth/callback`,
      user: async () => null,
    }),
  });
  async function call(path, headers) {
    const { req, res, result } = request('GET', path, undefined, headers);
    await handler(req, res);
    return result();
  }

  for (const appUrl of [primary, additional]) {
    const host = new URL(appUrl).host;
    const login = await call('/api/auth/login', { host });
    assert.equal(login.status, 303);
    assert.equal(login.headers.location, `${appUrl}/api/auth/callback`);
    const failed = await call('/api/auth/callback?error=denied', { host });
    assert.equal(failed.headers.location, `${appUrl}/?signin=failed`);
    assert.equal((await call('/api/crm/context', { host })).status, 401);
  }

  const host = new URL(additional).host;
  assert.equal((await call('/api/auth/session', { host, origin: primary })).status, 403);
  assert.equal((await call('/api/auth/session', { host: 'other.example.com', origin: additional })).status, 403);
});

test('hosted HTTP protects direct endpoints, cookies, origins, access and agent review without exposing configuration',async t=>{
  const {hosted,run}=await fixture(t);
  let signedIn=null;
  const handler=createHostedHandler({config:{appUrl:'https://nextstep.example.com'},database:hosted,authFactory:()=>({user:async()=>signedIn,logout:async()=>{},login:async()=> 'https://appleid.apple.com/authorize',exchange:async()=>{}})});
  async function call(method,path,body,headers){const x=request(method,path,body,headers);await handler(x.req,x.res);return x.result();}
  for(const path of ['/api/crm/context','/api/crm/export','/api/crm/history','/api/notes']) assert.equal((await call('GET',path)).status,401);
  assert.equal((await call('GET','/api/auth/session')).body.authenticated,false);
  assert.equal((await call('GET','/api/crm/context',undefined,{host:'foreign.example.com'})).status,403);
  signedIn=outsider;
  assert.equal((await call('GET','/api/crm/context')).status,403);
  signedIn=owner;
  assert.equal((await call('POST','/api/crm/apply',change([collection]))).status,403);
  assert.equal((await call('POST','/api/crm/apply',change([collection]),{origin:'https://foreign.example.com'})).status,403);
  const context=await call('GET','/api/crm/context');
  assert.equal(context.status,200);assert.equal(context.headers['cache-control'],'private, no-store');
  assert.ok(!JSON.stringify(context).includes('postgresql://'));
  assert.equal((await call('GET','/api/profile')).status,404);
  assert.equal((await call('POST','/api/auth/logout',{}, {origin:'https://nextstep.example.com'})).status,200);
  const parsed=request('POST','/api/crm/query',undefined,{origin:'https://nextstep.example.com','content-type':'application/json'});
  parsed.req.body={collectionId:'missing'};
  await handler(parsed.req,parsed.res);
  assert.equal(parsed.result().status,404);
  const invalid=request('POST','/api/crm/query',undefined,{origin:'https://nextstep.example.com','content-type':'application/json'});
  invalid.req.body='[1]';
  await handler(invalid.req,invalid.res);
  assert.equal(invalid.result().status,400);
  await run(owner,'POST','/api/crm/apply',change([collection]));
  const token=await hosted.createToken(editor,workspaceId,'Fictional agent');
  const remote=createRemoteCrm({server:'https://nextstep.example.com',workspace:workspaceId,credential:token.token,fetchImpl:async(url,options)=>{
    const headers=Object.fromEntries(Object.entries(options.headers).map(([key,value])=>[key.toLowerCase(),value]));
    const result=await call(options.method,new URL(url).pathname+new URL(url).search,options.body?JSON.parse(options.body):undefined,headers);
    return {ok:result.status<400,status:result.status,json:async()=>result.body};
  }});
  assert.equal((await remote.context()).collections[0].id,'people');
  const applied=await remote.agentApply(change([{type:'create_record',collectionId:'people',collectionVersion:1,title:'Fictional remote contact'}]));
  assert.equal(applied.status,'applied');
  assert.equal((await remote.query({collectionId:'people'})).total,1);
});

test('local MCP bridge writes hosted notes, survives cold reads, honors review and revocation', {timeout:60000}, async t=>{
  const {hosted,run,admin,pool}=await fixture(t);
  const token=await hosted.createToken(editor,workspaceId,'Fictional local agent');
  let handler;
  const http=createServer((req,res)=>void handler(req,res));
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${http.address().port}`;
  handler=createHostedHandler({config:{appUrl:origin},database:hosted,authFactory:()=>({user:async()=>null})});
  const directory=mkdtempSync(join(tmpdir(),'nextstep-hosted-mcp-')), file=join(directory,'credential');
  const missingDatabase=join(directory,'must-not-exist.sqlite');
  writeFileSync(file,token.token,{mode:0o600});
  const executable=process.env.NEXTSTEP_TEST_MCP_EXECUTABLE;
  const args=[...(executable ? [...(process.env.NEXTSTEP_TEST_MCP_SOURCE ? [resolve('.')] : []),'--crm-mcp'] : [resolve('mcp/crm-stdio.mjs')]),'--server',origin,'--workspace',workspaceId,'--credential-file',file];
  const client=new Client({name:'fictional-hosted-mcp-test',version:'1.0.0'});
  const transport=new StdioClientTransport({command:executable || process.execPath,args,stderr:'pipe',env:{NEXTSTEP_USER_DATA:join(directory,'settings'),NEXTSTEP_DB_PATH:missingDatabase,NEXTSTEP_DISABLE_UPDATES:'1',NEXTSTEP_DISABLE_USAGE:'1'}});
  try {
    await client.connect(transport);
    const call=async(name,input={})=>{
      const value=await client.callTool({name,arguments:input});
      assert.ok(!value.isError,JSON.stringify(value.content));
      return value.structuredContent;
    };
    const context=await call('nextstep_crm_context');
    assert.equal(context.hosted.workspaceId,workspaceId);
    assert.ok(context.connection.mcpServers['nextstep-shared']);
    const id=randomUUID();
    const note={changeId:randomUUID(),title:'Fictional hosted writing',mode:'apply',operation:{type:'create_note',id,title:'Fictional shared note',body:'Saved through a local MCP agent.'}};
    await call('nextstep_crm_write_note',{...note,mode:'preview'});
    assert.equal((await run(owner,'GET','/api/notes')).total,0);
    await call('nextstep_crm_write_note',note);
    assert.equal((await call('nextstep_crm_notes',{id})).note.body,'Saved through a local MCP agent.');
    const saved=(await admin("SELECT data FROM nextstep.entities WHERE workspace_id=$1 AND table_name='crm_note_documents' AND row_id=$2",[workspaceId,id])).rows[0];
    assert.equal(saved.data.body,'Saved through a local MCP agent.');
    const cold=createHostedDatabase({pool});
    const read=workspaceOperation('GET',`/api/notes/${id}`,new URLSearchParams(),{},owner,origin);
    assert.equal((await cold.withWorkspace(owner,workspaceId,read,read.run)).body,saved.data.body);
    await run(owner,'PATCH','/api/crm/policy',{version:1,reviewRequired:true});
    const pendingId=randomUUID();
    const pending=await call('nextstep_crm_write_note',{changeId:pendingId,title:'Fictional reviewed append',mode:'apply',operation:{type:'append_note',id,version:1,text:'Reviewed addition.'}});
    assert.equal(pending.status,'pending');
    assert.equal((await call('nextstep_crm_notes',{id})).note.body,saved.data.body);
    await run(owner,'POST',`/api/crm/changes/${pendingId}/review`,{version:1,decision:'approve'});
    assert.match((await call('nextstep_crm_notes',{id})).note.body,/Reviewed addition/);
    await hosted.revokeToken(editor,workspaceId,token.id);
    assert.equal((await client.callTool({name:'nextstep_crm_context',arguments:{}})).isError,true);
    assert.equal(existsSync(missingDatabase),false);
  } finally {
    await client.close();
    http.closeAllConnections();
    await new Promise(resolve=>http.close(resolve));
    rmSync(directory,{recursive:true,force:true});
  }
});
