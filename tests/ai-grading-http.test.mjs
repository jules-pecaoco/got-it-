import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { asFaculty } from '../src/faculty-access.mjs';

process.env.NODE_ENV = 'test';
process.env.DATA_FILE = ':memory:';
process.env.DEMO_MODE = '0';
process.env.INSTRUCTOR_PASSWORD = 'grading-http-fixture';
process.env.GEMINI_API_KEY = '';
const { server, store } = await import('../src/server.mjs');
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
test.after(() => { server.close(); store.close(); });
const base = `http://127.0.0.1:${server.address().port}`;
const login = store.loginInstructor('grading-http-fixture', 'grading-http-fixture', 'faculty');
const owner = store.requireInstructor(login.token);

test('AI grading routes enforce ownership and completion, and provider failure never changes a score', async () => {
  const run = asFaculty(owner, () => {
    const pub = JSON.parse(readFileSync(new URL('./fixtures/garden/public-exam.json', import.meta.url)));
    const priv = JSON.parse(readFileSync(new URL('./fixtures/garden/private-grading.json', import.meta.url)));
    store.importDraft(pub, priv); store.publish(pub.examId, 1);
    return store.createRun({ examId: pub.examId, version: 1, pin: '4242', feedbackMode: 'graded',
      opensAt: new Date(Date.now() - 10000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString(),
      roster: [{ candidateId: 'A', displayName: 'Fictional learner', section: 'Test A' }] });
  });
  const joined = store.join({ runId: run.id, candidateId: 'A', pin: '4242' });
  const path = `${base}/api/instructor/runs/${run.id}/students/A/scores/garden-area/ai-check`;
  const check = token => fetch(path, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await check(login.token)).status, 409);
  store.saveDraft(joined.session.id, 'garden-area', { value: 12, unit: 'm2' });
  store.finalize(joined.session.id);
  const before = asFaculty(owner, () => store.reviewStudent(run.id, 'A'));
  const response = await check(login.token);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'AI_NOT_CONFIGURED');
  const after = asFaculty(owner, () => store.reviewStudent(run.id, 'A'));
  assert.equal(after.score, before.score);
  assert.deepEqual(after.questions.map(q => q.override), before.questions.map(q => q.override));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => String(url).startsWith('https://generativelanguage.googleapis.com/')
    ? { ok: true, json: async () => ({ candidates: [{ finishReason:'STOP', content: { parts: [{text:JSON.stringify({points:7,feedback:'Synthetic advisory grade.'})}] } }] }) }
    : originalFetch(url, options);
  process.env.GEMINI_API_KEY = 'synthetic-provider-key';
  try {
    const suggestion = await check(login.token);
    assert.equal(suggestion.status, 200);
    assert.equal((await suggestion.json()).data.points, 7);
    assert.equal(asFaculty(owner, () => store.reviewStudent(run.id,'A')).score, before.score);
    const override = await fetch(path.replace('/ai-check',''), {method:'PUT',headers:{Authorization:`Bearer ${login.token}`,'Content-Type':'application/json'},body:JSON.stringify({points:9,reason:'Faculty final decision'})});
    assert.equal(override.status,200);
    await check(login.token);
    assert.equal(asFaculty(owner, () => store.reviewStudent(run.id,'A')).questions.find(q=>q.id==='garden-area').override.points,9);
  } finally { globalThis.fetch=originalFetch;process.env.GEMINI_API_KEY=''; }
  store.setFacultyPassword('other-teacher', 'another-test-password');
  const other = store.loginInstructor('another-test-password', 'grading-http-fixture', 'other-teacher');
  assert.equal((await check(other.token)).status, 404);
});
