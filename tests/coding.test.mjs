import test from 'node:test';
import assert from 'node:assert/strict';
import { outputMatches, validateCodeConfig } from '../public/code-task.js';
import { buildGeneratedPackage, buildApprovedPackage, proposeExam } from '../src/ai.mjs';
import { validatePackage, evaluate } from '../src/engine.mjs';
import { dockerArguments, executeCode, evaluateCode, previewCode, cleanupJobContainers } from '../src/code-runner.mjs';
import { Store } from '../src/store.mjs';
import { answerText } from '../public/answer-key.js';

const source = { filename: 'lesson.md', content: 'Read two integers from input and print their sum. A solution must use both inputs and handle zero and negative numbers. Test the solution with different inputs.' };
const solution = { python: 'a, b = map(int, input().split())\nprint(a + b)', javascript: "const fs = require('node:fs'); const [a,b] = fs.readFileSync(0,'utf8').trim().split(/\\s+/).map(Number); console.log(a+b);",
  php: '<?php [$a,$b] = array_map("intval", explode(" ", trim(stream_get_contents(STDIN)))); echo $a+$b; ', sql: 'SELECT a + b AS total FROM numbers;' };
const question = language => ({ type: 'code_writing', language, prompt: 'Read two integers and print their sum. Handle zero and negative values.',
  starterCode: language === 'sql' ? '-- TODO: select the sum from numbers' : language === 'php' ? '<?php\n// TODO: read input and print the sum' : '// TODO: read input and print the sum',
  samples: [{ input: '2 3', output: '5' }], comparison: { mode: 'whitespace' }, referenceCode: solution[language],
  tests: [{ input: '2 3', output: '5' }, { input: '-4 0', output: '-4' }, { input: '10 7', output: '17' }],
  evidenceQuote: 'Read two integers from input and print their sum.', location: 'Source' });
const request = { title: 'Sum coding', subject: 'Programming', kind: 'ctf', questionMode: 'coding', programmingLanguage: 'python', durationMinutes: 30, missionCount: 1, questionCount: 1, source };
const draft = (language = 'python', kind = 'ctf') => buildGeneratedPackage({ ...request, kind, programmingLanguage: language }, { missions: [{ title: 'Compute', activities: [question(language)] }] });
const sumRunner = async (_language, code, input) => ({ output: code === 'hardcoded' ? '5' : String(input.split(' ').map(Number).reduce((a, b) => a + b, 0)), error: '', succeeded: code !== 'syntax error' });

test('finishing while code is queued grades its saved draft only once', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const store = new Store(':memory:', { codeRunner: async (...args) => { await gate; return sumRunner(...args); } });
  try {
    const value = draft(); store.importDraft(value.public, value.private); store.addSource(value.public.examId, 1, source); store.publish(value.public.examId, 1);
    const run = store.createRun({ examId: value.public.examId, version: 1, pin: '4242', opensAt: new Date(Date.now() - 1000).toISOString(), closesAt: new Date(Date.now() + 600000).toISOString(), roster: [{ candidateId: 'A', displayName: 'Alex', section: 'S' }] });
    const id = store.join({ runId: run.id, candidateId: 'A', pin: '4242' }).session.id;
    const response = { value: solution.python }; store.saveDraft(id, 'm1-q1', response);
    const receipt = store.queueCode(id, 'm1-q1', 'submit', response, 'queued-draft-check-001');
    store.finalize(id); assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM coding_jobs').get().n, 1);
    release(); const until = Date.now() + 3000;
    while (store.codingQueue.view(id, receipt.jobId).status !== 'done' && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n, 1);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM penalty_events').get().n, 0);
  } finally { release(); store.close(); }
});

test('restart cleanup targets only containers labelled with the recovered job', async () => {
  const job = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', calls = [];
  assert.ok(dockerArguments('python', 'example', job).includes(`gotit.job=${job}`));
  await cleanupJobContainers(job, async args => { calls.push(args); return { exitCode: 0, stdout: args[0] === 'ps' ? 'abcdef123456\n' : '' }; });
  assert.deepEqual(calls, [['ps', '-aq', '--filter', `label=gotit.job=${job}`], ['rm', '--force', 'abcdef123456']]);
  await assert.rejects(() => cleanupJobContainers(job, async () => ({ exitCode: 1, stdout: '' })), e => e.code === 'CODE_RUNNER_UNAVAILABLE');
});

test('coding output comparisons preserve text and order, support whitespace and bounded numeric tolerance', () => {
  assert.equal(outputMatches('Hello\r\n', 'Hello', { mode: 'exact' }), true);
  assert.equal(outputMatches('Hello  world', 'Hello world', { mode: 'exact' }), false);
  assert.equal(outputMatches('Hello\n world ', 'Hello world', { mode: 'whitespace' }), true);
  assert.equal(outputMatches('hello', 'Hello', { mode: 'whitespace' }), false);
  assert.equal(outputMatches('2 1', '1 2', { mode: 'whitespace' }), false);
  const numeric = { mode: 'numeric', absoluteTolerance: 0.01, relativeTolerance: 0.001 };
  assert.equal(outputMatches('total 3.14159', 'total 3.14', numeric), true);
  assert.equal(outputMatches('total 3.5', 'total 3.14', numeric), false);
  assert.equal(outputMatches('NaN', '3.14', numeric), false);
  assert.equal(outputMatches('Infinity', '3.14', numeric), false);
  assert.equal(outputMatches('', '0', numeric), false);
});

test('four languages generate valid coding activities and CTFs with samples but no private test or solution leakage', () => {
  for (const language of Object.keys(solution)) for (const kind of ['activity', 'ctf']) {
    const result = draft(language, kind);
    assert.deepEqual(validatePackage(result.public, result.private), []);
    const activity = result.public.missions[0].activities[0];
    assert.deepEqual(activity.publicConfig.samples, question(language).samples);
    assert.equal(activity.publicConfig.language, language);
    assert.equal(result.public.kind, kind);
    assert.doesNotMatch(JSON.stringify(result.public), /referenceCode|"tests"|-4 0|10 7/);
    const rule = result.private.rules[activity.gradingRuleId];
    assert.equal(rule.referenceCode, solution[language]);
    assert.equal(rule.criteria.reduce((sum, criterion) => sum + criterion.points, 0), 10);
    assert.match(answerText(activity, rule), /Reference solution:[\s\S]*Expected output/);
    assert.throws(() => evaluate(activity, rule, { value: solution[language], output: '5', passed: true }), error => error.code === 'CODE_EXECUTION_REQUIRED');
  }
});

test('coding validation rejects missing examples, unsupported languages, leaked config, bad tolerances and sample-only tests', () => {
  const mutations = [q => { q.samples = []; }, q => { q.samples = [null]; }, q => { q.samples[0].privateInput = 'hidden'; },
    q => { q.comparison.tests = []; }, q => { q.language = 'ruby'; }, q => { q.referenceCode = ''; },
    q => { q.comparison = { mode: 'numeric', absoluteTolerance: -1, relativeTolerance: 0 }; },
    q => { q.tests = [q.tests[0], q.tests[0]]; }, q => { q.samples[0].output = 'wrong'; }];
  for (const mutate of mutations) {
    const q = question('python'); mutate(q);
    assert.throws(() => buildApprovedPackage({ ...request, missions: [{ title: 'Compute', activities: [q] }] }), error => error.code === 'AI_INVALID_DRAFT');
  }
  const result = draft(), activity = result.public.missions[0].activities[0];
  activity.publicConfig.referenceCode = 'leaked';
  assert.match(validatePackage(result.public, result.private).join(' '), /unsupported field/);
  delete activity.publicConfig.referenceCode;
  activity.tests = question('python').tests;
  assert.match(validatePackage(result.public, result.private).join(' '), /coding tests belong in the private/);
  assert.ok(validateCodeConfig({ ...question('python'), language: 'bash' }).length);
});

test('AI receives coding instructions, expected output format and selected language; wrong modes cannot approve', async () => {
  let prompt;
  const proposed = await proposeExam(request, { apiKey: 'test-key', fetcher: async (_url, options) => {
    prompt = JSON.parse(options.body).contents[0].parts[0].text;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ missions: [{ title: 'Compute', activities: [question('python')] }] }) }] } }] }) };
  } });
  assert.equal(proposed.missions[0].questions[0].ready, true);
  assert.match(prompt, /Question mode: coding/); assert.match(prompt, /Programming language: python/);
  assert.match(prompt, /samples.*input,output/); assert.doesNotMatch(prompt, /do not ask for code-writing/);
  assert.throws(() => buildGeneratedPackage(request, { missions: [{ title: 'Wrong', activities: [{ ...question('python'), type: 'text_entry', answer: ['5'] }] }] }), /must require a code-writing/);
  assert.throws(() => buildGeneratedPackage(request, { missions: [{ title: 'Wrong', activities: [question('php')] }] }), /must use python/);
});

test('private tests catch hardcoded samples, award partial credit, ignore claimed output, and preview only public cases', async () => {
  const result = draft(), activity = result.public.missions[0].activities[0], rule = result.private.rules[activity.gradingRuleId];
  assert.equal((await evaluateCode(activity, rule, { value: 'solution', output: 'wrong' }, sumRunner)).result, 'correct');
  const hardcoded = await evaluateCode(activity, rule, { value: 'hardcoded', output: 'correct' }, sumRunner);
  assert.equal(hardcoded.result, 'partially_correct'); assert.equal(hardcoded.awarded.length, 1);
  assert.equal((await evaluateCode(activity, rule, { value: 'syntax error' }, sumRunner)).result, 'incorrect');
  let calls = 0;
  const preview = await previewCode(activity.publicConfig, 'solution', async (...args) => { calls++; return sumRunner(...args); });
  assert.equal(calls, 1); assert.equal(preview.samples[0].matches, true);
  assert.doesNotMatch(JSON.stringify(preview), /-4 0|10 7|referenceCode/);
});

test('sandbox uses no network, host mounts or privileged access, and cleans up timeouts and missing runtimes', async () => {
  for (const language of Object.keys(solution)) {
    const args = dockerArguments(language, 'test-container');
    for (const option of ['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=65534:65534', '--memory=128m', '--pull=never']) assert.ok(args.includes(option));
    assert.equal(args.some(arg => ['--privileged', '-v', '--volume', '--mount'].includes(arg)), false);
  }
  const calls = [];
  const processRunner = async (args, input) => { calls.push({ args, input }); return { stdout: '5', stderr: '', exitCode: 0, stopped: false }; };
  assert.equal((await executeCode('python', 'print(5)', '', { processRunner })).output, '5');
  assert.deepEqual(JSON.parse(calls[0].input), { code: 'print(5)', input: '' });
  assert.deepEqual(calls[1].args.slice(0, 2), ['rm', '--force']);
  let removed = false;
  await assert.rejects(() => executeCode('python', 'print(5)', '', { processRunner: async args => {
    if (args[0] === 'rm') { removed = true; return {}; }
    return { stdout: '', stderr: 'daemon offline', exitCode: 1, stopped: false };
  } }), error => error.code === 'CODE_RUNNER_UNAVAILABLE');
  assert.equal(removed, true);
  const timeout = await executeCode('python', 'while True: pass', '', { processRunner: async args => args[0] === 'rm' ? {} : { stdout: '', stderr: '', exitCode: null, stopped: true } });
  assert.equal(timeout.succeeded, false); assert.match(timeout.error, /limit/);
});

function setupStore(feedbackMode = 'practice', runner = sumRunner) {
  const store = new Store(':memory:', { codeRunner: runner }), result = draft();
  store.importDraft(result.public, result.private);
  store.addSource(result.public.examId, 1, source); store.publish(result.public.examId, 1);
  const run = store.createRun({ examId: result.public.examId, version: 1, pin: '4242', feedbackMode,
    opensAt: new Date(Date.now() - 1000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString(),
    roster: [{ candidateId: 'CODER', displayName: 'Coder', section: 'A' }] });
  const joined = store.join({ runId: run.id, pin: '4242', candidateId: 'CODER' });
  return { store, id: joined.session.id, activityId: result.public.missions[0].activities[0].id };
}

test('queued coding accepts on-time work after expiry, hides pending grades, and grades once', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let executions = 0;
  const { store, id, activityId } = setupStore('graded', async (...args) => { executions++; await gate; return sumRunner(...args); });
  try {
    const accepted = store.queueCode(id, activityId, 'submit', { value: 'solution' }, 'queued-request-00001');
    assert.equal(store.sessionView(id).pendingCodingCount, 1);
    assert.equal(store.queueCode(id, activityId, 'submit', { value: 'solution' }, 'queued-request-00001').jobId, accepted.jobId);
    assert.throws(() => store.queueCode(id, activityId, 'submit', { value: 'different' }, 'queued-request-00002'), e => e.code === 'CODING_JOB_PENDING');
    // Deadline passes while the worker is executing. The receipt remains valid.
    await new Promise(resolve => setTimeout(resolve, 10));
    store.db.prepare("UPDATE sessions SET deadline_at=?,status='submitted' WHERE id=?").run(new Date().toISOString(), id);
    const context = store.context(id);
    assert.throws(() => store.publishStudentResults(context.run.id, context.session.candidate_id), e => e.code === 'CODING_JOB_PENDING');
    release();
    const deadline = Date.now() + 3000;
    while (store.codingQueue.stats().pending && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    const completed = store.codingQueue.view(id, accepted.jobId);
    assert.equal(completed.status, 'done'); assert.equal(completed.result.saved, true);
    assert.equal(completed.result.score, undefined); assert.equal(executions, 3); assert.equal(store.score(id), 10);
    assert.equal(store.sessionView(id).pendingCodingCount, 0);
    assert.equal(store.queueCode(id, activityId, 'submit', { value: 'solution' }, 'queued-request-00001').jobId, accepted.jobId);
    assert.equal(executions, 3);
  } finally { release(); store.close(); }
});

test('queued infrastructure failures do not consume attempts and replay after a committed grade is idempotent', async () => {
  const { store, id, activityId } = setupStore('practice', async () => { throw Object.assign(new Error('offline'), { code: 'CODE_RUNNER_UNAVAILABLE' }); });
  const wait = async () => {
    const until = Date.now() + 2000;
    while (store.codingQueue.stats().pending && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(store.codingQueue.stats().pending, 0);
  };
  try {
    const job = store.queueCode(id, activityId, 'submit', { value: 'solution' }, 'queue-recovery-0001');
    await wait();
    assert.equal(store.codingQueue.view(id, job.jobId).status, 'failed');
    assert.equal(store.sessionView(id).submittedCount, 0);
    let executions = 0;
    store.codeRunner = async (...args) => { executions++; return sumRunner(...args); };
    store.queueCode(id, activityId, 'submit', { value: 'solution' }, 'queue-recovery-0001');
    await wait(); assert.equal(store.score(id), 10); assert.equal(executions, 3);
    // Simulate a crash after the score transaction committed but before the job
    // completion marker was written. Replaying must not execute or charge again.
    store.db.prepare("UPDATE coding_jobs SET status='queued',result_json=NULL WHERE id=?").run(job.jobId);
    store.codingQueue.pump(); await wait();
    assert.equal(executions, 3); assert.equal(store.score(id), 10);
    assert.equal(store.sessionView(id).submittedCount, 1);
  } finally { store.close(); }
});

test('coding submissions persist partial credit, preserve idempotency and protect graded feedback', async () => {
  for (const mode of ['practice', 'graded']) {
    let executions = 0;
    const { store, id, activityId } = setupStore(mode, async (...args) => { executions++; return sumRunner(...args); });
    try {
      const preview = await store.previewCode(id, activityId, { value: 'solution' });
      assert.equal(preview.samples[0].matches, true); assert.equal(store.sessionView(id).submittedCount, 0);
      store.saveDraft(id, activityId, { value: 'hardcoded' });
      const submitted = await store.submitAnswer(id, activityId, { value: 'hardcoded', output: '17' }, 'coding-request-0001');
      assert.equal(submitted.attemptNumber, 1);
      assert.equal(executions, 4);
      if (mode === 'graded') { assert.equal(submitted.result, undefined); assert.equal(submitted.score, undefined); }
      else assert.equal(submitted.result, 'partially_correct');
      const duplicate = await store.submitAnswer(id, activityId, { value: 'hardcoded', output: '17' }, 'coding-request-0001');
      assert.equal(duplicate.duplicate, true); assert.equal(executions, 4);
      const finished = await store.submitAnswer(id, activityId, { value: 'solution' }, 'coding-request-0002');
      assert.equal(finished.attemptNumber, 2); assert.equal(store.score(id), 9);
      assert.doesNotMatch(JSON.stringify(store.missionView(id, 'mission-1')), /referenceCode|"criteria"|-4 0|10 7/);
    } finally { store.close(); }
  }
});

test('runner outages and late execution cannot charge or record a coding attempt', async () => {
  const { store, id, activityId } = setupStore('practice', async () => { throw Object.assign(new Error('offline'), { code: 'CODE_RUNNER_UNAVAILABLE' }); });
  try {
    await assert.rejects(() => store.submitAnswer(id, activityId, { value: 'solution' }), error => error.code === 'CODE_RUNNER_UNAVAILABLE');
    assert.equal(store.sessionView(id).submittedCount, 0);
    store.codeRunner = async (...args) => {
      store.db.prepare('UPDATE sessions SET deadline_at=? WHERE id=?').run(new Date(Date.now() - 1).toISOString(), id);
      return sumRunner(...args);
    };
    await assert.rejects(() => store.submitAnswer(id, activityId, { value: 'solution' }), error => error.code === 'SESSION_CLOSED');
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM submissions WHERE session_id=?').get(id).count, 0);
  } finally { store.close(); }
});
