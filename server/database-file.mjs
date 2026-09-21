import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

export function assertNextstepDatabase(database) {
  if (!existsSync(database)) throw new Error(`Nextstep database not found: ${database}. No replacement database was created.`);
  const check = new DatabaseSync(database,{readOnly:true});
  try {
    for (const [table,columns] of Object.entries({opportunities:['id','data','stage','position','version','created_at','updated_at','deleted_at'],activity:['id','opportunity_id','action','from_stage','to_stage','created_at']})) {
      const found = check.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
      if (columns.some(column => !found.includes(column))) throw new Error('This file is not a Nextstep database.');
    }
  } finally { check.close(); }
}
