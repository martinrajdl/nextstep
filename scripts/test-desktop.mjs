import { _electron as electron, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
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
const executablePath = process.argv[2] === '--source' ? undefined : process.argv[2];
const provider = process.argv[3] || 'codex';
if (!['codex','claude-code'].includes(provider)) throw new Error('Choose codex or claude-code.');
const label = provider === 'codex' ? 'Codex' : 'Claude Code';
let app;
const client = new Client({name:'nextstep-desktop-check',version:'1.0.0'});
let connected = false;
let clipboardBefore;
let copiedRequest;
try {
  app = await electron.launch({...(executablePath ? {executablePath,args:['--database',database]} : {args:[root,'--database',database]}),env:{...process.env,NEXTSTEP_DB_PATH:'',DB_PATH:'',NEXTSTEP_USER_DATA:userData,NEXTSTEP_AGENT_CONFIG_HOME:join(directory,'agent-config')},timeout:30000});
  const page = await app.firstWindow();
  // Electron handles before-unload in its native will-prevent-unload listener.
  // Do not let Playwright race that handler with an automatic dialog response.
  page.on('dialog',() => {});
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  await expect(page.getByRole('heading',{name:'What would you love to do next?'})).toBeVisible();
  await expect(page.getByLabel('Roles and work you want')).toHaveValue('User-selected work');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:label,exact:false}).click();
  await page.getByLabel('When should it look for jobs?').selectOption('weekdays');
  await page.getByLabel('Time',{exact:true}).fill('10:00');
  await page.getByLabel('Timezone',{exact:true}).fill('UTC');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  const automatic = await page.evaluate(async provider => (await window.nextstepDesktop.getAgents()).some(agent => agent.provider === provider && agent.canConnect),provider);
  expect(store.agentStatus().onboarding.connectedAt).toBeNull();
  expect(store.agentStatus().schedule.taskId).toBe('');
  await page.getByText('Advanced connection',{exact:true}).click();
  await expect(page.locator('.agent-config')).toContainText('--database');
  await expect(page.locator('.agent-config')).toContainText(database);
  if (!automatic) await page.getByLabel('I added the connection in my agent').check();
  await expect(page.getByText('Waiting for the agent to report its schedule')).toBeVisible();
  // Test the handoff without opening or sending anything to a real agent.
  await app.evaluate(({shell}) => {
    shell.openPath = async () => { throw new Error('Generic app opening must not be used for an agent handoff.'); };
    shell.openExternal = async url => { globalThis.openedAgentUrl = url; };
  });
  clipboardBefore = await app.evaluate(({clipboard}) => clipboard.readText());
  // Native opening must also work when the browser clipboard API is unavailable.
  if (automatic) await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Clipboard unavailable'); }; });
  await page.getByRole('button',{name:automatic ? `Open setup in ${label}` : 'Copy setup request',exact:true}).click();
  if (automatic) {
    await expect(page.getByRole('heading',{name:`Connection added to ${label}`})).toBeVisible({timeout:30000});
    const opened = new URL(await app.evaluate(() => globalThis.openedAgentUrl));
    expect(opened.protocol).toBe(provider === 'codex' ? 'codex:' : 'claude:');
    expect(opened.host).toBe(provider === 'codex' ? 'threads' : 'code');
    expect(opened.pathname).toBe('/new');
    expect(opened.searchParams.get(provider === 'codex' ? 'path' : 'folder')).toBe(join(userData,'Research'));
    expect(existsSync(join(userData,'Research'))).toBe(true);
    const request = opened.searchParams.get(provider === 'codex' ? 'prompt' : 'q');
    expect(request).toContain(database);
    expect(request).toContain(store.agentStatus().onboarding.connectionToken);
    expect(store.agentStatus().onboarding.connectedAt).toBeNull();
    if (provider === 'codex') expect(opened.searchParams.get('mode')).toBe('codex');
    else {
      const config = JSON.parse(readFileSync(join(directory,'agent-config/.claude.json'),'utf8'));
      expect(config.mcpServers.nextstep.args.slice(-2)).toEqual(['--database',database]);
    }
  } else {
    await expect.poll(() => app.evaluate(({clipboard}) => clipboard.readText())).toContain(database);
    copiedRequest = await app.evaluate(({clipboard}) => clipboard.readText());
    expect(copiedRequest).toContain(store.agentStatus().onboarding.connectionToken);
  }
  mkdirSync(resolve(root,'test-results'),{recursive:true});
  await page.screenshot({path:resolve(root,`test-results/desktop-agent-${provider}.png`)});
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.getByLabel('Time',{exact:true}).fill('11:00');
  await app.evaluate(({BrowserWindow,dialog}) => {
    globalThis.nextstepOriginalDialog = dialog.showMessageBoxSync;
    dialog.showMessageBoxSync = () => { globalThis.nextstepKeptEditing = true; return 0; };
    BrowserWindow.getAllWindows()[0].close();
  });
  await expect.poll(() => app.evaluate(() => globalThis.nextstepKeptEditing)).toBe(true);
  await expect(page.getByLabel('Time',{exact:true})).toHaveValue('11:00');
  expect(store.agentStatus().schedule.cadence).toBe('Weekdays at 10:00');
  await page.getByRole('button',{name:'Close setup',exact:true}).click();
  await page.getByRole('button',{name:'Discard changes',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await app.evaluate(({dialog}) => { dialog.showMessageBoxSync = globalThis.nextstepOriginalDialog; });
  const connection = await app.evaluate(() => ({executable:process.execPath}));
  const args = [...(executablePath ? [] : [root]),'--mcp','--database',database];
  const transport = new StdioClientTransport({command:connection.executable,args,env:{NEXTSTEP_USER_DATA:join(directory,'mcp-profile')},stderr:'pipe'});
  await client.connect(transport); connected = true;
  await page.getByRole('button',{name:'Search agent',exact:true}).click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  const confirmation = await client.callTool({name:'nextstep_confirm_connection',arguments:{token:store.agentStatus().onboarding.connectionToken}});
  expect(confirmation.isError).toBeUndefined();
  await expect(page.getByText('Agent connection confirmed',{exact:true})).toBeVisible({timeout:10000});
  const registration = await client.callTool({name:'nextstep_register_schedule',arguments:{version:store.agentStatus().schedule.version,taskId:'desktop-test-schedule'}});
  expect(registration.isError).toBeUndefined();
  await expect(page.getByText('Agent reported the scheduled task',{exact:true})).toBeVisible({timeout:10000});
  await page.screenshot({path:resolve(root,'test-results/desktop-onboarding-confirmed.png')});
  await page.getByRole('button',{name:'Go to my board',exact:true}).click();
  const input = {opportunities:[{company:'QA MCP Match',role:'Verified example',url:'https://example.com/job/desktop',notes:'Fictional test source'}],dryRun:false};
  const result = await client.callTool({name:'nextstep_import_prospects',arguments:input});
  if (result.isError) throw new Error(JSON.stringify(result.content));
  await expect(page.getByRole('button',{name:'Open QA MCP Match',exact:true})).toBeVisible({timeout:25000});
  await client.callTool({name:'nextstep_record_search',arguments:{id:'desktop-check-1',summary:'Saved one verified example',learning:'Use the current Interested choice as a positive example.',evidenceIds:[choice.id],importedIds:[result.structuredContent.created[0].id]}});
  await page.screenshot({path:resolve(root,'test-results/desktop-live-update.png')});
  await page.getByRole('button',{name:'Search agent',exact:true}).click();
  await expect(page.getByText('Saved one verified example',{exact:true})).toBeVisible();
  if (automatic) {
    await page.getByRole('button',{name:`Find matches with ${label}`,exact:true}).click();
    await expect.poll(async () => new URL(await app.evaluate(() => globalThis.openedAgentUrl)).searchParams.get(provider === 'codex' ? 'prompt' : 'q')).toContain('Do not create or change any schedule.');
    const opened = new URL(await app.evaluate(() => globalThis.openedAgentUrl));
    expect(opened.host).toBe(provider === 'codex' ? 'threads' : 'code');
    expect(opened.pathname).toBe('/new');
    expect(opened.searchParams.get(provider === 'codex' ? 'prompt' : 'q')).toContain(database);
  }
  await page.getByRole('button',{name:'Close',exact:true}).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  if (copiedRequest !== undefined) await app.evaluate(({clipboard},{before,copied}) => { if (clipboard.readText() === copied) clipboard.writeText(before); },{before:clipboardBefore,copied:copiedRequest});
  await app.close(); app = null;
  const context = (await client.callTool({name:'nextstep_get_context',arguments:{}})).structuredContent;
  expect(context.byStage.prospect[0].company).toBe('QA MCP Match');
  expect(context.recentSearches[0].id).toBe('desktop-check-1');
  expect(store.get(choice.id)).toEqual(before);
  expect(errors).toEqual([]);
  console.log(`Desktop check passed for ${label}: guided onboarding, isolated configuration, new coding conversation with the complete request and local folder, clipboard-independent handoff, real MCP confirmation/import, schedule reporting, live board refresh, preserved decisions, and MCP access with the window closed.`);
} finally {
  if (connected) await client.close();
  if (app) {
    if (copiedRequest !== undefined) await app.evaluate(({clipboard},{before,copied}) => { if (clipboard.readText() === copied) clipboard.writeText(before); },{before:clipboardBefore,copied:copiedRequest}).catch(() => {});
    await app.close();
  }
  store.close(); rmSync(directory,{recursive:true,force:true});
}
