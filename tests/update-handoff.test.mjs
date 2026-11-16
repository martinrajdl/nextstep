import test from 'node:test';
import assert from 'node:assert/strict';
import { agentHelperPids, stopAgentHelpersForUpdate } from '../desktop/update-handoff.mjs';

const executable = '/Applications/Nextstep.app/Contents/MacOS/Nextstep';
const options = { platform: 'darwin', executable, uid: 501, pid: 10 };
const processes = [
  `10 501 ${executable}`,
  `11 501 ${executable} --crm-mcp --database /private/example.sqlite`,
  `12 501 ${executable} --mcp --database /private/example.sqlite`,
  `13 501 ${executable} --database /private/example.sqlite`,
  `14 501 ${executable} --database /private/example--crm-mcp.sqlite`,
  `15 502 ${executable} --crm-mcp`,
  `16 501 /private/Other.app/Contents/MacOS/Nextstep --crm-mcp`,
  `17 501 ${executable}-other --crm-mcp`,
  `18 501 /usr/bin/node /private/nextstep/mcp/crm-stdio.mjs`,
  `19 501 ${executable} --crm-mcp-other`,
].join('\n');

test('update handoff identifies only this user’s explicit background connectors from the exact app', () => {
  assert.deepEqual(agentHelperPids(processes, executable, options), [11, 12]);
  assert.deepEqual(agentHelperPids(`20 501 /Applications/Example Folder/Nextstep.app/Contents/MacOS/Nextstep --crm-mcp`, '/Applications/Example Folder/Nextstep.app/Contents/MacOS/Nextstep', options), [20]);
});

test('update handoff requests graceful termination and tolerates a connector that already exited', () => {
  const calls = [];
  const stopped = stopAgentHelpersForUpdate({ ...options, readProcesses: () => processes, signal(pid, name) {
    calls.push([pid, name]);
    if (pid === 12) throw Object.assign(new Error('Already exited'), { code: 'ESRCH' });
  } });
  assert.equal(stopped, 1);
  assert.deepEqual(calls, [[11, 'SIGTERM'], [12, 'SIGTERM']]);
});

test('update handoff reports failed shutdowns and leaves unsupported platforms untouched', () => {
  assert.throws(() => stopAgentHelpersForUpdate({ ...options, readProcesses: () => processes, signal() { throw Object.assign(new Error('Denied'), { code: 'EPERM' }); } }), /Could not close/);
  for (const platform of ['win32', 'linux']) assert.equal(stopAgentHelpersForUpdate({ ...options, platform, readProcesses() { throw new Error('Must not inspect'); } }), 0);
});
