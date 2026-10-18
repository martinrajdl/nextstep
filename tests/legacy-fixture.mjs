// Reconstruct the actual pre-unification storage contract in an isolated test database.
// Metadata is left intact so older migration tests can remove only their later tables.
export function legacyFixture(db) {
  db.exec('PRAGMA foreign_keys=OFF');
  const rows = db.prepare('SELECT * FROM opportunities ORDER BY id').all();
  const activity = db.prepare('SELECT * FROM activity ORDER BY id').all();
  db.exec(`DROP VIEW opportunities; DROP TABLE activity;
    CREATE TABLE opportunities (id TEXT PRIMARY KEY,data TEXT NOT NULL,stage TEXT NOT NULL,position INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE activity (id INTEGER PRIMARY KEY,opportunity_id TEXT NOT NULL REFERENCES opportunities(id),action TEXT NOT NULL,from_stage TEXT,to_stage TEXT,created_at TEXT NOT NULL);`);
  const insert = db.prepare(
    'INSERT INTO opportunities VALUES (?,?,?,?,?,?,?,?)',
  );
  rows.forEach((row) => insert.run(...Object.values(row)));
  const log = db.prepare('INSERT INTO activity VALUES (?,?,?,?,?,?)');
  activity.forEach((row) => log.run(...Object.values(row)));
  for (const { name } of db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'crm_%'",
    )
    .all())
    db.exec(`DROP TABLE ${name}`);
  db.exec('PRAGMA user_version=6; PRAGMA foreign_keys=ON');
  return { rows, activity };
}

export function preservedRows(before, after) {
  return before.map((row, index) => {
    const next = after[index];
    const oldData = JSON.parse(row.data),
      newData = JSON.parse(next.data);
    // Older rows may omit empty fields. Compare every original value and all metadata.
    return {
      before: { ...row, data: oldData },
      after: {
        ...next,
        data: Object.fromEntries(
          Object.keys(oldData).map((key) => [
            key,
            key === 'stage' ? oldData[key] : newData[key],
          ]),
        ),
      },
    };
  });
}
