export function attemptSettlement(store, previews) {
  const settling = new Map();
  const checkpoints = new Map();
  let lastCheckpointAt = null, checkpointFailures = 0;

  async function checkpointAnswer(sessionId) {
    if (!previews) return;
    const { exam, session } = store.context(sessionId);
    for (const checkpoint of store.db.prepare('SELECT * FROM web_checkpoints WHERE session_id=? AND database_snapshot IS NOT NULL').all(sessionId)) {
      if (checkpoint.saved_at > session.deadline_at) continue;
      const activity = exam.public.missions.flatMap(m => m.activities).find(a => a.id === checkpoint.activity_id && a.type === 'web_project');
      if (!activity || store.db.prepare('SELECT 1 FROM answer_drafts WHERE session_id=? AND activity_id=?').get(sessionId, activity.id)) continue;
      const last = store.db.prepare('SELECT response_json FROM submissions WHERE session_id=? AND activity_id=? ORDER BY rowid DESC LIMIT 1').get(sessionId, activity.id);
      const value = last ? JSON.parse(last.response_json).value : { files: activity.publicConfig.files };
      if (value.database === checkpoint.database_snapshot) continue;
      store.db.prepare('INSERT INTO answer_drafts(session_id,activity_id,response_json,updated_at) VALUES (?,?,?,?)').run(sessionId, activity.id, JSON.stringify({ value: { ...value, database: checkpoint.database_snapshot } }), checkpoint.saved_at);
    }
    const drafts = store.db
      .prepare('SELECT activity_id,response_json,updated_at FROM answer_drafts WHERE session_id=?')
      .all(sessionId);
    for (const draft of drafts) {
      const response = JSON.parse(draft.response_json);
      if (!response.value?.files) continue;
      const database = await previews.snapshot(sessionId, draft.activity_id).catch((error) => {
        checkpointFailures++;
        console.error(JSON.stringify({ code: 'CHECKPOINT_FAILED', sessionId, activityId: draft.activity_id, cause: error.code, message: error.message }));
        return undefined;
      });
      if (database) {
        response.value.database = database;
        store.db
          .prepare(
            'UPDATE answer_drafts SET response_json=? WHERE session_id=? AND activity_id=? AND updated_at=?',
          )
          .run(JSON.stringify(response), sessionId, draft.activity_id, draft.updated_at);
      }
    }
  }

  function checkpoint(sessionId) {
    if (checkpoints.has(sessionId)) return checkpoints.get(sessionId);
    const work = checkpointAnswer(sessionId).then(() => { lastCheckpointAt = new Date().toISOString(); })
      .finally(() => checkpoints.delete(sessionId));
    checkpoints.set(sessionId, work);
    return work;
  }

  async function settle(sessionId, force = false) {
    const { session } = store.context(sessionId);
    if (session.status !== 'in_progress' || (!force && Date.now() < Date.parse(session.deadline_at))) return;
    if (settling.has(sessionId)) return settling.get(sessionId);
    const work = (async () => {
      await checkpoint(sessionId);
      store.settleAttempt(sessionId, force);
    })();
    settling.set(sessionId, work);
    try {
      await work;
    } finally {
      settling.delete(sessionId);
    }
  }

  async function processSessions(ids, action, code) {
    const waiting = [...ids];
    await Promise.all(Array.from({ length: Math.min(4, waiting.length) }, async () => {
      while (waiting.length) {
        const id = waiting.shift();
        try { await action(id); }
        catch (error) { console.error(JSON.stringify({ code, sessionId: id, cause: error.cause?.code, message: error.message })); }
      }
    }));
  }

  return {
    settle,
    stats: () => ({ settling: settling.size, checkpointing: checkpoints.size, lastCheckpointAt, checkpointFailures }),
    drain: () => Promise.allSettled([...settling.values(), ...checkpoints.values()]),
    isSettling: (sessionId) => settling.has(sessionId),
    settleExpired: (runId) => processSessions(store.expiredSessionIds(runId), settle, 'EXPIRY_FAILED'),
    checkpointActive() {
      if (!previews) return;
      const ids = store.db
        .prepare(
          `SELECT DISTINCT d.session_id FROM answer_drafts d JOIN sessions s ON s.id=d.session_id
        WHERE s.status='in_progress' AND s.deadline_at>?`,
        )
        .all(new Date().toISOString())
        .map((row) => row.session_id);
      return processSessions(ids, checkpoint, 'CHECKPOINT_FAILED');
    },
  };
}
