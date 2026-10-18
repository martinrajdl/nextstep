import { _electron as electron, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';
import { root } from '../server/config.mjs';
import { crmAgentRequest } from '../lib/crm-agent-request.ts';

// Every write, including the agent configuration, is isolated from user data.
const directory = mkdtempSync(join(tmpdir(), 'nextstep-crm-desktop-'));
const database = join(directory, 'fictional.sqlite');
const userData = join(directory, 'profile');
const store = openStore(database);
store.create({ company:'Fictional preserved job', stage:'interested', notes:'Keep this decision.' });
const originalJobs = store.list();
const executablePath = process.argv[2] === '--source' ? undefined : process.argv[2];
const client = new Client({ name:'nextstep-crm-desktop-check', version:'1.0.0' });
let app;
let connected = false;
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments:args });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  return result.structuredContent;
}
try {
  app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args:[...(executablePath ? [] : [root]), '--database', database],
    env:{ ...process.env, NEXTSTEP_DB_PATH:'', DB_PATH:'', NEXTSTEP_DISABLE_UPDATES:'1', NEXTSTEP_USER_DATA:userData, NEXTSTEP_AGENT_CONFIG_HOME:join(directory,'agents') },
    timeout:30000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('heading',{name:'Connect your agent.'})).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Create a collection',exact:true})).not.toBeVisible();
  await expect(page.locator('.desktop-titlebar')).toHaveCount(0);
  expect((await page.locator('.crm-sidebar').boundingBox()).y).toBe(0);
  mkdirSync(join(root,'test-results'),{recursive:true});
  await page.screenshot({path:join(root,'test-results/desktop-crm-start.png')});
  const agents = await page.evaluate(() => window.nextstepDesktop.getAgents());
  const agent = agents.find(value => value.canConnect);
  if (!agent) throw new Error('Install Codex or Claude Code to verify the native setup handoff.');
  await app.evaluate(({shell}) => {
    shell.openExternal = async url => { globalThis.crmSetupUrl = url; };
  });
  await page.getByRole('button',{name:new RegExp(`Connect ${agent.label}`)}).click();
  await expect(page.locator('.crm-setup-status')).toContainText(`Send the prepared request in ${agent.label}`,{timeout:30000});
  const opened = new URL(await app.evaluate(() => globalThis.crmSetupUrl));
  expect(opened.protocol).toBe(agent.provider === 'codex' ? 'codex:' : 'claude:');
  expect(opened.searchParams.get(agent.provider === 'codex' ? 'prompt' : 'q')).toBe(crmAgentRequest);
  expect(opened.searchParams.get(agent.provider === 'codex' ? 'path' : 'folder')).toBe(join(userData,'Workspace'));

  // Use the exact connection exposed by the renderer, as the configured agent does.
  const connection = await page.evaluate(async () => (await (await fetch('/api/crm/context')).json()).connection.mcpServers['nextstep-crm']);
  expect(connection.args.slice(-2)).toEqual(['--database',database]);
  expect(connection.args).toContain('--crm-mcp');
  expect(connection.args).not.toContain('--allow-writes');
  await client.connect(new StdioClientTransport({ ...connection, env:{NEXTSTEP_DISABLE_UPDATES:'1', NEXTSTEP_USER_DATA:join(directory,'helper')}, stderr:'pipe' }));
  connected = true;
  expect((await client.listTools()).tools.some(tool => tool.name === 'nextstep_crm_apply')).toBe(false);
  expect((await call('nextstep_crm_context')).collections).toHaveLength(0);
  await call('nextstep_crm_report_flow',{id:'first-workspace',reportId:'source',version:0,goal:'Organize fictional collaborators',stage:'sourcing',message:'Organizing the information you shared.'});
  await app.evaluate(({app,BrowserWindow}) => { app.focus({steal:true}); BrowserWindow.getAllWindows()[0].focus(); });
  await expect(page.locator('.crm-setup-status')).toContainText('Organizing the information you shared.',{timeout:10000});
  const proposal = {
    id:randomUUID(), title:'Set up your collaborators', actor:'Example agent',
    summary:'A People collection with company, email and relationship fields, plus a board view.',
    operations:[
      {type:'create_collection',id:'people',name:'People',fields:[
        {key:'company',name:'Company',type:'text'},
        {key:'email',name:'Email',type:'email'},
        {key:'relationship',name:'Relationship',type:'select',options:['New','In touch','Collaborating']},
      ]},
      {type:'create_record',collectionId:'people',collectionVersion:1,title:'Fictional Avery',values:{company:'Cedar Studio',email:'avery@example.com',relationship:'In touch'}},
      {type:'create_view',collectionId:'people',name:'By relationship',layout:'board',groupBy:'relationship'},
    ],
  };
  expect((await call('nextstep_crm_preview',proposal)).diffs).toHaveLength(3);
  expect(store.crm.collections()).toHaveLength(0);
  expect((await call('nextstep_crm_propose',proposal)).status).toBe('pending');
  await call('nextstep_crm_report_flow',{id:'first-workspace',reportId:'review',version:1,stage:'review',message:'Your workspace is ready for review.',changeIds:[proposal.id]});
  await app.evaluate(({app,BrowserWindow}) => { app.focus({steal:true}); BrowserWindow.getAllWindows()[0].focus(); });
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');
  await expect(page.getByRole('heading',{name:'Ready for your review.'})).toBeVisible({timeout:10000});
  expect(store.crm.collections()).toHaveLength(0);
  await page.getByRole('button',{name:'Review proposed changes',exact:true}).click();
  await page.getByRole('button',{name:/Set up your collaborators/}).click();
  await expect(page.getByRole('dialog')).toContainText('Company');
  await expect(page.getByRole('dialog')).toContainText('avery@example.com');
  await page.getByRole('button',{name:'Approve change',exact:true}).click();
  await expect(page.getByRole('heading',{name:'People',exact:true})).toBeVisible();
  await expect(page.getByRole('columnheader',{name:'Company',exact:true})).toBeVisible();
  await expect(page.getByRole('columnheader',{name:'Email',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/^(?!Actions).*Fictional Avery/})).toBeVisible();
  await page.getByRole('button',{name:'By relationship',exact:true}).click();
  await expect(page.getByRole('region',{name:'In touch column'}).getByRole('button',{name:'Actions for Fictional Avery'})).toBeAttached();
  await expect(page.locator('.crm-board article select')).toHaveCount(0);
  await call('nextstep_crm_report_flow',{id:'first-workspace',reportId:'complete',version:2,stage:'complete',message:'Your collaborators are ready.'});
  await page.getByRole('link',{name:'Workspace home',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your workspace',exact:true})).toBeVisible();
  await expect(page.getByText('Your collaborators are ready.',{exact:true})).toBeVisible({timeout:10000});
  expect(store.list()).toEqual(originalJobs);
  expect(errors).toEqual([]);
  await page.screenshot({path:join(root,'test-results/desktop-crm-complete.png')});
  await app.close(); app = null;
  expect((await call('nextstep_crm_query',{collectionId:'people'})).records[0].title).toBe('Fictional Avery');
  console.log('Desktop CRM setup passed: isolated native connection, prepared unsent conversation, real MCP progress and schema proposal, human approval, automatic collection opening, generated fields and board view, preserved Jobs, and agent access after closing the app.');
} finally {
  if (connected) await client.close();
  if (app) await app.close();
  store.close();
  rmSync(directory,{recursive:true,force:true});
}
