import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { databaseArgument } from './stdio.mjs';
import { createCrmMcp } from './crm-server.mjs';

export async function startCrmMcp(
  database,
  { requireReview = false, onClose = () => {} } = {},
) {
  const service = createCrmMcp(database, { requireReview });
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
  startCrmMcp(databaseArgument(), {
    requireReview: process.argv.includes('--require-review'),
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
