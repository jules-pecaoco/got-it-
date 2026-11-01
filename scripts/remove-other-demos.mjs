import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const store = new Store(process.env.DATA_FILE || join(root, 'data', 'studio.sqlite'));
const demoIds = ['archives-demo', 'garden-demo'];
try {
  const summary = store.tx(() => {
    const counts = {};
    for (const examId of demoIds) {
      const sessionWhere = 'SELECT id FROM sessions WHERE run_id IN (SELECT id FROM runs WHERE exam_id=?)';
      counts[examId] = {
        runs: store.db.prepare('SELECT COUNT(*) AS n FROM runs WHERE exam_id=?').get(examId).n,
        sessions: store.db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE id IN (${sessionWhere})`).get(examId).n
      };
      store.db.prepare(`DELETE FROM score_events WHERE session_id IN (${sessionWhere})`).run(examId);
      store.db.prepare(`DELETE FROM submissions WHERE session_id IN (${sessionWhere})`).run(examId);
      store.db.prepare('DELETE FROM sessions WHERE run_id IN (SELECT id FROM runs WHERE exam_id=?)').run(examId);
      store.db.prepare('DELETE FROM roster WHERE run_id IN (SELECT id FROM runs WHERE exam_id=?)').run(examId);
      store.db.prepare('DELETE FROM runs WHERE exam_id=?').run(examId);
      store.db.prepare('DELETE FROM source_documents WHERE exam_id=?').run(examId);
      store.db.prepare('DELETE FROM exams WHERE exam_id=?').run(examId);
    }
    return counts;
  });
  console.log(JSON.stringify(summary));
} finally { store.close(); }
