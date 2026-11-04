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
import { executionRunner } from './execution-client.mts';
import { createPreviewService } from './web-preview.mts';
import { migrationDatabase } from './migration-database.mjs';
import { measureRequest, metricsSnapshot } from './metrics.mts';

const runtimeConfig = loadConfig();
if (process.env.NODE_ENV !== 'test' && process.env.MIGRATION_ACTIVE !== '1') runtimeConfig.dataFile = migrationDatabase(runtimeConfig.dataFile);
const { root, dataFile, demoMode, platformLabel, platformTagline, instructorPassword, publicOrigin } = runtimeConfig;
if (!instructorPassword) throw new Error('INSTRUCTOR_PASSWORD is required when DEMO_MODE=0.');
const store = new Store(dataFile, { codeRunner: executionRunner() });
const assetCache = new Map();
const previewOrigin = process.env.PREVIEW_ORIGIN ? new URL(process.env.PREVIEW_ORIGIN).origin : null;
if (previewOrigin && previewOrigin === publicOrigin) throw new Error('PREVIEW_ORIGIN must differ from PUBLIC_ORIGIN.');
const webPreviews = previewOrigin ? createPreviewService(previewOrigin, sessionId => {
  try { const { session } = store.context(sessionId); return session.status === 'in_progress' && Date.now() < Date.parse(session.deadline_at); } catch { return false; }
}, publicOrigin || '*') : null;
async function snapshotProjects(sessionId = null, all = false) {
  if (!webPreviews) return;
  const drafts = store.db.prepare(`SELECT d.session_id,d.activity_id,d.response_json FROM answer_drafts d JOIN sessions s ON s.id=d.session_id
    WHERE (? IS NULL OR d.session_id=?) AND (? OR ? IS NOT NULL OR s.deadline_at<=?)`).all(sessionId, sessionId, Number(all), sessionId, new Date().toISOString());
  for (const draft of drafts) {
    const response = JSON.parse(draft.response_json);
    if (!response.value?.files) continue;
    const database = await webPreviews.snapshot(draft.session_id, draft.activity_id);
    if (database) store.db.prepare('UPDATE answer_drafts SET response_json=? WHERE session_id=? AND activity_id=? AND response_json=?')
      .run(JSON.stringify({ value: { ...response.value, database } }), draft.session_id, draft.activity_id, draft.response_json);
  }
}
function answerLimit(sessionId, activityId) {
  const activity = store.context(sessionId).exam.public.missions.flatMap(mission => mission.activities).find(item => item.id === activityId);
  return activity?.type === 'web_project' ? 1_700_000 : 110_000;
}

function seedDemo() {
  for (const name of ['archives', 'garden']) {
    const pub = JSON.parse(readFileSync(join(root, 'examples', name, 'public-exam.json'), 'utf8'));
    const priv = JSON.parse(readFileSync(join(root, 'examples', name, 'private-grading.json'), 'utf8'));
    if (!store.listExams().some(x => x.examId === pub.examId && x.version === pub.version)) {
      store.importDraft(pub, priv, 'demo-seed');
      store.publish(pub.examId, pub.version, 'demo-seed');
    }
    if (!store.listRuns().some(x => x.examId === pub.examId && x.version === pub.version)) {
      store.createRun({
        examId: pub.examId, version: pub.version, pin: '4242', feedbackMode: 'practice',
        opensAt: new Date(Date.now() - 3600_000).toISOString(),
        closesAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
        roster: [
          { candidateId: 'DEMO-001', displayName: 'Alex Rivera', section: 'Demo A' },
          { candidateId: 'DEMO-002', displayName: 'Sam Lee', section: 'Demo A' }
        ]
      }, 'demo-seed');
    }
  }
}
if (demoMode && process.env.NODE_ENV === 'test') seedDemo();

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
  rate.check(accountKey, 10);
  rate.check(ipKey, 200);
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
  const rows = [['Candidate ID', 'Name', 'Section', 'Status', 'Score', 'Maximum', 'Started at', 'Deadline']];
  for (const r of result.rows) rows.push([r.candidateId, r.displayName, r.section, r.status, r.score, result.maxPoints, r.startedAt, r.deadlineAt]);
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
  if (method === 'GET' && path === '/api/config') return send(res, requestId, { platformLabel, platformTagline, demoMode });
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
  if (path.startsWith('/api/instructor/')) return facultyApi({ req, res, url, requestId, store, publicOrigin, send, csv, gradebook, body, limit, metricsSnapshot });
  if (method === 'POST' && (path === '/api/auth/student/join' || path === '/api/auth/student/preview')) {
    // Socket address is intentional: forwarded headers are not trusted. Allow a full
    // 500-student class behind NAT/proxy; credential failures have separate limits.
    limit(`join-requests:${req.socket.remoteAddress}`, 5000);
    const input = await body(req);
    const preview = path.endsWith('/preview');
    const result = studentAdmission(req, input, preview);
    return send(res, requestId, preview ? result : browserSession(req, res, 'candidate', result, publicOrigin));
  }
  if (path.startsWith('/api/me/')) return studentApi({ req, res, url, requestId, store, publicOrigin, send, body, limit, webPreviews, answerLimit, snapshotProjects });
  throw Object.assign(new Error('Route not found.'), { code: 'NOT_FOUND', status: 404 });
}

const staticTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
const { app, server, ready } = createHttpServer(async (req, res) => {
  measureRequest(req, res);
  const requestId = randomUUID();
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; frame-src ${previewOrigin || "'none'"}; base-uri 'none'; object-src 'none'`);
  try {
    const url = new URL(req.url, 'http://localhost');
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
    const headers = { 'Content-Type': staticTypes[extname(file)], 'Cache-Control': 'private, no-cache', ETag: asset.etag };
    if (req.headers['if-none-match'] === asset.etag) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : asset.bytes);
  } catch (err) {
    if (!err.status || err.status >= 500) console.error(JSON.stringify({ level: 'error', requestId, method: req.method, path: req.url?.split('?')[0], code: err.code || 'INTERNAL_ERROR', message: err.message }));
    error(res, requestId, err);
  }
});

await ready;
if (process.env.NODE_ENV !== 'test') {
  let settling = false, lastCheckpoint = 0;
  const expiryTimer = setInterval(async () => {
    if (settling) return; settling = true;
    try { const all = Date.now() - lastCheckpoint > 15000; await snapshotProjects(null, all); if (all) lastCheckpoint = Date.now(); store.settleExpired(); } catch (error) { console.error(JSON.stringify({ code: 'EXPIRY_FAILED', message: error.message })); }
    finally { settling = false; }
  }, 1000);
  expiryTimer.unref();
  server.on('close', () => clearInterval(expiryTimer));
  if (webPreviews) {
    webPreviews.server.listen(Number(process.env.PREVIEW_PORT || 3102), process.env.PREVIEW_HOST || '127.0.0.1');
    server.on('close', () => { void webPreviews.close(); });
  }
  const port = Number(process.env.PORT || 3000);
  server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`${platformLabel} listening on http://${process.env.HOST || '127.0.0.1'}:${port} (demo=${demoMode})`));
}
export { server, store, webPreviews };
