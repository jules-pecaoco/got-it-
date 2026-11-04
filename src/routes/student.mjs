import { accessToken, clearBrowserSession } from '../http-session.mjs';

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
  snapshotProjects,
}) {
  const method = req.method,
    path = url.pathname;

  const candidateToken = accessToken(req, 'candidate');
  const sessionId = store.requireCandidate(candidateToken);
  if (method === 'POST' && path === '/api/me/heartbeat') return send(res, requestId, { acknowledged: true });
  const jobPath = /^\/api\/me\/coding-jobs\/([a-f0-9-]{36})$/.exec(path);
  if (method === 'GET' && jobPath) return send(res, requestId, store.codingQueue.view(sessionId, jobPath[1]));
  if (method === 'POST' && path === '/api/me/logout') {
    const result = store.logoutCandidate(candidateToken);
    clearBrowserSession(req, res, 'candidate', publicOrigin);
    return send(res, requestId, result);
  }
  if (method === 'GET' && (path === '/api/me/session' || path === '/api/me/results'))
    return send(res, requestId, store.sessionView(sessionId));
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
          m.activities.some(
            (a) => a.id === activityPath[1] && ['code_writing', 'web_project'].includes(a.type),
          ),
        )
    ) {
      const input = await body(req, answerLimit(sessionId, activityPath[1]));
      if (input.value?.files && webPreviews)
        input.value.database =
          (await webPreviews.snapshot(sessionId, activityPath[1])) || input.value.database;
      return send(
        res,
        requestId,
        store.queueCode(sessionId, activityPath[1], 'submit', input, req.headers['idempotency-key']),
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
    if (input.value?.files && webPreviews)
      input.value.database = (await webPreviews.snapshot(sessionId, draftPath[1])) || input.value.database;
    return send(res, requestId, store.saveDraft(sessionId, draftPath[1], input, req.headers['if-match']));
  }
  const webPath = /^\/api\/me\/activities\/([a-zA-Z0-9-]+)\/web-preview$/.exec(path);
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
    await snapshotProjects(sessionId);
    return send(res, requestId, store.finalize(sessionId));
  }

  throw Object.assign(new Error('Route not found.'), { code: 'NOT_FOUND', status: 404 });
}
