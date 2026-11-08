import { accessToken, clearBrowserSession } from '../http-session.mjs';
import { referenceGuides } from '../reference-guides.mts';

export async function studentApi({
  req,
  res,
  url,
  requestId,
  store,
  publicOrigin,
  send,
  body,
  limit,
  webPreviews,
  answerLimit,
  settlement,
  terminals,
  runtimeStatus,
}) {
  const method = req.method,
    path = url.pathname;

  const candidateToken = accessToken(req, 'candidate');
  const sessionId = store.requireCandidate(candidateToken);
  if (method === 'GET' && path === '/api/me/code/status') return send(res, requestId, await runtimeStatus());
  if (method === 'GET' && path === '/api/me/reference-guides') {
    const { exam } = store.context(sessionId);
    return send(res, requestId, { guides: referenceGuides(exam.public.settings.referenceGuides || []) });
  }
  const terminalPath = /^\/api\/me\/activities\/([A-Za-z0-9-]+)\/terminal(?:\/([a-f0-9-]{36}))?$/.exec(path);
  if (terminalPath) {
    const [, activityId, id] = terminalPath;
    if (method === 'DELETE' && id) return send(res, requestId, await terminals.stop(sessionId, id));
    let context;
    try {
      context = store.codingContext(sessionId, activityId);
    } catch (error) {
      if (id) await terminals.stop(sessionId, id).catch(() => {});
      throw error;
    }
    if (context.activity.type !== 'code_writing' || context.activity.publicConfig.language === 'sql')
      throw Object.assign(
        new Error('Live terminal input is available for Python, JavaScript and PHP console questions.'),
        { code: 'INVALID_TERMINAL', status: 422 },
      );
    if (method === 'POST' && !id) {
      limit(`terminal-open:${sessionId}`, 12);
      const input = await body(req, 70000);
      return send(
        res,
        requestId,
        await terminals.open(sessionId, context.activity.publicConfig.language, input.value),
        201,
      );
    }
    if (method === 'GET' && id) return send(res, requestId, await terminals.read(sessionId, id));
    if (method === 'POST' && id)
      return send(res, requestId, await terminals.write(sessionId, id, await body(req, 20000)));
  }
  if (method === 'POST' && path === '/api/me/heartbeat')
    return send(res, requestId, {
      acknowledged: true,
      deadlineAt: store.context(sessionId).session.deadline_at,
    });
  const jobPath = /^\/api\/me\/coding-jobs\/([a-f0-9-]{36})$/.exec(path);
  if (method === 'GET' && jobPath) return send(res, requestId, store.codingQueue.view(sessionId, jobPath[1]));
  if (method === 'POST' && path === '/api/me/logout') {
    const result = store.logoutCandidate(candidateToken);
    clearBrowserSession(req, res, 'candidate', publicOrigin);
    return send(res, requestId, result);
  }
  if (method === 'GET' && (path === '/api/me/session' || path === '/api/me/results')) {
    await settlement.settle(sessionId);
    return send(res, requestId, store.sessionView(sessionId));
  }
  if (method === 'GET' && path === '/api/me/missions/current') {
    const state = store.progress(sessionId);
    const current = state.find((x) => x.unlocked && !x.completed) ?? state.findLast((x) => x.unlocked);
    return send(res, requestId, current ? store.missionView(sessionId, current.id) : null);
  }
  const missionPath = /^\/api\/me\/missions\/([a-zA-Z0-9-]+)$/.exec(path);
  if (method === 'GET' && missionPath)
    return send(res, requestId, store.missionView(sessionId, missionPath[1]));
  const activityPath = /^\/api\/me\/activities\/([a-zA-Z0-9-]+)\/submit$/.exec(path);
  if (method === 'POST' && activityPath) {
    limit(`submit:${sessionId}:${activityPath[1]}`, 6);
    if (
      req.headers.prefer === 'respond-async' &&
      store
        .context(sessionId)
        .exam.public.missions.some((m) =>
          m.activities.some((a) => a.id === activityPath[1] && a.type === 'web_project'),
        )
    ) {
      const input = await body(req, answerLimit(sessionId, activityPath[1]));
      if (input.value?.files && webPreviews)
        input.value.database =
          (await webPreviews.snapshot(sessionId, activityPath[1])) || input.value.database;
      return send(
        res,
        requestId,
        store.queueCode(
          sessionId,
          activityPath[1],
          'submit',
          input,
          req.headers['idempotency-key'],
          req.headers['if-match'],
        ),
        202,
      );
    }
    return send(
      res,
      requestId,
      await store.submitAnswer(
        sessionId,
        activityPath[1],
        await body(req, answerLimit(sessionId, activityPath[1])),
        req.headers['idempotency-key'] ?? null,
        req.headers['if-match'],
      ),
    );
  }
  const codePreviewPath = /^\/api\/me\/activities\/([a-zA-Z0-9-]+)\/preview$/.exec(path);
  if (method === 'POST' && codePreviewPath) {
    limit(`code-preview:${sessionId}`, 12);
    if (req.headers.prefer === 'respond-async')
      return send(
        res,
        requestId,
        store.queueCode(
          sessionId,
          codePreviewPath[1],
          'preview',
          await body(req, 110_000),
          req.headers['idempotency-key'],
        ),
        202,
      );
    return send(
      res,
      requestId,
      await store.previewCode(sessionId, codePreviewPath[1], await body(req, 110_000)),
    );
  }
  const draftPath = /^\/api\/me\/activities\/([a-zA-Z0-9-]+)\/draft$/.exec(path);
  if (method === 'PUT' && draftPath) {
    const input = await body(req, answerLimit(sessionId, draftPath[1]));
    let warning;
    if (input.value?.files && webPreviews) {
      try {
        input.value.database = (await webPreviews.snapshot(sessionId, draftPath[1])) || input.value.database;
      } catch (error) {
        if (!['WEB_RUNTIME_UNAVAILABLE', 'WEB_WORKSPACE_ENDED', 'WEB_CAPACITY'].includes(error.code))
          throw error;
        const previous = store.db
          .prepare('SELECT response_json FROM answer_drafts WHERE session_id=? AND activity_id=?')
          .get(sessionId, draftPath[1]);
        if (previous)
          input.value.database = JSON.parse(previous.response_json).value?.database ?? input.value.database;
        warning =
          'Your project files are saved, but the latest database changes could not be saved. Keep this page open and tell your instructor before leaving.';
      }
    }
    const saved = store.saveDraft(sessionId, draftPath[1], input, req.headers['if-match']);
    return send(res, requestId, { ...saved, ...(warning ? { warning } : {}) });
  }
  const webPath = /^\/api\/me\/activities\/([a-zA-Z0-9-]+)\/web-preview$/.exec(path);
  if (method === 'GET' && webPath) {
    store.codingContext(sessionId, webPath[1]);
    return send(res, requestId, { database: await webPreviews?.snapshot(sessionId, webPath[1]) });
  }
  if (method === 'DELETE' && webPath) {
    store.codingContext(sessionId, webPath[1]);
    await webPreviews?.discard(sessionId, webPath[1]);
    return send(res, requestId, { discarded: true });
  }
  if (method === 'POST' && webPath) {
    limit(`web-preview:${sessionId}`, 6);
    const { activity } = store.codingContext(sessionId, webPath[1]);
    if (activity.type !== 'web_project')
      throw Object.assign(new Error('This is not a web project.'), { status: 422, code: 'INVALID_PROJECT' });
    if (!webPreviews)
      throw Object.assign(
        new Error('The PHP preview host is not configured. Ask faculty to configure PREVIEW_ORIGIN.'),
        { status: 503, code: 'WEB_NOT_CONFIGURED' },
      );
    const input = await body(req, 1_700_000);

    return send(
      res,
      requestId,
      await webPreviews.open(
        sessionId,
        activity.id,
        input.value,
        activity.publicConfig.seedSql,
        input.reset === true,
      ),
    );
  }
  if (method === 'POST' && path === '/api/me/finalize') {
    await settlement.settle(sessionId, true);
    return send(res, requestId, store.sessionView(sessionId));
  }

  throw Object.assign(new Error('Route not found.'), { code: 'NOT_FOUND', status: 404 });
}
