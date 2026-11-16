import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

const modes = new Set(['--mcp', '--crm-mcp']);

export function agentHelperPids(output, executable, { pid = process.pid, uid = process.getuid?.() } = {}) {
  return output.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!match || Number(match[1]) === pid || Number(match[2]) !== uid) return [];
    const command = match[3];
    if (!command.startsWith(`${executable} `)) return [];
    const mode = command.slice(executable.length).trimStart().split(/\s/, 1)[0];
    return modes.has(mode) ? [Number(match[1])] : [];
  });
}

function processList(executable, uid) {
  const options = { encoding: 'utf8', timeout: 2000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] };
  let pids;
  try { pids = execFileSync('/usr/bin/pgrep', ['-u', String(uid), '-x', basename(executable)], options).trim().split(/\s+/); }
  catch (error) { if (error.status === 1) return ''; throw new Error('Could not inspect background agent connections.'); }
  if (!pids.length || pids.some(pid => !/^\d+$/.test(pid))) return '';
  try { return execFileSync('/bin/ps', ['-ww', '-p', pids.join(','), '-o', 'pid=,uid=,args='], options); }
  catch (error) { if (error.status === 1) return ''; throw new Error('Could not inspect background agent connections.'); }
}

// Squirrel.Mac waits for every process running from the target app bundle.
// Signal only explicit MCP helpers from that exact installation and user.
// Their existing SIGTERM handlers close MCP and SQLite before quitting.
export function stopAgentHelpersForUpdate({
  platform = process.platform,
  executable = process.execPath,
  pid = process.pid,
  uid = process.getuid?.(),
  readProcesses = processList,
  signal = (pid, name) => process.kill(pid, name),
} = {}) {
  if (platform !== 'darwin') return 0;
  let stopped = 0;
  for (const helper of agentHelperPids(readProcesses(executable, uid), executable, { pid, uid })) {
    try { signal(helper, 'SIGTERM'); stopped++; }
    catch (error) { if (error.code !== 'ESRCH') throw new Error('Could not close a background agent connection for the update.'); }
  }
  return stopped;
}
