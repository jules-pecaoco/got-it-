export function attemptSettlement(store, previews) {
  const settling = new Map();

  async function checkpoint(sessionId) {
    if (!previews) return;
    const drafts = store.db
      .prepare('SELECT activity_id,response_json,updated_at FROM answer_drafts WHERE session_id=?')
      .all(sessionId);
    for (const draft of drafts) {
      const response = JSON.parse(draft.response_json);
      if (!response.value?.files) continue;
      const database = await previews.snapshot(sessionId, draft.activity_id).catch((error) => {
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
    for (const id of ids) {
      try {
        await action(id);
      } catch (error) {
        console.error(
          JSON.stringify({ code, sessionId: id, cause: error.cause?.code, message: error.message }),
        );
      }
    }
  }

  return {
    settle,
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
