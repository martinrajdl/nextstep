import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { databasePath } from '../server/config.mjs';
const root = fileURLToPath(new URL('..',import.meta.url));
const directory = resolve(root,'.runtime');
const pidFile = resolve(directory,'server.json');
const action = process.argv[2] || 'start';
mkdirSync(directory,{recursive:true});
function running() { try { const value = JSON.parse(readFileSync(pidFile,'utf8')); process.kill(value.pid,0); return value; } catch { return null; } }
async function health(port, pid) { try { const res = await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)}); const value = await res.json(); return res.ok && value.app === 'nextstep' && value.pid === pid; } catch { return false; } }
let processInfo = running();
if (action === 'status') {
  const ok = processInfo && await health(processInfo.port,processInfo.pid);
  console.log(ok ? `Nextstep is running at http://127.0.0.1:${processInfo.port} (PID ${processInfo.pid})` : 'Nextstep is not running.');
  process.exit(ok ? 0 : 1);
}
if (action === 'stop' || action === 'restart') {
  if (processInfo) {
    // Only stop the recorded process if it still serves this application's health endpoint.
    if (!await health(processInfo.port,processInfo.pid)) throw new Error('The saved process could not be identified as Nextstep. No process was stopped.');
    process.kill(processInfo.pid,'SIGTERM');
    for (let attempt=0;attempt<40 && running();attempt++) await new Promise(resolve => setTimeout(resolve,100));
    if (running()) throw new Error('The server is still stopping. Try again.');
    console.log('Nextstep stopped. Your data is saved.');
  }
  if (existsSync(pidFile)) unlinkSync(pidFile);
  if (action === 'stop') process.exit(0);
  processInfo = null;
}
if (!['start','restart'].includes(action)) throw new Error('Use start, stop, restart, or status.');
if (processInfo) { if (!await health(processInfo.port,processInfo.pid)) throw new Error('The recorded background process is not responding as Nextstep. Check .runtime/server.log.'); console.log(`Already running at http://127.0.0.1:${processInfo.port}`); process.exit(0); }
if (!existsSync(resolve(root,'dist/index.html'))) throw new Error('Build first with pnpm build.');
const port = Number(process.env.PORT || 4317);
const descriptor = openSync(resolve(directory,'server.log'),'a');
const child = spawn(process.execPath,['server/index.mjs'],{cwd:root,detached:true,stdio:['ignore',descriptor,descriptor],env:{...process.env,PORT:String(port)}});
closeSync(descriptor);
child.unref();
writeFileSync(pidFile,JSON.stringify({pid:child.pid,port,startedAt:new Date().toISOString()},null,2));
for (let attempt=0;attempt<40;attempt++) {
  await new Promise(resolve => setTimeout(resolve,150));
  if (await health(port,child.pid)) { console.log(`Nextstep is running in the background at http://127.0.0.1:${port}\nData: ${databasePath()}\nStop: pnpm background:stop`); process.exit(0); }
  if (!running()) break;
}
if (existsSync(pidFile)) unlinkSync(pidFile);
throw new Error('Could not start Nextstep. See .runtime/server.log.');
