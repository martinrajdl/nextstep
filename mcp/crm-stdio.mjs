import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { databaseArgument } from './stdio.mjs';
import { createCrmMcp } from './crm-server.mjs';
import { createRemoteCrm } from './remote-crm.mjs';
import { readFileSync, statSync } from 'node:fs';

export async function startCrmMcp(
  database,
  { requireReview = false, onClose = () => {}, remote } = {},
) {
  const service = createCrmMcp(database, { requireReview, remote });
  const transport = new StdioServerTransport();
  await service.server.connect(transport);
  const finish = async () => {
    await service.close();
    onClose();
  };
  const protocolClose = transport.onclose;
  transport.onclose = () => {
    protocolClose?.();
    void finish();
  };
  process.once('SIGINT', finish);
  process.once('SIGTERM', finish);
  return service;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
  let remote;
  try {
    if (process.argv.includes('--server')) {
      const file = process.argv.includes('--credential-file') ? argument('--credential-file') : null;
      if (file && (statSync(file).mode & 0o077)) throw new Error('Restrict the agent credential file to your user (chmod 600).');
      const credential = file ? readFileSync(file,'utf8').trim() : process.env.NEXTSTEP_AGENT_TOKEN;
      remote = createRemoteCrm({ server: argument('--server'), workspace: argument('--workspace'), credential });
    }
  } catch (error) { console.error(error.message); process.exit(1); }
  startCrmMcp(remote ? null : databaseArgument(), {
    requireReview: process.argv.includes('--require-review'),
    remote,
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
