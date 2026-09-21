import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { databasePath } from '../server/config.mjs';
import { openStore } from '../server/store.mjs';

export function setupWorkspace({ database = databasePath() } = {}) {
  const existingDatabase = existsSync(database);
  const store = openStore(database);
  try {
    return { database, existingDatabase, profile: store.getProfile() };
  } finally { store.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = setupWorkspace();
  console.log(`${result.existingDatabase ? 'Kept existing' : 'Created empty'} database: ${result.database}`);
  console.log(result.profile.roles ? 'Kept your saved search preferences.' : 'No job type selected. Define your search preferences in the app or with the setup agent.');
  console.log('Next: pnpm build && pnpm background:start. Open Search preferences to define what you want.');
}
