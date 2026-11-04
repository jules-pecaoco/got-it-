const migrations = [
  {
    version: 1,
    sql: `
    CREATE TABLE faculty_accounts (id TEXT PRIMARY KEY, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    ALTER TABLE instructor_tokens ADD COLUMN faculty_id TEXT NOT NULL DEFAULT 'faculty';
    ALTER TABLE exams ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'faculty';
    ALTER TABLE classes ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'faculty';
    ALTER TABLE runs ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'faculty';
    ALTER TABLE audit_events ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'faculty';
    CREATE INDEX exams_owner ON exams(owner_id);
    CREATE INDEX classes_owner ON classes(owner_id);
    CREATE INDEX runs_owner ON runs(owner_id);
  `,
  },
  {
    version: 2,
    sql: `
    CREATE TABLE IF NOT EXISTS coding_jobs (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      activity_id TEXT NOT NULL, kind TEXT NOT NULL, request_key TEXT NOT NULL,
      payload_json TEXT NOT NULL, accepted_at TEXT NOT NULL, status TEXT NOT NULL,
      result_json TEXT, error_json TEXT, UNIQUE(session_id,activity_id,kind,request_key));
    ALTER TABLE coding_jobs ADD COLUMN lease_owner TEXT;
    ALTER TABLE coding_jobs ADD COLUMN lease_until TEXT;
    ALTER TABLE coding_jobs ADD COLUMN failures INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE coding_jobs ADD COLUMN retry_at TEXT;
  `,
  },
  { version: 3, sql: 'ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;' },
];

export function migrate(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  for (const migration of migrations) {
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(migration.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(
        migration.version,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
