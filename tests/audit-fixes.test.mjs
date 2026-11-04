import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.DATA_FILE = ':memory:';
process.env.DEMO_MODE = '1';
delete process.env.PUBLIC_ORIGIN;
const { server, store } = await import('../src/server.mjs');
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); store.close(); });
const call = async (path, { method = 'GET', data, token, headers = {} } = {}) => {
  const response = await fetch(base + path, { method, headers: {
    ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers
  }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { response, payload: await response.json() };
};
const createRun = (options = {}) => store.createRun({
  examId: 'garden-demo', version: 1, pin: 'audit-pin', feedbackMode: 'graded',
  opensAt: new Date(Date.now() - 60_000).toISOString(),
  closesAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
  roster: [{ candidateId: 'AUDIT-1', displayName: 'Fictional Student', section: 'Audit' }], ...options
});
const credentials = run => ({ runId: run.id, candidateId: 'AUDIT-1', pin: 'audit-pin' });

test('500 students can preview and join through one socket IP; forwarded headers do not bypass failed-account limits', async () => {
  const roster = Array.from({ length: 500 }, (_, index) => ({
    candidateId: `LAB-${index}`, displayName: `Fictional Student ${index}`, section: 'Audit'
  }));
  const run = createRun({ roster });
  for (const student of roster) {
    const data = { ...credentials(run), candidateId: student.candidateId };
    for (const action of ['preview', 'join']) {
      const result = await call(`/api/auth/student/${action}`, { method: 'POST', data });
      assert.equal(result.response.status, 200, `${student.candidateId} ${action}`);
    }
  }
  const target = { ...credentials(run), candidateId: 'LAB-0', pin: 'wrong' };
  for (let index = 0; index < 10; index++) {
    assert.equal((await call('/api/auth/student/preview', {
      method: 'POST', data: target, headers: { 'X-Forwarded-For': `192.0.2.${index}` }
    })).response.status, 401);
  }
  const limited = await call('/api/auth/student/join', { method: 'POST', data: { ...target, pin: 'audit-pin' } });
  assert.equal(limited.response.status, 429);
  assert.ok(Number(limited.response.headers.get('retry-after')) > 0);
  assert.equal((await call('/api/auth/student/join', {
    method: 'POST', data: { ...credentials(run), candidateId: 'LAB-1' }
  })).response.status, 200);
});

test('reopen and expired-attempt extension hide published graded scores until faculty republishes', () => {
  for (const action of ['reopen', 'extend']) {
    const run = createRun();
    const joined = store.join(credentials(run));
    const mission = store.missionView(joined.session.id, joined.session.order[0].id);
    const activity = mission.activities[0];
    store.submit(joined.session.id, activity.id,
      activity.type === 'numeric_entry' ? { value: 12, unit: 'm2' } : { value: 'b' });
    if (action === 'reopen') store.finalize(joined.session.id);
    else store.db.prepare('UPDATE sessions SET deadline_at=? WHERE id=?')
      .run(new Date(Date.now() - 1000).toISOString(), joined.session.id);
    store.publishStudentResults(run.id, 'AUDIT-1');
    assert.equal(store.sessionView(joined.session.id).score, 50);
    store.recoverStudent(run.id, 'AUDIT-1', { minutes: 5, reason: 'Audit recovery' }, action);
    const active = store.sessionView(joined.session.id);
    assert.equal(active.status, 'in_progress');
    assert.equal(active.resultsReleased, false);
    assert.equal(Object.hasOwn(active, 'score'), false);
    assert.equal(store.results(run.id).rows[0].resultsReleased, false);
    assert.equal(store.reviewStudent(run.id, 'AUDIT-1').resultsReleased, false);
    // A stale release marker must not override active-attempt policy either.
    store.db.prepare('UPDATE sessions SET results_published_at=? WHERE id=?').run(new Date().toISOString(), active.id);
    assert.equal(store.sessionView(active.id).resultsReleased, false);
    store.db.prepare('UPDATE sessions SET results_published_at=NULL WHERE id=?').run(active.id);
    const next = active.order.find(item => item.unlocked && !item.completed);
    const question = store.missionView(active.id, next.id).activities[0];
    store.submit(active.id, question.id, question.type === 'numeric_entry' ? { value: 12, unit: 'm2' } : { value: 'b' });
    assert.equal(Object.hasOwn(store.sessionView(active.id), 'score'), false);
    store.finalize(active.id);
    assert.equal(store.sessionView(active.id).resultsReleased, false);
    store.publishCompletedResults(run.id);
    assert.equal(store.sessionView(active.id).score, 100);
  }
});

test('invalid mission and question identifiers cannot publish; valid identifiers work through HTTP', async () => {
  const source = store.getExam('garden-demo', 1);
  const pub = structuredClone(source.public);
  pub.examId = 'audit-identifiers';
  store.importDraft(pub, source.private);
  for (const invalid of ['question_with_underscore', 'has space', 'path/part', '题', 'a'.repeat(81), 12]) {
    for (const field of ['mission', 'activity']) {
      const changed = structuredClone(pub);
      if (field === 'mission') changed.missions[0].id = invalid;
      else changed.missions[0].activities[0].id = invalid;
      store.updateDraft(pub.examId, 1, changed, source.private);
      assert.throws(() => store.publish(pub.examId, 1), error => error.code === 'PACKAGE_INVALID');
    }
  }
  pub.missions.forEach(mission => { delete mission.shuffleGroup; });
  pub.missions[0].id = 'M-1';
  pub.missions[0].activities[0].id = 'Q-9';
  store.updateDraft(pub.examId, 1, pub, source.private);
  store.publish(pub.examId, 1);
  const run = createRun({ examId: pub.examId });
  const joined = store.join(credentials(run));
  assert.equal((await call('/api/me/missions/M-1', { token: joined.token })).response.status, 200);
  assert.equal((await call('/api/me/activities/Q-9/submit', {
    method: 'POST', token: joined.token, data: { value: 12, unit: 'm2' }
  })).response.status, 200);
});

const fragmented = (path, token, chunks) => new Promise((resolve, reject) => {
  const request = http.request(base + path, { method: 'PUT', headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${token}`
  } }, response => {
    const received = [];
    response.on('data', chunk => received.push(chunk));
    response.on('end', () => resolve({ status: response.statusCode, payload: JSON.parse(Buffer.concat(received)) }));
  });
  request.on('error', reject);
  (async () => {
    for (const chunk of chunks) { request.write(chunk); await new Promise(resolve => setTimeout(resolve, 2)); }
    request.end();
  })().catch(reject);
});

test('JSON preserves UTF-8 split at every byte, rejects malformed bytes, and enforces byte limits', async () => {
  const run = createRun();
  const instructor = store.loginInstructor('audit', 'audit').token;
  const name = 'Café 中文 😀';
  const bytes = Buffer.from(JSON.stringify({ name }));
  const result = await fragmented(`/api/instructor/runs/${run.id}/name`, instructor,
    [...bytes].map(byte => Buffer.from([byte])));
  assert.equal(result.status, 200);
  assert.equal(store.listRuns().find(item => item.id === run.id).name, name);
  assert.equal((await fragmented(`/api/instructor/runs/${run.id}/name`, instructor,
    [Buffer.from('{"name":"'), Buffer.from([0xff]), Buffer.from('"}')])).status, 400);
  const joined = store.join(credentials(run));
  const activity = store.missionView(joined.session.id, joined.session.order[0].id).activities[0];
  const oversized = await call(`/api/me/activities/${activity.id}/draft`, {
    method: 'PUT', token: joined.token, data: { value: '中'.repeat(40_000) }
  });
  assert.equal(oversized.response.status, 413);
});

test('browser sessions use scoped HttpOnly cookies, reject cross-origin mutations, and revoke faculty and student access on logout', async () => {
  const browserHeaders = { 'X-Session-Mode': 'cookie', 'X-Session-Id': '11111111-1111-4111-8111-111111111111' };
  const login = await call('/api/instructor/login', {
    method: 'POST', data: { password: process.env.INSTRUCTOR_PASSWORD || 'demo-instructor' }, headers: browserHeaders
  });
  assert.equal(login.response.status, 200);
  assert.equal(Object.hasOwn(login.payload.data, 'token'), false);
  const setCookie = login.response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly; SameSite=Strict/);
  assert.match(setCookie, /Path=\/api\/instructor/);
  const facultyHeaders = { ...browserHeaders, Cookie: setCookie.split(';')[0] };
  assert.equal((await call('/api/instructor/session', { headers: facultyHeaders })).response.status, 200);
  const otherTab = { ...facultyHeaders, 'X-Session-Id': '22222222-2222-4222-8222-222222222222' };
  assert.equal((await call('/api/instructor/session', { headers: otherTab })).response.status, 401);
  assert.equal((await call('/api/instructor/logout', {
    method: 'POST', headers: { ...facultyHeaders, Origin: 'https://untrusted.invalid' }
  })).response.status, 403);
  const logout = await call('/api/instructor/logout', { method: 'POST', headers: facultyHeaders });
  assert.equal(logout.response.status, 200);
  assert.match(logout.response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await call('/api/instructor/session', { headers: facultyHeaders })).response.status, 401);

  const run = createRun();
  const joined = await call('/api/auth/student/join', { method: 'POST', data: credentials(run), headers: browserHeaders });
  assert.equal(Object.hasOwn(joined.payload.data, 'token'), false);
  const studentHeaders = { ...browserHeaders, Cookie: joined.response.headers.get('set-cookie').split(';')[0] };
  assert.equal((await call('/api/me/session', { headers: studentHeaders })).response.status, 200);
  assert.equal((await call('/api/instructor/assessments', { headers: studentHeaders })).response.status, 401);
  const before = joined.payload.data.session;
  const activity = store.missionView(before.id, before.order[0].id).activities[0];
  store.saveDraft(before.id, activity.id, { value: 'Saved before logout' });
  assert.equal((await call('/api/me/logout', { method: 'POST', headers: studentHeaders })).response.status, 200);
  assert.equal((await call('/api/me/session', { headers: studentHeaders })).response.status, 401);
  const resumed = store.join(credentials(run));
  assert.equal(resumed.session.id, before.id);
  assert.equal(resumed.session.deadlineAt, before.deadlineAt);
  assert.deepEqual(resumed.session.order, before.order);
  assert.equal(store.missionView(before.id, before.order[0].id).activities[0].lastDraft.value, 'Saved before logout');
  store.db.prepare('UPDATE sessions SET token_expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', before.id);
  assert.equal((await call('/api/me/session', { token: resumed.token })).response.status, 401);
  assert.equal(store.join(credentials(run)).session.deadlineAt, before.deadlineAt);
});
