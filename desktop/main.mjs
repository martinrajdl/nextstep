import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertNextstepDatabase } from '../server/database-file.mjs';
import { startServer } from '../server/http.mjs';
import { startMcp, databaseArgument } from '../mcp/stdio.mjs';

app.setName('Nextstep');
if (process.env.NEXTSTEP_USER_DATA) app.setPath('userData',resolve(process.env.NEXTSTEP_USER_DATA));
const mcpMode = process.argv.includes('--mcp');
let service;
let window;

function savedDatabase() {
  const settings = resolve(app.getPath('userData'),'settings.json');
  if (!existsSync(settings)) return null;
  const value = JSON.parse(readFileSync(settings,'utf8'));
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
  mkdirSync(app.getPath('userData'),{recursive:true});
  writeFileSync(resolve(app.getPath('userData'),'settings.json'),JSON.stringify({database},null,2));
}
function external(url) {
  try { const parsed = new URL(url); if (['http:','https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) void shell.openExternal(parsed.href); } catch { /* Ignore unsupported links. */ }
}
async function showWindow() {
  if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
  window = new BrowserWindow({width:1450,height:980,minWidth:750,minHeight:600,title:'Nextstep',backgroundColor:'#ffffff',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
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
  remember(database); await previous.close();
}
function createService(database) {
  if (existsSync(database)) assertNextstepDatabase(database);
  const args = app.isPackaged ? ['--mcp'] : [app.getAppPath(),'--mcp'];
  return startServer({port:0,database,dist:resolve(app.getAppPath(),'dist'),agentCommand:{command:process.execPath,args}});
}
async function main() {
  if (mcpMode) {
    app.dock?.hide();
    await app.whenReady();
    await startMcp(appDatabase(),() => app.quit());
    return;
  }
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on('second-instance',() => { if (service) void showWindow(); });
  await app.whenReady();
  const database = appDatabase();
  service = await createService(database); remember(database);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{label:'Nextstep',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]}] : []),
    {label:'File',submenu:[{label:'Open database…',click:() => { void openDatabase(); }},{label:'Show database in folder',click:() => shell.showItemInFolder(service.database)},{type:'separator'},{role:process.platform === 'darwin' ? 'close' : 'quit'}]},
    {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'View',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]},
    {label:'Window',submenu:[{role:'minimize'},{role:'zoom'}]}
  ]));
  await showWindow();
  app.on('activate',() => { void showWindow(); });
  app.on('window-all-closed',() => { if (process.platform !== 'darwin') app.quit(); });
  // SQLite writes are synchronous. Close it after unsaved-edit prompts are resolved;
  // waiting on asynchronous HTTP teardown here can stall Electron's shutdown.
  app.on('will-quit',() => {
    service.server.closeAllConnections();
    service.store.close();
  });
}
main().catch(error => {
  if (mcpMode) console.error(error.message);
  else dialog.showErrorBox('Nextstep could not start',error.message);
  app.exit(1);
});
