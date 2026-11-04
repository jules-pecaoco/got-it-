import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { backupDatabase } from '../src/backup.mjs';
import { Store } from '../src/store.mjs';
import { removeDemoAssessments, removeUnusedDrafts } from '../src/maintenance.mjs';

const [database, ...sampleIds] = process.argv.slice(2);
if (!database || !existsSync(database)) throw new Error('Usage: cleanup-assessments.mjs EXISTING-DATABASE [sample-assessment-id ...]');
const target = resolve(database);
const backup = join(dirname(target), 'backups', `before-cleanup-${Date.now()}-${randomUUID().slice(0, 8)}.sqlite`);
console.log(`Database: ${target}`);
console.log(`Verified backup: ${backupDatabase(target, backup)}`);
const store = new Store(target);
try {
  const samples = sampleIds.length ? removeDemoAssessments(store, sampleIds) : {};
  const drafts = removeUnusedDrafts(store);
  const removedPreviews = Number(store.db.prepare('DELETE FROM ai_proposals').run().changes);
  store.audit('maintenance', 'remove_ai_previews', 'ai_proposals', { count: removedPreviews });
  if (store.db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign-key verification failed. Restore the cleanup backup.');
  console.log(JSON.stringify({ samples, ...drafts, removedPreviews }));
} finally { store.close(); }
