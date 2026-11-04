import { DatabaseSync } from 'node:sqlite';
import { backupDatabase } from '../src/backup.mjs';
const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Usage: npm run restore -- backup.sqlite NEW-database.sqlite');
// Never overwrite a live database. Switch DATA_FILE only after reviewing this copy.
const restored = backupDatabase(source, destination);
const db = new DatabaseSync(restored, { readOnly: true });
try {
  const tables = ['exams', 'runs', 'sessions', 'submissions', 'answer_drafts', 'score_events', 'coding_jobs'];
  const counts = {};
  for (const table of tables) if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
    counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Restored database has foreign-key violations.');
  console.log(JSON.stringify({ restored, counts }, null, 2));
} finally { db.close(); }
