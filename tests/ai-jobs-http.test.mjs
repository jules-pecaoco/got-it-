import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectProposal } from '../src/ai.mjs';

process.env.NODE_ENV = 'test';
process.env.DATA_FILE = ':memory:';
process.env.DEMO_MODE = '0';
process.env.INSTRUCTOR_PASSWORD = 'ai-jobs-http-fixture-password';
process.env.GEMINI_API_KEY = '';
process.env.GROQ_API_KEY = '';
const { server, store, stopApplication } = await import('../src/server.mjs');
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
test.after(() => stopApplication());
const base = `http://127.0.0.1:${server.address().port}`;
const source = { filename: 'lesson.md', content: 'Search filters matching rows before pagination. Ordering sorts rows by column values. A program can calculate a result from input values and display it to the user. Every displayed result depends on the supplied input values.' };
const input = { title: 'HTTP table assessment', subject: 'Programming', kind: 'quiz', difficulty: 'medium',
  questionCount: 20, missionCount: 5, durationMinutes: 40, questionMode: 'objective', programmingLanguage: 'auto', source };
async function call(path, { method = 'GET', data, token } = {}) {
  const response = await fetch(base + path, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, payload: await response.json() };
}
async function login(username) {
  const password = `${username}-password-long`;
  store.setFacultyPassword(username, password);
  const result = await call('/api/instructor/login', { method: 'POST', data: { username, password } });
  assert.equal(result.status, 200);
  return result.payload.data.token;
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function charge(budget) {
  budget.claim(); budget.record({ inputTokens: 1, outputTokens: 1, reasoningTokens: 0,
    totalTokens: 2, knownTokens: 2, operationId: budget.snapshot().operationId, outcome: 'success' });
}
function preview(request, offset = 0, longPrompts = false) {
  const questions = Array.from({ length: request.questionCount }, (_, index) => ({
    type: 'single_choice', prompt: `Question ${offset + index + 1}: Which operation narrows the matching rows?${longPrompts ? ' Consider the displayed records and the requested operation.'.repeat(105) : ''}`,
    options: ['Search', 'Ordering'], answer: 'Search', evidenceQuote: 'Search filters matching rows before pagination.', location: 'Source',
  }));
  const missions = Array.from({ length: Math.ceil(questions.length / 4) }, (_, index) => ({
    title: `Section ${offset + index + 1}`, activities: questions.slice(index * 4, index * 4 + 4),
  }));
  return inspectProposal({ ...request, design: { missions } });
}

test('HTTP job boundaries authenticate every action and isolate faculty progress', async t => {
  const owner = await login('jobs-owner'), other = await login('jobs-other');
  const entered = deferred(), release = deferred();
  let calls = 0;
  store.aiJobs.proposer = async (request, { budget }) => {
    charge(budget);
    if (++calls === 1) { entered.resolve(); await release.promise; }
    return preview(request);
  };
  t.after(async () => { release.resolve(); await store.aiJobs.drain(); });
  assert.equal((await call('/api/instructor/ai/jobs')).status, 401);
  assert.equal((await call('/api/instructor/ai/jobs', { method: 'POST', data: input })).status, 401);
  const created = await call('/api/instructor/ai/jobs', { method: 'POST', token: owner, data: input });
  assert.equal(created.status, 202);
  const id = created.payload.data.jobId, path = `/api/instructor/ai/jobs/${id}`;
  await entered.promise;
  for (const [method, suffix] of [['GET', ''], ['POST', '/resume'], ['POST', '/pause'], ['POST', '/cancel']]) {
    assert.equal((await call(path + suffix, { method })).status, 401);
    const forbidden = await call(path + suffix, { method, token: other });
    assert.equal(forbidden.status, 404);
    assert.equal(forbidden.payload.code, 'NOT_FOUND');
  }
  assert.deepEqual((await call('/api/instructor/ai/jobs', { token: other })).payload.data.jobs, []);
  assert.equal((await call('/api/instructor/ai/jobs', { token: owner })).payload.data.jobs[0].id, id);
  assert.equal((await call(path, { token: owner })).payload.data.status, 'running');
  assert.equal((await call(path + '/pause', { method: 'POST', token: owner })).payload.data.status, 'paused');
  const racingResume = await call(path + '/resume', { method: 'POST', token: owner });
  assert.equal(racingResume.status, 409);
  assert.equal(racingResume.payload.code, 'AI_BUSY');
  release.resolve(); await store.aiJobs.drain();
  assert.equal((await call(path, { token: owner })).payload.data.completedQuestions, 0);
  assert.equal((await call(path + '/resume', { method: 'POST', token: owner })).status, 202);
  await store.aiJobs.drain();
  const done = (await call(path, { token: owner })).payload.data;
  assert.equal(done.status, 'done');
  assert.equal(done.completedQuestions, 20);
  assert.equal(calls, 2);
  const freshLogin = await login('jobs-owner');
  assert.equal((await call('/api/instructor/ai/jobs', { token: freshLogin })).payload.data.jobs[0].id, id);
  const proposalPath = '/api/instructor/ai/proposal';
  const review = { input: done.input, proposal: done.proposal, selected: ['0:0'], job: { id, complete: true } };
  const newerReview = { ...review, job: null, selected: ['0:1'] };
  assert.equal((await call(proposalPath, { method: 'PUT', token: freshLogin, data: newerReview })).status, 200);
  assert.equal((await call(proposalPath, { method: 'PUT', token: freshLogin, data: review })).status, 409);
  assert.deepEqual((await call(proposalPath, { token: freshLogin })).payload.data, newerReview);
  assert.equal((await call(proposalPath, { method: 'DELETE', token: freshLogin })).status, 200);
  assert.equal((await call(proposalPath, { method: 'PUT', token: freshLogin, data: review })).status, 200);
  assert.deepEqual((await call('/api/instructor/ai/jobs', { token: freshLogin })).payload.data.jobs, []);
  const anotherLogin = await login('jobs-owner');
  assert.deepEqual((await call(proposalPath, { token: anotherLogin })).payload.data, review);
  assert.equal((await call(proposalPath, { token: other })).payload.data, null);
  assert.equal((await call(`${proposalPath}?jobId=${id}`, { method: 'DELETE', token: other })).status, 404);
  assert.equal((await call(`${proposalPath}?jobId=${id}`, { method: 'DELETE', token: anotherLogin })).status, 200);
  const staleSave = await call(proposalPath, { method: 'PUT', token: anotherLogin, data: review });
  assert.equal(staleSave.status, 409);
  assert.equal(staleSave.payload.code, 'STALE_REVIEW');
  assert.equal((await call(proposalPath, { token: anotherLogin })).payload.data, null);
  assert.deepEqual((await call('/api/instructor/ai/jobs', { token: anotherLogin })).payload.data.jobs, []);
});

test('HTTP cancellation is terminal and late provider responses cannot commit a cancelled batch', async t => {
  const owner = await login('jobs-cancel');
  const entered = deferred(), release = deferred();
  let calls = 0, signal;
  store.aiJobs.proposer = async (request, options) => {
    calls++; signal = options.signal; charge(options.budget);
    entered.resolve(); await release.promise; return preview(request);
  };
  t.after(async () => { release.resolve(); await store.aiJobs.drain(); });
  const created = await call('/api/instructor/ai/jobs', { method: 'POST', token: owner, data: input });
  assert.equal(created.status, 202);
  const path = `/api/instructor/ai/jobs/${created.payload.data.jobId}`;
  await entered.promise;
  const cancelled = await call(path + '/cancel', { method: 'POST', token: owner });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.payload.data.status, 'cancelled');
  assert.equal(signal.aborted, true);
  assert.equal((await call(path + '/pause', { method: 'POST', token: owner })).payload.data.status, 'cancelled');
  release.resolve(); await store.aiJobs.drain();
  const final = (await call(path, { token: owner })).payload.data;
  assert.equal(final.status, 'cancelled');
  assert.equal(final.completedQuestions, 0);
  assert.equal(final.completedBatches, 0);
  const resumed = await call(path + '/resume', { method: 'POST', token: owner });
  assert.equal(resumed.status, 409);
  assert.equal(resumed.payload.code, 'AI_CANCELLED');
  assert.equal(calls, 1);
  assert.deepEqual((await call('/api/instructor/ai/jobs', { token: owner })).payload.data.jobs, []);
});

test('large HTTP proposals pin saved AI selection and 200 questions survive review, publication and student delivery', async () => {
  const owner = await login('jobs-complete');
  const selection = { aiProvider: 'groq', aiModel: 'openai/gpt-oss-20b' };
  assert.equal((await call('/api/instructor/ai/settings', { method: 'PUT', token: owner, data: selection })).status, 200);
  const requests = [];
  let offset = 0;
  store.aiJobs.proposer = async (request, { budget }) => {
    charge(budget); requests.push(request);
    const result = preview(request, offset, true); offset += request.questionCount; return result;
  };
  const created = await call('/api/instructor/ai/propose', { method: 'POST', token: owner,
    data: { ...input, questionCount: 200, missionCount: 50, aiProvider: 'gemini', aiModel: 'ignored-body-model' },
  });
  assert.equal(created.status, 202);
  assert.deepEqual([created.payload.data.input.aiProvider, created.payload.data.input.aiModel], [selection.aiProvider, selection.aiModel]);
  await store.aiJobs.drain();
  const completed = await call(`/api/instructor/ai/jobs/${created.payload.data.jobId}`, { token: owner });
  assert.equal(completed.status, 200);
  const job = completed.payload.data;
  assert.equal(job.status, 'done');
  assert.equal(job.completedQuestions, 200);
  assert.equal(job.completedBatches, 10);
  assert.equal(requests.length, 10);
  assert.ok(requests.every(request => request.aiProvider === selection.aiProvider && request.aiModel === selection.aiModel));
  const savedReview = { input: job.input, proposal: job.proposal, selected: [], job: { id: job.jobId, complete: true } };
  assert.ok(Buffer.byteLength(JSON.stringify(savedReview)) > 1_000_000);
  assert.equal((await call('/api/instructor/ai/proposal', { method: 'PUT', token: owner, data: savedReview })).status, 200);
  assert.equal((await call('/api/instructor/ai/proposal', { token: owner })).payload.data.proposal.design.missions.length, 50);
  const approval = { ...job.input, missions: job.proposal.design.missions, reviewJobId: job.jobId };
  assert.ok(Buffer.byteLength(JSON.stringify(approval)) > 1_000_000);
  const draft = await call('/api/instructor/ai/approved-draft', { method: 'POST', token: owner, data: approval });
  assert.equal(draft.status, 201, JSON.stringify(draft.payload));
  assert.equal((await call('/api/instructor/ai/proposal', { token: owner })).payload.data, null);
  assert.deepEqual((await call('/api/instructor/ai/jobs', { token: owner })).payload.data.jobs, []);
  assert.equal((await call('/api/instructor/ai/approved-draft', { method: 'POST', token: owner, data: approval })).status, 409);
  const { examId, version } = draft.payload.data;
  const assessment = `/api/instructor/assessments/${examId}/${version}`;
  assert.deepEqual((await call(assessment + '/validate', { method: 'POST', token: owner })).payload.data.errors, []);
  assert.equal((await call(assessment + '/publish', { method: 'POST', token: owner, data: { approved: true } })).status, 200);
  const runResult = await call('/api/instructor/runs', { method: 'POST', token: owner, data: {
    examId, version, pin: '4242', name: 'Large generated assessment', feedbackMode: 'graded',
    opensAt: new Date(Date.now() - 1000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString(),
    roster: [{ candidateId: 'LEARNER-1', displayName: 'Fictional learner', section: 'Boundary' }],
  } });
  assert.equal(runResult.status, 201, JSON.stringify(runResult.payload));
  const joined = await call('/api/auth/student/join', { method: 'POST', data: { runId: runResult.payload.data.id, candidateId: 'LEARNER-1', pin: '4242' } });
  assert.equal(joined.status, 200);
  assert.equal(joined.payload.data.session.order.length, 50);
  const activities = [];
  for (const mission of joined.payload.data.session.order) {
    const delivery = await call(`/api/me/missions/${mission.id}`, { token: joined.payload.data.token });
    assert.equal(delivery.status, 200);
    assert.doesNotMatch(JSON.stringify(delivery.payload.data), /"(?:criteria|referenceCode|answer|evidenceQuote)"/);
    activities.push(...delivery.payload.data.activities);
  }
  assert.equal(activities.length, 200);
  assert.equal(new Set(activities.map(activity => activity.id)).size, 200);
});


test('HTTP generation rejects requests above 200 before invoking the provider', async () => {
  const owner = await login('jobs-limit');
  store.aiJobs.proposer = async () => assert.fail('invalid generation must not call the provider');
  for (const path of ['/api/instructor/ai/jobs', '/api/instructor/ai/propose']) {
    const result = await call(path, { method: 'POST', token: owner,
      data: { ...input, questionCount: 201, missionCount: 51 },
    });
    assert.equal(result.status, 400);
    assert.equal(result.payload.code, 'INVALID_AI_REQUEST');
  }
  assert.deepEqual((await call('/api/instructor/ai/jobs', { token: owner })).payload.data.jobs, []);
});
