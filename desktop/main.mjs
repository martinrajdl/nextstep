import { app, BrowserWindow, Menu, dialog, shell, ipcMain, nativeTheme, autoUpdater } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertNextstepDatabase } from '../server/database-file.mjs';
import { startServer } from '../server/http.mjs';
import { startMcp, databaseArgument } from '../mcp/stdio.mjs';
import { startCrmMcp } from '../mcp/crm-stdio.mjs';
import { createAgentConnector } from './agent-connector.mjs';
import { connectionConfig, setupInstructions, searchInstructions } from '../server/agent-instructions.mjs';
import { agentHandoffUrl } from './agent-handoff.mjs';
import { APPEARANCES, THEMES, accentColor, themePreference, readPreferences, writePreferences } from './preferences.mjs';
import { backendOrigin } from '../server/backend.mjs';
import { crmAgentRequest } from '../lib/crm-agent-request.ts';
import { createUsageReporter } from './usage.mjs';
import { createUpdater } from './updates.mjs';
import { createHash } from 'node:crypto';

app.setName('Nextstep');
if (process.env.NEXTSTEP_USER_DATA) app.setPath('userData',resolve(process.env.NEXTSTEP_USER_DATA));
const crmMcpMode = process.argv.includes('--crm-mcp');
const mcpMode = process.argv.includes('--mcp') || crmMcpMode;
let service;
let window;
let usage;
let updater;

function iconPath() {
  return resolve(app.getAppPath(),app.isPackaged ? 'nextstep.png' : 'desktop/icons/nextstep.png');
}

function savedDatabase() {
  const value = readPreferences(app.getPath('userData'));
  if (!Object.hasOwn(value,'database')) return null;
  if (typeof value.database !== 'string' || !value.database) throw new Error('The saved database setting is invalid.');
  if (!existsSync(value.database)) throw new Error(`Your selected database is unavailable: ${value.database}. No replacement database was created.`);
  return value.database;
}
function appDatabase() {
  const explicit = process.argv.includes('--database') || process.env.NEXTSTEP_DB_PATH || process.env.DB_PATH;
  if (explicit) {
    // Packaged Electron puts the first flag at argv[1]; development includes the app path there.
    const path = databaseArgument(process.argv.slice(1));
    if (!existsSync(path)) throw new Error(`The selected database does not exist: ${path}`);
    return path;
  }
  const saved = savedDatabase();
  if (saved) return saved;
  const path = resolve(app.getPath('userData'),'nextstep.sqlite');
  // Persist the choice after initialization so a missing established file is never silently replaced.
  return path;
}
function remember(database) {
  writePreferences(app.getPath('userData'),{database,backendUrl:null});
}
function preferences() {
  const saved = readPreferences(app.getPath('userData'));
  return {accent:saved.accent || APPEARANCES[0].color,theme:THEMES.includes(saved.theme) ? saved.theme : 'light',backendUrl:service?.backendUrl || null,usageEnabled:saved.usageAnalytics?.enabled === true};
}
function validateSender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || new URL(event.senderFrame.url).origin !== service.url) throw new Error('This action is only available in the Nextstep window.');
}
function setAppearance(color) {
  const accent = accentColor(color);
  writePreferences(app.getPath('userData'),{accent});
  window?.webContents.send('nextstep:appearance-changed',accent);
  buildMenu();
  return accent;
}
function setTheme(value) {
  const theme = themePreference(value);
  writePreferences(app.getPath('userData'),{theme});
  nativeTheme.themeSource = theme;
  window?.webContents.send('nextstep:theme-changed',theme);
  buildMenu();
  return theme;
}
async function showSettings() {
  await showWindow();
  window.webContents.send('nextstep:open-settings');
}
function buildMenu() {
  const {accent,theme,backendUrl} = preferences();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{label:'Nextstep',submenu:[{role:'about'},{label:'Check for Updates…',click:() => { void showSettings(); void updater?.check(); }},{label:'Settings…',accelerator:'CmdOrCtrl+,',click:() => { void showSettings(); }},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]}] : []),
    {label:'File',submenu:[{label:'Open database…',click:() => { void openDatabase(); }},{label:'Show database in folder',enabled:!backendUrl,click:() => shell.showItemInFolder(service.database)},{label:'Backend connection…',click:() => { void showSettings(); }},{type:'separator'},{role:process.platform === 'darwin' ? 'close' : 'quit'}]},
    {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'View',submenu:[{label:'Appearance',submenu:[...THEMES.map(value => ({id:`theme-${value}`,label:value[0].toUpperCase()+value.slice(1),type:'radio',checked:theme === value,click:() => setTheme(value)})),{type:'separator'},...APPEARANCES.map(({name,color}) => ({id:`appearance-${name.toLowerCase()}`,label:`${name} accent`,type:'radio',checked:accent === color,click:() => setAppearance(color)})),{label:'Custom color…',click:() => { void showSettings(); }}]},{label:'Settings…',accelerator:process.platform === 'darwin' ? undefined : 'CmdOrCtrl+,',click:() => { void showSettings(); }},{type:'separator'},{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]},
    {label:'Window',submenu:[{role:'minimize'},{role:'zoom'}]}
  ]));
}
function external(url) {
  try { const parsed = new URL(url); if (['http:','https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) void shell.openExternal(parsed.href); } catch { /* Ignore unsupported links. */ }
}
async function showWindow() {
  if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
  window = new BrowserWindow({width:1450,height:980,minWidth:750,minHeight:600,title:'Nextstep',icon:iconPath(),backgroundColor:nativeTheme.shouldUseDarkColors ? '#17191e' : '#ffffff',...(process.platform === 'darwin' ? {titleBarStyle:'hiddenInset',trafficLightPosition:{x:14,y:11}} : {}),webPreferences:{preload:resolve(import.meta.dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.on('focus',() => { void usage?.checkIn().catch(() => {}); });
  window.webContents.setWindowOpenHandler(({url}) => { external(url); return {action:'deny'}; });
  window.webContents.on('will-navigate',(event,url) => { if (new URL(url).origin !== service.url) { event.preventDefault(); external(url); } });
  const allowClipboard = (contents,permission) => {
    try { return permission === 'clipboard-sanitized-write' && contents && new URL(contents.getURL()).origin === service.url; }
    catch { return false; }
  };
  window.webContents.session.setPermissionRequestHandler((contents,permission,callback) => callback(Boolean(allowClipboard(contents,permission))));
  window.webContents.session.setPermissionCheckHandler((contents,permission) => Boolean(allowClipboard(contents,permission)));
  window.webContents.on('will-prevent-unload',event => {
    const choice = dialog.showMessageBoxSync(window,{type:'question',buttons:['Keep editing','Discard changes'],defaultId:0,cancelId:0,title:'Unsaved changes',message:'Discard your unsaved changes?'});
    if (choice === 1) event.preventDefault();
  });
  window.on('closed',() => { window = null; });
  await window.loadURL(service.url);
}
async function openDatabase() {
  await showWindow();
  const result = await dialog.showOpenDialog(window,{title:'Open an existing Nextstep database',properties:['openFile'],filters:[{name:'SQLite database',extensions:['sqlite','db']}]});
  if (result.canceled || !result.filePaths[0]) return;
  const database = result.filePaths[0];
  // Start and validate the replacement before closing the current server.
  let replacement;
  try { replacement = await createService(database); } catch (error) { dialog.showErrorBox('Could not open database',error.message); return; }
  const previous = service; service = replacement;
  try { await window.loadURL(service.url); }
  catch (error) {
    service = previous; await replacement.close();
    if (error.code !== 'ERR_ABORTED') dialog.showErrorBox('Could not open database',error.message);
    return;
  }
  remember(database); buildMenu(); await previous.close();
}
function createService(database) {
  if (existsSync(database)) assertNextstepDatabase(database);
  const args = app.isPackaged ? ['--mcp'] : [app.getAppPath(),'--mcp'];
  return startServer({port:0,database,dist:resolve(app.getAppPath(),'dist'),agentCommand:{command:process.execPath,args},crmAgentCommand:{command:process.execPath,args:app.isPackaged ? ['--crm-mcp'] : [app.getAppPath(),'--crm-mcp']}});
}
function agentBridge() {
  const testHome = process.env.NEXTSTEP_AGENT_CONFIG_HOME;
  const connector = createAgentConnector({home:testHome || app.getPath('home'),env:testHome ? {...process.env,CODEX_HOME:resolve(testHome,'.codex'),CLAUDE_CONFIG_DIR:''} : process.env});
  const validate = validateSender;
  let connecting = false;
  ipcMain.handle('nextstep:agents',event => { validate(event); return service.backendUrl ? [] : connector.detect(); });
  ipcMain.handle('nextstep:open-crm-agent',async (event,provider) => {
    validate(event);
    if (service.backendUrl) throw new Error('Use the SSH connection under Other agents & advanced setup for your server.');
    if (connecting) throw new Error('An agent connection is already being added.');
    if (app.isPackaged && (process.execPath.includes('/AppTranslocation/') || process.execPath.startsWith('/Volumes/'))) throw new Error('Move Nextstep to Applications and reopen it before connecting your agent.');
    connector.appPath(provider);
    const active = service;
    connecting = true;
    try {
      const args = app.isPackaged ? ['--crm-mcp'] : [app.getAppPath(),'--crm-mcp'];
      await connector.connect(provider,{command:process.execPath,args:[...args,'--database',active.database]},'nextstep-crm');
      if (active !== service) throw new Error('The open database changed. Reopen setup for the new workspace.');
      const workspace = resolve(app.getPath('userData'),'Workspace');
      mkdirSync(workspace,{recursive:true});
      await shell.openExternal(agentHandoffUrl(provider,crmAgentRequest,workspace));
      return {configured:true,instructions:crmAgentRequest};
    } finally { connecting = false; }
  });
  async function configureAgent(provider) {
    if (service.backendUrl) throw new Error('Connect your agent to the self-hosted backend over SSH. Automatic local database configuration is unavailable in this mode.');
    if (connecting) throw new Error('A connection is already being added.');
    const active = service;
    if (active.store.agentStatus().schedule.provider !== provider) throw new Error('Save your agent choice first.');
    // Translocated apps cannot supply a durable executable path to another app.
    if (app.isPackaged && (process.execPath.includes('/AppTranslocation/') || process.execPath.startsWith('/Volumes/'))) throw new Error('Move Nextstep to Applications and reopen it before connecting your agent.');
    connecting = true;
    try {
      const args = app.isPackaged ? ['--mcp'] : [app.getAppPath(),'--mcp'];
      const connection = connectionConfig({database:active.database,command:process.execPath,args}).mcpServers.nextstep;
      await connector.connect(provider,connection);
      if (service !== active) throw new Error('The open database changed. Reopen setup for the new database.');
      active.store.markAgentConfigured(provider);
      return active;
    } finally { connecting = false; }
  }
  ipcMain.handle('nextstep:connect-agent',async (event,provider) => {
    validate(event);
    await configureAgent(provider);
    return {configured:true};
  });
  ipcMain.handle('nextstep:open-agent',async (event,provider,purpose) => {
    validate(event);
    if (!['setup','search'].includes(purpose)) throw new Error('Choose a setup or search request.');
    connector.appPath(provider);
    const active = await configureAgent(provider);
    const status = active.store.agentStatus();
    const instructions = purpose === 'setup' ? setupInstructions(status.schedule,status.onboarding,active.database) : searchInstructions(active.database);
    const workspace = resolve(app.getPath('userData'),'Research');
    mkdirSync(workspace,{recursive:true});
    const url = agentHandoffUrl(provider,instructions,workspace);
    try { await shell.openExternal(url); }
    catch { throw new Error(`Could not open a new ${provider === 'claude-code' ? 'Claude Code conversation' : 'Codex task'}. Update your agent app and retry, or copy the request below into a new local Code/Codex conversation.`); }
    return {instructions};
  });
}
function settingsBridge() {
  const boardKey = key => {
    if (typeof key !== 'string' || !key || key.length > 300) throw new Error('Invalid view settings key.');
    return createHash('sha256').update(`${service.backendUrl || service.database}:${key}`).digest('hex');
  };
  ipcMain.handle('nextstep:board-settings',(event,key) => { validateSender(event); return readPreferences(app.getPath('userData')).boardSettings?.[boardKey(key)] || null; });
  ipcMain.handle('nextstep:set-board-settings',(event,key,value) => {
    validateSender(event);
    const id = boardKey(key);
    if (!value || !Array.isArray(value.hiddenStages) || !Array.isArray(value.actionStages) || value.hiddenStages.length > 101 || value.actionStages.length > 3 || [...value.hiddenStages,...value.actionStages].some(s => typeof s !== 'string' || s.length > 160)) throw new Error('Invalid view settings.');
    if (value.stageOrder !== undefined && (!Array.isArray(value.stageOrder) || value.stageOrder.length > 101 || value.stageOrder.some(s => typeof s !== 'string' || s.length > 160))) throw new Error('Invalid stage order.');
    if (value.stageNames !== undefined && (!value.stageNames || typeof value.stageNames !== 'object' || Array.isArray(value.stageNames) || Object.keys(value.stageNames).length > 101 || Object.entries(value.stageNames).some(([key,name]) => key.length > 160 || typeof name !== 'string' || !name.trim() || name.length > 80))) throw new Error('Invalid stage names.');
    const existing = readPreferences(app.getPath('userData')).boardSettings || {};
    writePreferences(app.getPath('userData'),{boardSettings:{...existing,[id]:{hiddenStages:[...new Set(value.hiddenStages)],actionStages:[...new Set(value.actionStages)],stageOrder:value.stageOrder || [],stageNames:value.stageNames || {}}}});
    return value;
  });
  ipcMain.handle('nextstep:update-state',event => { validateSender(event); return updater.getState(); });
  ipcMain.handle('nextstep:check-updates',event => { validateSender(event); return updater.check(); });
  ipcMain.handle('nextstep:download-update',event => { validateSender(event); return updater.download(); });
  ipcMain.handle('nextstep:install-update',event => { validateSender(event); updater.install(); });
  ipcMain.handle('nextstep:automatic-updates',(event,value) => { validateSender(event); return updater.setAutomatic(value); });
  ipcMain.handle('nextstep:preferences',event => { validateSender(event); return preferences(); });
  ipcMain.handle('nextstep:set-appearance',(event,color) => { validateSender(event); return setAppearance(color); });
  ipcMain.handle('nextstep:set-theme',(event,theme) => { validateSender(event); return setTheme(theme); });
  ipcMain.handle('nextstep:set-usage',(event,enabled) => {
    validateSender(event);
    const value = usage.setEnabled(enabled);
    if (value) void usage.checkIn().catch(() => {});
    return value;
  });
  let switching = false;
  ipcMain.handle('nextstep:set-backend',async (event,value) => {
    validateSender(event);
    if (switching) throw new Error('A backend connection is already being changed.');
    const backendUrl = value === null ? null : backendOrigin(value);
    if (backendUrl === service.url) throw new Error('This is the desktop app itself. Enter the address of your separate backend.');
    if (backendUrl === service.backendUrl) return preferences();
    switching = true;
    let replacement;
    const previous = service;
    try {
      replacement = backendUrl ? await startServer({port:0,backendUrl,dist:resolve(app.getAppPath(),'dist')}) : await createService(appDatabase());
      service = replacement;
      await window.loadURL(service.url);
      if (backendUrl) writePreferences(app.getPath('userData'),{backendUrl});
      else remember(service.database);
      buildMenu();
      await previous.close();
      return preferences();
    } catch (error) {
      service = previous;
      if (replacement && window.webContents.getURL().startsWith(replacement.url)) await window.loadURL(previous.url);
      if (replacement) await replacement.close();
      throw error;
    } finally { switching = false; }
  });
}
async function main() {
  if (mcpMode) {
    app.dock?.hide();
    await app.whenReady();
    if (crmMcpMode) await startCrmMcp(appDatabase(),{allowWrites:process.argv.includes('--allow-writes'),onClose:() => app.quit()});
    else await startMcp(appDatabase(),() => app.quit());
    return;
  }
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on('second-instance',() => { if (service) void showWindow(); });
  await app.whenReady();
  usage = createUsageReporter({read:() => readPreferences(app.getPath('userData')),write:patch => writePreferences(app.getPath('userData'),patch),version:app.getVersion(),platform:process.platform,send:(...args) => fetch(...args),eligible:() => app.isPackaged && process.env.NEXTSTEP_DISABLE_USAGE !== '1' && Boolean(window && !window.isDestroyed() && window.isFocused())});
  const usageTimer = setInterval(() => { void usage.checkIn().catch(() => {}); },60*60*1000);
  usageTimer.unref();
  nativeTheme.themeSource = preferences().theme;
  nativeTheme.on('updated',() => window?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#17191e' : '#ffffff'));
  const selected = readPreferences(app.getPath('userData')).backendUrl;
  if (process.platform === 'darwin') {
    app.dock?.setIcon(iconPath());
  }
  if (selected && !process.argv.includes('--database') && !process.env.NEXTSTEP_DB_PATH && !process.env.DB_PATH) {
    while (!service) {
      try { service = await startServer({port:0,backendUrl:selected,dist:resolve(app.getAppPath(),'dist')}); }
      catch (error) {
        const choice = dialog.showMessageBoxSync({type:'error',title:'Backend unavailable',message:error.message,buttons:['Retry','Open local database','Quit'],defaultId:0,cancelId:2});
        if (choice === 2) { app.quit(); return; }
        if (choice === 1) { const database = appDatabase(); service = await createService(database); remember(database); }
      }
    }
  } else { const database = appDatabase(); service = await createService(database); remember(database); }
  updater = createUpdater({native:autoUpdater,version:app.getVersion(),platform:process.platform,arch:process.arch,packaged:app.isPackaged && process.env.NEXTSTEP_DISABLE_UPDATES !== '1',executable:process.execPath,read:() => readPreferences(app.getPath('userData')),write:patch => writePreferences(app.getPath('userData'),patch),send:(...args) => fetch(...args),publish:state => window?.webContents.send('nextstep:update-state-changed',state)});
  agentBridge();
  settingsBridge();
  buildMenu();
  await showWindow();
  const firstUpdateCheck = setTimeout(() => { void updater.automaticCheck(); },10000);
  const updateTimer = setInterval(() => { void updater.automaticCheck(); },6*60*60*1000);
  firstUpdateCheck.unref(); updateTimer.unref();
  app.on('activate',() => { void showWindow(); });
  app.on('window-all-closed',() => { if (process.platform !== 'darwin') app.quit(); });
  // SQLite writes are synchronous. Close it after unsaved-edit prompts are resolved;
  // waiting on asynchronous HTTP teardown here can stall Electron's shutdown.
  app.on('will-quit',() => {
    clearInterval(usageTimer);
    clearTimeout(firstUpdateCheck); clearInterval(updateTimer); updater.stop();
    usage.stop();
    service.server.closeAllConnections();
    service.store?.close();
  });
}
main().catch(error => {
  if (mcpMode) console.error(error.message);
  else dialog.showErrorBox('Nextstep could not start',error.message);
  app.exit(1);
});
