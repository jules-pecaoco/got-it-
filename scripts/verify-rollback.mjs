import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { backupDatabase } from '../src/backup.mjs';
import { Store } from '../src/store.mjs';
const [source, baselineDirectory] = process.argv.slice(2);
if (!source || !baselineDirectory) throw new Error('Usage: node --import tsx --experimental-sqlite scripts/verify-rollback.mjs backup.sqlite BASELINE-SOURCE');
const { Store: BaselineStore } = await import(pathToFileURL(resolve(baselineDirectory, 'src/store.mjs')).href);
const suffix = Date.now();
const baseline = new BaselineStore(backupDatabase(source, resolve(`data/backups/rollback-baseline-${suffix}.sqlite`)));
const migrated = new Store(backupDatabase(source, resolve(`data/backups/rollback-migrated-${suffix}.sqlite`)));
try {
  const tables = ['exams', 'runs', 'roster', 'sessions', 'submissions', 'answer_drafts', 'score_events', 'penalty_events', 'score_overrides'];
  for (const table of tables) assert.equal(migrated.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, baseline.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, table);
  const sessions = baseline.db.prepare('SELECT id FROM sessions').all();
  for (const session of sessions) assert.equal(migrated.score(session.id), baseline.score(session.id), 'Grade parity');
  assert.deepEqual(migrated.db.prepare('PRAGMA foreign_key_check').all(), []);
  console.log(JSON.stringify({ baselineLoads: true, migratedLoads: true, tablesCompared: tables.length, gradesCompared: sessions.length, foreignKeys: 'ok' }));
} finally { baseline.close(); migrated.close(); }
