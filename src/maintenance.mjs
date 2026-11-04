export function removeDemoAssessments(store, demoIds = ['archives-demo', 'garden-demo']) {
  return store.tx(() => {
    const counts = {};
    for (const examId of demoIds) {
      const sessions = 'SELECT id FROM sessions WHERE run_id IN (SELECT id FROM runs WHERE exam_id=?)';
      counts[examId] = {
        runs: store.db.prepare('SELECT COUNT(*) AS n FROM runs WHERE exam_id=?').get(examId).n,
        sessions: store.db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE id IN (${sessions})`).get(examId).n
      };
      for (const table of ['coding_jobs', 'penalty_events', 'score_overrides', 'answer_drafts', 'score_events', 'submissions'])
        store.db.prepare(`DELETE FROM ${table} WHERE session_id IN (${sessions})`).run(examId);
      store.db.prepare('DELETE FROM sessions WHERE run_id IN (SELECT id FROM runs WHERE exam_id=?)').run(examId);
      store.db.prepare('DELETE FROM proctor_tokens WHERE run_id IN (SELECT id FROM runs WHERE exam_id=?)').run(examId);
      store.db.prepare('DELETE FROM roster WHERE run_id IN (SELECT id FROM runs WHERE exam_id=?)').run(examId);
      store.db.prepare('DELETE FROM runs WHERE exam_id=?').run(examId);
      store.db.prepare('DELETE FROM source_documents WHERE exam_id=?').run(examId);
      store.db.prepare('DELETE FROM exams WHERE exam_id=?').run(examId);
    }
    store.audit('maintenance', 'remove_demo_assessments', demoIds.join(','), counts);
    return counts;
  });
}
