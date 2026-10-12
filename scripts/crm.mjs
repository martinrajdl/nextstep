import { readFileSync } from 'node:fs';
import { databasePath } from '../server/config.mjs';
import { assertNextstepDatabase } from '../server/database-file.mjs';
import { openStore } from '../server/store.mjs';

const [command, file, ...flags] = process.argv.slice(2);
let store;
try {
  if (
    !['context', 'query', 'preview', 'propose', 'apply', 'export'].includes(
      command,
    )
  )
    throw new Error(
      'Usage: pnpm crm context|export, or pnpm crm query|preview|propose|apply data/input.json. Direct apply also requires --allow-writes.',
    );
  const database = databasePath();
  assertNextstepDatabase(database);
  store = openStore(database);
  const input = ['context', 'export'].includes(command)
    ? undefined
    : JSON.parse(readFileSync(file, 'utf8'));
  if (command === 'apply' && !flags.includes('--allow-writes'))
    throw new Error(
      'Use propose for human review, or explicitly pass --allow-writes for a trusted direct change.',
    );
  console.log(JSON.stringify(store.crm[command](input), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  store?.close();
}
