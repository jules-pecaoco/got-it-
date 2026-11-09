export function attemptSettlement(store, previews) {
  const settling = new Map();
  const checkpoints = new Map();
  let lastCheckpointAt = null, checkpointFailures = 0;

  async function checkpointAnswer(sessionId) {
    if (!previews) return;
    const { exam } = store.context(sessionId);
    const candidates = store.db.prepare(`
      SELECT activity_id FROM answer_drafts WHERE session_id=?
      UNION SELECT activity_id FROM web_checkpoints WHERE session_id=? AND database_snapshot IS NOT NULL
    `).all(sessionId, sessionId);
    const webIds = new Set(exam.public.missions.flatMap(m => m.activities)
      .filter(activity => activity.type === 'web_project').map(activity => activity.id));
    for (const { activity_id: activityId } of candidates) {
      if (!webIds.has(activityId)) continue;
      const draft = store.db.prepare('SELECT response_json,updated_at FROM answer_drafts WHERE session_id=? AND activity_id=?')
        .get(sessionId, activityId);
      let database = await previews.snapshot(sessionId, activityId).catch((error) => {
        checkpointFailures++;
        console.error(JSON.stringify({ code: 'CHECKPOINT_FAILED', sessionId, activityId, cause: error.code, message: error.message }));
        return undefined;
      });
      if (!draft) continue;
      const checkpoint = store.db.prepare('SELECT database_snapshot,saved_at,changed_at FROM web_checkpoints WHERE session_id=? AND activity_id=?')
        .get(sessionId, activityId);
      if (checkpoint) {
        const { session } = store.context(sessionId);
        // A later draft revision can contain newer source files and an older database.
        if ((checkpoint.changed_at ?? checkpoint.saved_at) > session.deadline_at) continue;
        database = checkpoint.database_snapshot;
      }
      if (typeof database !== 'string') continue;
      const response = JSON.parse(draft.response_json);
      response.value.database = database;
      store.db.prepare(
        'UPDATE answer_drafts SET response_json=? WHERE session_id=? AND activity_id=? AND updated_at=?',
      ).run(JSON.stringify(response), sessionId, activityId, draft.updated_at);
    }
  }

  function includeDatabaseOnlyWork(sessionId, exam, deadlineAt) {
    const checkpoints = store.db.prepare(`
      SELECT c.activity_id,c.database_snapshot,c.changed_at FROM web_checkpoints c
      WHERE c.session_id=? AND c.database_snapshot IS NOT NULL AND c.changed_at<=?
      AND NOT EXISTS (
        SELECT 1 FROM answer_drafts d WHERE d.session_id=c.session_id AND d.activity_id=c.activity_id
      )
    `).all(sessionId, deadlineAt);
    for (const checkpoint of checkpoints) {
      const activity = exam.public.missions.flatMap(m => m.activities)
        .find(a => a.id === checkpoint.activity_id && a.type === 'web_project');
      if (!activity) continue;
      const last = store.db.prepare('SELECT response_json FROM submissions WHERE session_id=? AND activity_id=? ORDER BY rowid DESC LIMIT 1')
        .get(sessionId, activity.id);
      const value = last ? JSON.parse(last.response_json).value : { files: activity.publicConfig.files };
      if (value.database === checkpoint.database_snapshot) continue;
      store.db.prepare('INSERT OR IGNORE INTO answer_drafts(session_id,activity_id,response_json,updated_at) VALUES (?,?,?,?)')
        .run(sessionId, activity.id, JSON.stringify({ value: { ...value, database: checkpoint.database_snapshot } }), checkpoint.changed_at);
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
      const { exam, session: current } = store.context(sessionId);
      if (current.status === 'in_progress' && (force || Date.now() >= Date.parse(current.deadline_at)))
        includeDatabaseOnlyWork(sessionId, exam, current.deadline_at);
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
        WHERE s.status='in_progress' AND s.deadline_at>? AND json_type(d.response_json, '$.value.files')='object'`,
        )
        .all(new Date().toISOString())
        .map((row) => row.session_id);
      return processSessions(ids, checkpoint, 'CHECKPOINT_FAILED');
    },
  };
}
