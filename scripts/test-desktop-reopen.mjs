import { _electron as electron, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openStore } from '../server/store.mjs';
import { root } from '../server/config.mjs';

if (process.platform !== 'darwin') {
  console.log('Desktop reopen check is macOS-only.');
  process.exit(0);
}

const executablePath = process.argv[2];
for (const mode of ['--mcp', '--crm-mcp']) {
  const directory = mkdtempSync(join(tmpdir(), 'nextstep-reopen-'));
  const database = join(directory, 'selected.sqlite'), connectorDatabase = join(directory, 'connector.sqlite'), userData = join(directory, 'profile');
  const store = openStore(database); store.create({ company: 'Fictional Saved Choice', notes: 'Preserve this record' }); store.close();
  const connector = openStore(connectorDatabase); connector.close();
  mkdirSync(userData); writeFileSync(join(userData, 'settings.json'), JSON.stringify({ database }));
  let helper, childPid;
  const children = () => execFileSync('ps', ['-axo','pid=,ppid=,command='], {encoding:'utf8'}).split('\n').map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean).filter(([, ,ppid, command]) => Number(ppid) === helper.process().pid && !command.includes('--type=')).map(([,pid]) => Number(pid));
  try {
    helper = await electron.launch({ ...(executablePath ? {executablePath} : {}), args: [...(executablePath ? [] : [root]), mode, '--database', connectorDatabase], env: {...process.env, NEXTSTEP_USER_DATA:userData, NEXTSTEP_DISABLE_UPDATES:'1', NEXTSTEP_DISABLE_USAGE:'1', NEXTSTEP_DB_PATH:connectorDatabase, DB_PATH:'', NEXTSTEP_AGENT_CONFIG_HOME:join(directory,'agents')}, timeout:30000 });
    expect(await helper.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length)).toBe(0);
    expect(children()).toEqual([]);
    for (let attempt = 0; attempt < 2; attempt++) {
      await helper.evaluate(({app}) => app.emit('activate', {}, false));
      await expect.poll(() => children().length, {timeout:15000}).toBe(1);
      childPid = children()[0];
      let port;
      await expect.poll(() => {
        try { port = execFileSync('lsof', ['-a','-p',String(childPid),'-nP','-iTCP','-sTCP:LISTEN','-Fn'],{encoding:'utf8'}).match(/n127\.0\.0\.1:(\d+)/)?.[1]; return Boolean(port); } catch { return false; }
      }, {timeout:15000}).toBe(true);
      const result = await (await fetch(`http://127.0.0.1:${port}/api/opportunities`)).json();
      expect(result.opportunities.map(row => row.company)).toEqual(['Fictional Saved Choice']);
      expect(await helper.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length)).toBe(0);
      process.kill(childPid, 'SIGTERM');
      await expect.poll(() => children().length, {timeout:15000}).toBe(0); childPid = null;
      // Allow the activation debounce to expire before simulating another user open.
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
    console.log(`${mode}: background start stays windowless; two reopen cycles load the saved database.`);
  } finally {
    if (childPid) { try { process.kill(childPid, 'SIGTERM'); } catch {} }
    await helper?.close(); rmSync(directory,{recursive:true,force:true});
  }
}
