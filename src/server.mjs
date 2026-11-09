import { facultyApi } from './routes/faculty.mjs';
import { studentApi } from './routes/student.mjs';
import { createHttpServer } from './http-server.mts';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Store } from './store.mjs';
import { loadConfig } from './config.mjs';
import { RateLimiter } from './rate-limit.mjs';
import { accessToken, browserSession, clearBrowserSession, checkRequestOrigin } from './http-session.mjs';
import { executionRunner, executionStatus } from './execution-client.mts';
import { terminalService } from './terminal-client.mts';
import { createPreviewService } from './web-preview.mts';
import { migrationDatabase } from './migration-database.mjs';
import { measureRequest, metricsSnapshot } from './metrics.mts';
import { attemptSettlement } from './attempt-settlement.mjs';
import { startSettlementTimers } from './settlement-timers.mjs';
import { startCodeReconciliation } from './code-runner.mjs';

const runtimeConfig = loadConfig();
if (process.env.NODE_ENV !== 'test' && process.env.MIGRATION_ACTIVE !== '1') runtimeConfig.dataFile = migrationDatabase(runtimeConfig.dataFile);
const { root, dataFile, demoMode, platformLabel, platformTagline, instructorPassword, publicOrigin } = runtimeConfig;
if (!instructorPassword) throw new Error('INSTRUCTOR_PASSWORD is required when DEMO_MODE=0.');
const previewOrigin = process.env.PREVIEW_ORIGIN ? new URL(process.env.PREVIEW_ORIGIN).origin : null;
if (previewOrigin && previewOrigin === publicOrigin) throw new Error('PREVIEW_ORIGIN must differ from PUBLIC_ORIGIN.');
const store = new Store(dataFile, { codeRunner: executionRunner(), automaticSettlement: !previewOrigin });
const terminals = terminalService();
const codeCleanup = process.env.EXECUTION_ORIGIN ? null : startCodeReconciliation();
const assetCache = new Map();
const webPreviews = previewOrigin ? createPreviewService(
  previewOrigin,
  sessionId => {
    const session = previewSession(sessionId);
    return session?.status === 'in_progress' && !settlement.isSettling(sessionId) && Date.now() < Date.parse(session.deadline_at);
  },
  publicOrigin || '*',
  sessionId => previewSession(sessionId)?.status !== 'in_progress',
  { checkpoints: store.webCheckpointStore() },
) : null;
const settlement = attemptSettlement(store, webPreviews);
const runtimeStatus = executionStatus(Boolean(webPreviews));
function previewSession(sessionId) {
  return store.db.prepare('SELECT status,deadline_at FROM sessions WHERE id=?').get(sessionId);
}
function answerLimit(sessionId, activityId) {
  const activity = store.context(sessionId).exam.public.missions.flatMap(mission => mission.activities).find(item => item.id === activityId);
  return activity?.type === 'web_project' ? 1_700_000 : 110_000;
}

if (demoMode && process.env.NODE_ENV === 'test') {
  const { seedDemo } = await import('../tests/fixtures/seed.mjs');
  seedDemo(store);
}

function json(res, status, payload, requestId, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify({ ...payload, requestId, serverNow: new Date().toISOString() }));
}
function csv(res, body) {
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="gradebook.csv"', 'Cache-Control': 'no-store' });
  res.end(body);
}
async function body(req, maxLength = 1_000_000) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxLength) throw Object.assign(new Error('Request body is too large.'), { code: 'TOO_LARGE', status: 413 });
    chunks.push(chunk);
  }
  let raw;
  try { raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw Object.assign(new Error('Request body must use valid UTF-8.'), { code: 'INVALID_JSON', status: 400 }); }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error('Invalid JSON.'), { code: 'INVALID_JSON', status: 400 }); }
}
const rate = new RateLimiter();
const limit = (key, max, windowMs) => rate.consume(key, max, windowMs);
function studentAdmission(req, input, preview) {
  const ip = req.socket.remoteAddress;
  const identity = createHash('sha256').update(JSON.stringify([input?.runId, input?.candidateId])).digest('hex');
  const accountKey = `join-failed:${identity}`, ipKey = `join-failed-ip:${ip}`;
  try {
    const result = preview ? store.previewJoin(input) : store.join(input);
    rate.clear(accountKey);
    return result;
  } catch (err) {
    if (err.code === 'UNAUTHORIZED') {
      rate.consume(accountKey, 10);
      rate.consume(ipKey, 200);
    }
    throw err;
  }
}
const csvCell = value => {
  let text = String(value ?? '');
  if (/^[=+@\-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
function gradebook(result) {
  const rows = [['Candidate ID', 'Name', 'Section', 'Status', 'Score', 'Maximum', 'Started at', 'Deadline', 'Grading status']];
  for (const r of result.rows) {
    const grading = r.status === 'registered' ? 'No attempt' : r.finalizationPending ? 'Finalization pending'
      : r.failedCodingCount ? 'Grading interrupted' : r.pendingCoding ? 'Grading queued'
        : r.pendingReview ? 'Review pending' : r.status === 'in_progress' ? 'In progress' : 'Graded';
    rows.push([r.candidateId, r.displayName, r.section, r.status, grading === 'Graded' ? r.score : '', result.maxPoints, r.startedAt, r.deadlineAt, grading]);
  }
  return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
const send = (res, requestId, result, status = 200) => json(res, status, { ok: true, data: result }, requestId);
const error = (res, requestId, err) => json(res, err.status ?? 500, {
  ok: false, code: err.code ?? 'INTERNAL_ERROR', message: err.status ? err.message : 'Internal server error.',
  retryAfterSeconds: err.retryAfter ?? null
}, requestId, err.retryAfter ? { 'Retry-After': String(err.retryAfter) } : {});

async function api(req, res, url, requestId) {
  const path = url.pathname, method = req.method;
  if (method === 'GET' && path === '/api/health') return send(res, requestId, { status: 'ok', demoMode });
  if (method === 'GET' && path === '/api/ready') {
    store.db.prepare('SELECT 1').get();
    return send(res, requestId, { status: 'ready' });
  }
  if (method === 'GET' && path === '/api/config') return send(res, requestId, { platformLabel, platformTagline, demoMode, features: { liveTerminal: true } });
  if (method === 'GET' && path === '/api/demo') {
    if (!demoMode || process.env.NODE_ENV !== 'test')
      throw Object.assign(new Error('Demo fixtures are unavailable.'), { code: 'NOT_FOUND', status: 404 });
    return send(res, requestId, { simulated: true, instructorPassword: 'demo-instructor', pin: '4242',
      candidates: [{ candidateId: 'DEMO-001' }, { candidateId: 'DEMO-002' }],
      runs: store.listRuns().filter(x => (process.env.NODE_ENV === 'test'
        ? ['archives-demo', 'garden-demo', 'itp255-week13-table-rescue']
        : ['itp255-week13-table-rescue']).includes(x.examId)) });
  }
  if (method === 'POST' && path === '/api/instructor/login') {
    limit(`admin-login:${req.socket.remoteAddress}`, 10);
    const input = await body(req);
    return send(res, requestId, browserSession(req, res, 'instructor', store.loginInstructor(input.password, instructorPassword, input.username || 'faculty'), publicOrigin));
  }
  if (method === 'POST' && path === '/api/auth/proctor/join') {
    limit(`proctor-login:${req.socket.remoteAddress}`, 10);
    const input = await body(req);
    return send(res, requestId, browserSession(req, res, 'proctor', store.loginProctor(input.runId, input.code), publicOrigin));
  }
  if (path.startsWith('/api/proctor/')) {
    const proctorToken = accessToken(req, 'proctor');
    const runId = store.requireProctor(proctorToken);
    if (method === 'GET' && path === '/api/proctor/run') return send(res, requestId, store.proctorView(runId));
    if (method === 'POST' && path === '/api/proctor/logout') {
      const result = store.logoutProctor(proctorToken);
      clearBrowserSession(req, res, 'proctor', publicOrigin);
      return send(res, requestId, result);
    }
  }
  if (path.startsWith('/api/instructor/')) return facultyApi({ req, res, url, requestId, store, publicOrigin, send, csv, gradebook, body, limit, metricsSnapshot, settlement, runtimeStatus, webPreviews });
  if (method === 'POST' && (path === '/api/auth/student/join' || path === '/api/auth/student/preview')) {
    // Socket address is intentional: forwarded headers are not trusted. Allow a full
    // 500-student class behind NAT/proxy; credential failures have separate limits.
    limit(`join-requests:${req.socket.remoteAddress}`, 5000);
    const input = await body(req);
    const preview = path.endsWith('/preview');
    const result = studentAdmission(req, input, preview);
    if (!preview && result.resumed && result.session.status === 'expired') {
      await settlement.settle(result.session.id);
      result.session = store.sessionView(result.session.id);
    }
    return send(res, requestId, preview ? result : browserSession(req, res, 'candidate', result, publicOrigin));
  }
  if (path.startsWith('/api/me/')) return studentApi({ req, res, url, requestId, store, publicOrigin, send, body, limit, webPreviews, answerLimit, settlement, terminals, runtimeStatus });
  throw Object.assign(new Error('Route not found.'), { code: 'NOT_FOUND', status: 404 });
}

const staticTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf' };
const { app, server, ready } = createHttpServer(async (req, res) => {
  measureRequest(req, res);
  const requestId = randomUUID();
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; frame-src ${previewOrigin || "'none'"}; base-uri 'none'; object-src 'none'`);
  try {
    const url = new URL(req.url, 'http://localhost');
    if (shuttingDown) throw Object.assign(new Error('The application is restarting. Retry shortly.'), { code: 'SERVER_DRAINING', status: 503 });
    if (url.pathname.startsWith('/api/')) {
      checkRequestOrigin(req, publicOrigin);
      return await api(req, res, url, requestId);
    }
    let path = url.pathname;
    if (path === '/' || path === '' || path === '/index.html') path = '/student.html';
    else if (path === '/app/student' || path === '/app/student/') path = '/student.html';
    else if (path === '/app/faculty' || path === '/app/faculty/') path = '/faculty.html';
    else if (path === '/app/proctor' || path === '/app/proctor/') path = '/proctor.html';
    const normalized = normalize(path).replace(/^[/\\]+/, '');
    if (normalized.includes('..') || !staticTypes[extname(normalized)]) throw Object.assign(new Error('Not found.'), { code: 'NOT_FOUND', status: 404 });
    const file = join(root, 'public', normalized);
    if (!file.startsWith(join(root, 'public')) || !existsSync(file)) throw Object.assign(new Error('Not found.'), { code: 'NOT_FOUND', status: 404 });
    const info = statSync(file), cached = assetCache.get(file);
    let asset = cached;
    if (!cached || cached.mtime !== info.mtimeMs || cached.size !== info.size) {
      const bytes = readFileSync(file);
      asset = { bytes, mtime: info.mtimeMs, size: info.size, etag: '"' + createHash('sha256').update(bytes).digest('hex') + '"' };
      assetCache.set(file, asset);
    }
    if (extname(file) === '.html') {
      const nonce = randomUUID().replaceAll('-', '');
      res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src ${previewOrigin || "'none'"}; base-uri 'none'; object-src 'none'`);
      res.writeHead(200, { 'Content-Type': staticTypes['.html'], 'Cache-Control': 'no-store' });
      return res.end(req.method === 'HEAD' ? undefined : asset.bytes.toString('utf8').replace('<head>', '<head><meta name="expected-output-style-nonce" content="' + nonce + '">'));
    }
    const headers = { 'Content-Type': staticTypes[extname(file)], 'Cache-Control': 'private, no-cache', ETag: asset.etag };
    if (req.headers['if-none-match'] === asset.etag) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : asset.bytes);
  } catch (err) {
    if (!err.status || err.status >= 500) console.error(JSON.stringify({ level: 'error', requestId, method: req.method, path: req.url?.split('?')[0], code: err.code || 'INTERNAL_ERROR', message: err.message, ...(err.provider ? { provider: err.provider } : {}) }));
    error(res, requestId, err);
  }
});

await ready;
let timers;
let shuttingDown = false;
let shutdown;
async function stopApplication() {
  shutdown ??= (async () => {
    shuttingDown = true;
    store.aiJobs.close();
    await timers?.stop();
    const drained = new Promise(resolve => server.close(resolve));
    // Existing requests have bounded timeouts. Stop accepting first, then wait
    // before closing the database used by their handlers.
    await drained;
    await store.aiJobs.drain();
    await codeCleanup?.stop();
    await settlement.drain();
    await webPreviews?.close();
    await terminals.close();
    store.codingQueue.close();
    const until = Date.now() + 30000;
    while (store.codingQueue.active && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25));
    if (store.codingQueue.active) throw new Error('Coding jobs did not drain before shutdown.');
    store.close();
  })();
  return shutdown;
}
server.on('close', () => { if (!shuttingDown) { void codeCleanup?.stop(); void terminals.close(); void webPreviews?.close(); } });
if (process.env.NODE_ENV !== 'test') {
  timers = startSettlementTimers(settlement);
  if (webPreviews) webPreviews.server.listen(Number(process.env.PREVIEW_PORT || 3102), process.env.PREVIEW_HOST || '127.0.0.1');
  const port = Number(process.env.PORT || 3000);
  server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`${platformLabel} listening on http://${process.env.HOST || '127.0.0.1'}:${port} (demo=${demoMode})`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdownAndExit);
}
function shutdownAndExit() {
  const deadline = setTimeout(() => process.exit(1), 45000);
  deadline.unref();
  void stopApplication().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
}
process.on('message', message => { if (message?.type === 'gotit:shutdown') shutdownAndExit(); });
process.channel?.unref();
export { server, store, webPreviews, terminals, stopApplication };
