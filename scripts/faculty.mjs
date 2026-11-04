import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../src/config.mjs';
import { initializeStoreSchema } from '../src/store-schema.mjs';
import { migrate } from '../src/migrations.mjs';
import { passwordHash } from '../src/faculty-access.mjs';
const username = process.argv[2];
if (!/^[a-z0-9-]{3,40}$/.test(username || '')) throw new Error('Usage: npm run faculty -- username; set FACULTY_PASSWORD in the environment.');
const encoded = passwordHash(process.env.FACULTY_PASSWORD);
const { dataFile } = loadConfig();
const db = new DatabaseSync(dataFile);
try {
  initializeStoreSchema(db); migrate(db);
  db.exec('BEGIN IMMEDIATE');
  db.prepare('INSERT INTO faculty_accounts VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash')
    .run(username, encoded, new Date().toISOString());
  db.prepare('DELETE FROM instructor_tokens WHERE faculty_id=?').run(username);
  db.exec('COMMIT');
  console.log(`Faculty account updated: ${username}`);
} finally { db.close(); }
