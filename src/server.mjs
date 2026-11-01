import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './store.mjs';
import { aiAvailable, generateExam, proposeExam, inspectProposal, buildApprovedPackage, checkSourceSupport, validateGeneratedDraft } from './ai.mjs';
import { extractMaterial } from './materials.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const envFile = join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const dataFile = process.env.DATA_FILE || join(root, 'data', 'studio.sqlite');
const demoMode = process.env.DEMO_MODE !== '0';
const platformLabel = process.env.PLATFORM_LABEL || 'Got It!';
const platformTagline = process.env.PLATFORM_TAGLINE || 'Gotta Catch Ed All';
const instructorPassword = process.env.INSTRUCTOR_PASSWORD || (demoMode ? 'demo-instructor' : '');
if (!instructorPassword) throw new Error('INSTRUCTOR_PASSWORD is required when DEMO_MODE=0.');
const store = new Store(dataFile);

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
        examId: pub.examId, version: pub.version, pin: '4242',
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
  res.end(JSON.stringify({ ...payload, requestId }));
}
function csv(res, body) {
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="gradebook.csv"', 'Cache-Control': 'no-store' });
  res.end(body);
}
function token(req) { return /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]; }
async function body(req, maxLength = 1_000_000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > maxLength) throw Object.assign(new Error('Request body is too large.'), { code: 'TOO_LARGE', status: 413 });
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error('Invalid JSON.'), { code: 'INVALID_JSON', status: 400 }); }
}
const rate = new Map();
function limit(key, max, windowMs = 60_000) {
  const now = Date.now();
  const state = rate.get(key) ?? { start: now, count: 0 };
  if (now - state.start >= windowMs) { state.start = now; state.count = 0; }
  state.count++;
  rate.set(key, state);
  if (state.count > max) throw Object.assign(new Error('Too many requests. Please wait before retrying.'), {
    code: 'RATE_LIMITED', status: 429, retryAfter: Math.ceil((state.start + windowMs - now) / 1000)
  });
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
    return send(res, requestId, store.loginInstructor((await body(req)).password, instructorPassword));
  }
  if (method === 'POST' && path === '/api/auth/proctor/join') {
    limit(`proctor-login:${req.socket.remoteAddress}`, 10);
    const input = await body(req);
    return send(res, requestId, store.loginProctor(input.runId, input.code));
  }
  if (path.startsWith('/api/proctor/')) {
    const proctorToken = token(req);
    const runId = store.requireProctor(proctorToken);
    if (method === 'GET' && path === '/api/proctor/run') return send(res, requestId, store.proctorView(runId));
    if (method === 'POST' && path === '/api/proctor/logout') return send(res, requestId, store.logoutProctor(proctorToken));
  }
  if (path.startsWith('/api/instructor/')) {
    store.requireInstructor(token(req));
    if (method === 'POST' && path === '/api/instructor/materials/extract') {
      const input = await body(req, 15_000_000);
      if (typeof input.base64 !== 'string' || input.base64.length > 13_400_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))
        throw Object.assign(new Error('Invalid material upload.'), { code: 'INVALID_MATERIAL', status: 400 });
      return send(res, requestId, await extractMaterial({ filename: input.filename, bytes: new Uint8Array(Buffer.from(input.base64, 'base64')) }));
    }
    if (method === 'GET' && path === '/api/instructor/ai/status')
      return send(res, requestId, { available: aiAvailable(), model: process.env.GEMINI_MODEL || 'gemini-3.5-flash' });
    if (path === '/api/instructor/ai/proposal') {
      if (method === 'GET') return send(res, requestId, store.getAiProposal(token(req)));
      if (method === 'PUT') return send(res, requestId, store.saveAiProposal(token(req), await body(req)));
      if (method === 'DELETE') return send(res, requestId, store.deleteAiProposal(token(req)));
    }
    if (method === 'POST' && path === '/api/instructor/ai/inspect')
      return send(res, requestId, inspectProposal(await body(req)));
    if (method === 'POST' && path === '/api/instructor/ai/generate') {
      limit(`ai-generate:${req.socket.remoteAddress}`, 5, 3600_000);
      return send(res, requestId, await generateExam(await body(req)));
    }
    if (method === 'POST' && path === '/api/instructor/ai/propose') {
      limit(`ai-propose:${req.socket.remoteAddress}`, 5, 3600_000);
      return send(res, requestId, await proposeExam(await body(req)));
    }
    if (method === 'POST' && path === '/api/instructor/ai/approved-draft') {
      const input = await body(req);
      const packageResult = buildApprovedPackage(input);
      const created = store.tx(() => {
        const draft = store.importDraft(packageResult.public,
          { ...packageResult.private, evidence: packageResult.evidence }, 'ai-faculty');
        store.addSource(draft.examId, draft.version, input.source, 'ai-faculty');
        return draft;
      });
      return send(res, requestId, created, 201);
    }
    if (method === 'POST' && path === '/api/instructor/ai/draft') {
      const input = await body(req);
      const source = validateGeneratedDraft(input);
      const created = store.tx(() => {
        const draft = store.importDraft(input.public, input.private, 'ai-faculty');
        store.addSource(draft.examId, draft.version, source, 'ai-faculty');
        return draft;
      });
      return send(res, requestId, created, 201);
    }
    const aiCheckPath = /^\/api\/instructor\/ai\/check\/([a-z0-9-]+)\/(\d+)$/.exec(path);
    if (method === 'POST' && aiCheckPath) {
      limit(`ai-check:${req.socket.remoteAddress}`, 10, 3600_000);
      const exam = store.getExam(aiCheckPath[1], Number(aiCheckPath[2]));
      const sources = store.listSources(aiCheckPath[1], Number(aiCheckPath[2]));
      return send(res, requestId, await checkSourceSupport(exam, sources));
    }
    if (method === 'GET' && /^\/api\/instructor\/(assessments|exams)$/.test(path)) return send(res, requestId, store.listExams());
    if (method === 'POST' && /^\/api\/instructor\/(assessments|exams)$/.test(path)) {
      const input = await body(req);
      return send(res, requestId, store.importDraft(input.public, input.private), 201);
    }
    const examPath = /^\/api\/instructor\/(?:assessments|exams)\/([a-z0-9-]+)\/(\d+)(?:\/(validate|publish|clone|archive|restore))?$/.exec(path);
    const sourcePath = /^\/api\/instructor\/(?:assessments|exams)\/([a-z0-9-]+)\/(\d+)\/sources(?:\/([a-f0-9-]+))?$/.exec(path);
    if (sourcePath) {
      const [, id, rawVersion, sourceId] = sourcePath, version = Number(rawVersion);
      if (method === 'GET' && !sourceId) return send(res, requestId, store.listSources(id, version));
      if (method === 'POST' && !sourceId) return send(res, requestId, store.addSource(id, version, await body(req)), 201);
      if (method === 'PUT' && sourceId) return send(res, requestId, store.reviewSource(id, version, sourceId, await body(req)));
    }
    if (examPath) {
      const [, id, rawVersion, action] = examPath, version = Number(rawVersion);
      if (method === 'GET' && !action) {
        const exam = store.getExam(id, version);
        return send(res, requestId, { status: exam.status, public: exam.public, private: exam.private, contentHash: exam.content_hash });
      }
      if (method === 'PUT' && !action) {
        const input = await body(req);
        return send(res, requestId, store.updateDraft(id, version, input.public, input.private));
      }
      if (method === 'POST' && action === 'validate') return send(res, requestId, { errors: store.validate(id, version) });
      if (method === 'POST' && action === 'clone') return send(res, requestId, store.cloneExam(id, version), 201);
      if (method === 'POST' && action === 'archive') return send(res, requestId, store.archiveExam(id, version));
      if (method === 'POST' && action === 'restore') return send(res, requestId, store.restoreExam(id, version));
      if (method === 'POST' && action === 'publish') {
        const input = await body(req);
        if (input.approved !== true) throw Object.assign(new Error('Explicit instructor approval is required.'), { code: 'APPROVAL_REQUIRED', status: 400 });
        return send(res, requestId, store.publish(id, version));
      }
    }
    if (path === '/api/instructor/classes') {
      if (method === 'GET') return send(res, requestId, store.listClasses());
      if (method === 'POST') return send(res, requestId, store.createClass(await body(req)), 201);
    }
    const classStudentPath = /^\/api\/instructor\/classes\/([a-f0-9-]+)\/students(?:\/([A-Za-z0-9-]{1,40}))?$/.exec(path);
    if (classStudentPath) {
      const [, classId, candidateId] = classStudentPath;
      if (method === 'POST' && !candidateId) return send(res, requestId, store.createStudent(classId, await body(req)), 201);
      if (method === 'PUT' && candidateId) return send(res, requestId, store.updateStudent(classId, candidateId, await body(req)));
      if (method === 'DELETE' && candidateId) return send(res, requestId, store.deleteStudent(classId, candidateId));
    }
    const classPath = /^\/api\/instructor\/classes\/([a-f0-9-]+)$/.exec(path);
    if (classPath) {
      if (method === 'GET') return send(res, requestId, store.getClass(classPath[1]));
      if (method === 'PUT') return send(res, requestId, store.updateClass(classPath[1], await body(req)));
      if (method === 'DELETE') return send(res, requestId, store.deleteClass(classPath[1]));
    }
    if (method === 'GET' && path === '/api/instructor/runs') return send(res, requestId, store.listRuns());
    if (method === 'POST' && path === '/api/instructor/runs') return send(res, requestId, store.createRun(await body(req)), 201);
    const studentReviewPath = /^\/api\/instructor\/runs\/([a-f0-9-]+)\/students\/([A-Za-z0-9-]{1,40})(?:\/scores\/([A-Za-z0-9-]+))?$/.exec(path);
    if (studentReviewPath) {
      const [, runId, candidateId, activityId] = studentReviewPath;
      if (method === 'GET' && !activityId) return send(res, requestId, store.reviewStudent(runId, candidateId));
      if (method === 'PUT' && activityId) return send(res, requestId,
        store.overrideQuestionScore(runId, candidateId, activityId, await body(req)));
      if (method === 'DELETE' && activityId) return send(res, requestId,
        store.clearQuestionScoreOverride(runId, candidateId, activityId));
    }
    const proctorAccessPath = /^\/api\/instructor\/runs\/([a-f0-9-]+)\/proctor-access$/.exec(path);
    if (proctorAccessPath) {
      const runId = proctorAccessPath[1];
      if (method === 'GET') return send(res, requestId, store.proctorAccess(runId));
      if (method === 'POST') return send(res, requestId, store.issueProctorAccess(runId));
      if (method === 'DELETE') return send(res, requestId, store.revokeProctorAccess(runId));
    }
    const runPath = /^\/api\/instructor\/runs\/([a-f0-9-]+)\/(name|results|export.csv)$/.exec(path);
    if (method === 'PUT' && runPath?.[2] === 'name') return send(res, requestId, store.renameRun(runPath[1], (await body(req)).name));
    if (method === 'GET' && runPath) {
      const result = store.results(runPath[1]);
      if (runPath[2] === 'export.csv') return csv(res, gradebook(result));
      return send(res, requestId, result);
    }
    if (method === 'GET' && path === '/api/instructor/audit') return send(res, requestId, store.auditLog());
  }
  if (method === 'POST' && path === '/api/auth/student/join') {
    limit(`join:${req.socket.remoteAddress}`, 20);
    return send(res, requestId, store.join(await body(req)));
  }
  if (path.startsWith('/api/me/')) {
    const sessionId = store.requireCandidate(token(req));
    if (method === 'GET' && (path === '/api/me/session' || path === '/api/me/results')) return send(res, requestId, store.sessionView(sessionId));
    if (method === 'GET' && path === '/api/me/missions/current') {
      const state = store.progress(sessionId);
      const current = state.find(x => x.unlocked && !x.completed) ?? state.findLast(x => x.unlocked);
      return send(res, requestId, current ? store.missionView(sessionId, current.id) : null);
    }
    const missionPath = /^\/api\/me\/missions\/([a-zA-Z0-9-]+)$/.exec(path);
    if (method === 'GET' && missionPath) return send(res, requestId, store.missionView(sessionId, missionPath[1]));
    const activityPath = /^\/api\/me\/activities\/([a-zA-Z0-9-]+)\/submit$/.exec(path);
    if (method === 'POST' && activityPath) {
      limit(`submit:${sessionId}:${activityPath[1]}`, 6);
      return send(res, requestId, store.submit(sessionId, activityPath[1], await body(req)));
    }
    if (method === 'POST' && path === '/api/me/finalize') return send(res, requestId, store.finalize(sessionId));
  }
  throw Object.assign(new Error('Route not found.'), { code: 'NOT_FOUND', status: 404 });
}

const staticTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const requestId = randomUUID();
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'");
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url, requestId);
    let path = url.pathname;
    if (path === '/' || path === '' || path === '/index.html') path = '/student.html';
    else if (path === '/app/student' || path === '/app/student/') path = '/student.html';
    else if (path === '/app/faculty' || path === '/app/faculty/') path = '/faculty.html';
    else if (path === '/app/proctor' || path === '/app/proctor/') path = '/proctor.html';
    const normalized = normalize(path).replace(/^[/\\]+/, '');
    if (normalized.includes('..') || !staticTypes[extname(normalized)]) throw Object.assign(new Error('Not found.'), { code: 'NOT_FOUND', status: 404 });
    const file = join(root, 'public', normalized);
    if (!file.startsWith(join(root, 'public')) || !existsSync(file)) throw Object.assign(new Error('Not found.'), { code: 'NOT_FOUND', status: 404 });
    res.writeHead(200, { 'Content-Type': staticTypes[extname(file)], 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
  } catch (err) { error(res, requestId, err); }
});

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT || 3000);
  server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`${platformLabel} listening on http://${process.env.HOST || '127.0.0.1'}:${port} (demo=${demoMode})`));
}
export { server, store };
