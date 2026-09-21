import { _electron as electron, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openStore } from '../server/store.mjs';
import { root } from '../server/config.mjs';

const directory = mkdtempSync(join(tmpdir(),'nextstep-desktop-'));
const database = join(directory,'test.sqlite');
const userData = join(directory,'electron');
const store = openStore(database);
store.updateProfile({version:0,roles:'User-selected work'});
const choice = store.create({company:'QA Interested',role:'Chosen work',stage:'interested'});
const before = store.get(choice.id);
const executablePath = process.argv[2];
let app;
const client = new Client({name:'nextstep-desktop-check',version:'1.0.0'});
let connected = false;
try {
  app = await electron.launch({...(executablePath ? {executablePath,args:['--database',database]} : {args:[root,'--database',database]}),env:{...process.env,NEXTSTEP_DB_PATH:'',DB_PATH:'',NEXTSTEP_USER_DATA:userData},timeout:30000});
  const page = await app.firstWindow();
  // Electron handles before-unload in its native will-prevent-unload listener.
  // Do not let Playwright race that handler with an automatic dialog response.
  page.on('dialog',() => {});
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  await expect(page.getByRole('button',{name:'Open QA Interested',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Search agent',exact:true}).click();
  await page.getByLabel('Choose your desktop agent').selectOption('codex');
  await page.getByLabel('When should it search?').fill('Weekdays at 10:00');
  await page.getByLabel('Timezone',{exact:true}).fill('UTC');
  await page.getByRole('button',{name:'Save setup choices'}).click();
  await expect(page.getByText('Setup choices saved.',{exact:false})).toBeVisible();
  await page.getByText('Connection settings',{exact:true}).click();
  await expect(page.locator('.agent-config')).toContainText('--database');
  await expect(page.locator('.agent-config')).toContainText(database);
  await expect(page.getByText('No scheduled task has been reported yet.')).toBeVisible();
  mkdirSync(resolve(root,'test-results'),{recursive:true});
  await page.screenshot({path:resolve(root,'test-results/desktop-agent.png')});
  await page.getByLabel('When should it search?').fill('Unsaved schedule edit');
  await app.evaluate(({BrowserWindow,dialog}) => {
    globalThis.nextstepOriginalDialog = dialog.showMessageBoxSync;
    dialog.showMessageBoxSync = () => { globalThis.nextstepKeptEditing = true; return 0; };
    BrowserWindow.getAllWindows()[0].close();
  });
  await expect.poll(() => app.evaluate(() => globalThis.nextstepKeptEditing)).toBe(true);
  await expect(page.getByLabel('When should it search?')).toHaveValue('Unsaved schedule edit');
  expect(store.agentStatus().schedule.cadence).toBe('Weekdays at 10:00');
  await page.getByRole('button',{name:'Close',exact:true}).first().click();
  await page.getByRole('button',{name:'Discard changes',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await app.evaluate(({dialog}) => { dialog.showMessageBoxSync = globalThis.nextstepOriginalDialog; });
  const connection = await app.evaluate(() => ({executable:process.execPath}));
  const args = [...(executablePath ? [] : [root]),'--mcp','--database',database];
  const transport = new StdioClientTransport({command:connection.executable,args,env:{NEXTSTEP_USER_DATA:join(directory,'mcp-profile')},stderr:'pipe'});
  await client.connect(transport); connected = true;
  const input = {opportunities:[{company:'QA MCP Match',role:'Verified example',url:'https://example.com/job/desktop',notes:'Fictional test source'}],dryRun:false};
  const result = await client.callTool({name:'nextstep_import_prospects',arguments:input});
  if (result.isError) throw new Error(JSON.stringify(result.content));
  await expect(page.getByRole('button',{name:'Open QA MCP Match',exact:true})).toBeVisible({timeout:25000});
  await client.callTool({name:'nextstep_record_search',arguments:{id:'desktop-check-1',summary:'Saved one verified example',learning:'Use the current Interested choice as a positive example.',evidenceIds:[choice.id],importedIds:[result.structuredContent.created[0].id]}});
  await page.screenshot({path:resolve(root,'test-results/desktop-live-update.png')});
  await app.close(); app = null;
  const context = (await client.callTool({name:'nextstep_get_context',arguments:{}})).structuredContent;
  expect(context.byStage.prospect[0].company).toBe('QA MCP Match');
  expect(context.recentSearches[0].id).toBe('desktop-check-1');
  expect(store.get(choice.id)).toEqual(before);
  expect(errors).toEqual([]);
  console.log('Desktop check passed: window, explicit database path, SQLite persistence, schedule setup, protected unsaved edits, MCP import, live board refresh, preserved decisions, and MCP access with the window closed.');
} finally {
  if (connected) await client.close();
  if (app) await app.close();
  store.close(); rmSync(directory,{recursive:true,force:true});
}
