import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { openStore, readSearchProfile } from '../server/store.mjs';
import { readContext } from '../server/context.mjs';
import { databasePath } from '../server/config.mjs';

const database = databasePath();
const [command,filename,...options] = process.argv.slice(2);
let store;
try {
  if (!existsSync(database)) throw new Error(`CRM database not found: ${database}. Do not create a replacement database.`);
  if (command === 'context' && !filename) {
    const db = new DatabaseSync(database,{readOnly:true});
    try {
      console.log(JSON.stringify(readContext(db,database),null,2));
    } finally { db.close(); }
  } else if (command === 'profile' && filename === 'get' && options.length === 0) {
    const db = new DatabaseSync(database,{readOnly:true});
    try { console.log(JSON.stringify({database,profile:readSearchProfile(db)},null,2)); } finally { db.close(); }
  } else if (command === 'profile' && filename === 'set' && options.length === 1) {
    const input = JSON.parse(readFileSync(options[0] === '-' ? 0 : options[0],'utf8'));
    store = openStore(database);
    console.log(JSON.stringify({database,profile:store.updateProfile(input)},null,2));
  } else if (command === 'import' && filename && options.every(value => value === '--dry-run')) {
    const input = JSON.parse(readFileSync(filename === '-' ? 0 : filename,'utf8'));
    store = openStore(database);
    const result = store.importProspects(Array.isArray(input) ? input : input?.opportunities,{dryRun:options.includes('--dry-run')});
    console.log(JSON.stringify({database,...result},null,2));
  } else {
    throw new Error('Usage: node scripts/job-finder.mjs context | profile get | profile set <file> | import <file> [--dry-run]. Use - to read JSON from stdin.');
  }
} catch (error) {
  console.error(JSON.stringify({error:error.message,database}));
  process.exitCode = 1;
} finally { store?.close(); }
