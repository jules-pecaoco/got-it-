import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { outputMatches, validateCodeConfig, defaultStarterCode } from '../public/code-task.js';
import { buildGeneratedPackage, buildApprovedPackage, proposeExam } from '../src/ai.mjs';
import { validatePackage, evaluate } from '../src/engine.mjs';
import { codingStatus, dockerArguments, executeCode, evaluateCode, previewCode, cleanupJobContainers, reconcileCodeContainers, startCodeReconciliation, runtimeImages, runtimeCommands } from '../src/code-runner.mjs';
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

test('coding status distinguishes a missing CLI, stopped Docker, wrong mode and missing images', async () => {
  const missing = await codingStatus(async () => { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); });
  assert.equal(missing.docker, 'missing');
  assert.equal((await codingStatus(async () => ({ exitCode: 1, stdout: '' }))).docker, 'unreachable');
  assert.equal((await codingStatus(async () => ({ exitCode: 0, stdout: '\n', stderr: 'error during connect: engine pipe is missing' }))).docker, 'unreachable');
  assert.equal((await codingStatus(async () => ({ exitCode: 0, stdout: 'windows' }))).docker, 'wrong_mode');
  const partial = await codingStatus(async args => args[0] === 'info'
    ? { exitCode: 0, stdout: 'linux' }
    : { exitCode: args[2].includes('/php@') ? 1 : 0, stdout: '' });
  assert.equal(partial.docker, 'ready');
  assert.equal(partial.available, false);
  assert.deepEqual(partial.languages, ['javascript', 'python', 'sql']);
  assert.match(partial.message, /php/);
});

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

test('blank code drafts stay unanswered at finish and expiry', () => {
  const store = new Store(':memory:');
  try {
    const { public: pub, private: grading } = draft('python', 'quiz');
    store.importDraft(pub, grading);
    store.addSource(pub.examId, 1, source);
    store.publish(pub.examId, 1);
    const run = store.createRun({ examId: pub.examId, version: 1, pin: '4242',
      opensAt: new Date(Date.now() - 1000).toISOString(), closesAt: new Date(Date.now() + 600000).toISOString(),
      roster: [{ candidateId: 'A', displayName: 'Alex', section: 'S' }, { candidateId: 'B', displayName: 'Blair', section: 'S' }] });
    const join = candidateId => store.join({ runId: run.id, candidateId, pin: '4242' }).session.id;
    const finished = join('A');
    const blank = store.saveDraft(finished, 'm1-q1', { value: '' });
    assert.equal(blank.gradable, false);
    assert.throws(() => store.saveDraft(finished, 'm1-q1', { value: 'x'.repeat(16001) }), { code: 'INVALID_CODE' });
    assert.throws(() => store.submit(finished, 'm1-q1', { value: '' }), { code: 'INVALID_CODE' });
    const result = store.finalize(finished);
    assert.equal(result.status, 'submitted');
    assert.equal(result.submittedCount, 0);
    assert.deepEqual(result.savedAnswers, []);

    const expired = join('B');
    store.saveDraft(expired, 'm1-q1', { value: ' \n ' });
    store.db.prepare('UPDATE sessions SET deadline_at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), expired);
    store.settleExpired();
    assert.equal(store.sessionView(expired).status, 'expired');
    assert.equal(store.sessionView(expired).submittedCount, 0);
  } finally { store.close(); }
});

test('restart cleanup targets only containers labelled with the recovered job', async () => {
  const job = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', calls = [];
  assert.ok(dockerArguments('python', 'example', job).includes(`gotit.job=${job}`));
  await cleanupJobContainers(job, async args => { calls.push(args); return { exitCode: 0, stdout: args[0] === 'ps' ? 'abcdef123456\n' : '' }; });
  assert.deepEqual(calls, [['ps', '-aq', '--filter', `label=gotit.job=${job}`], ['rm', '--force', 'abcdef123456']]);
  await assert.rejects(() => cleanupJobContainers(job, async () => ({ exitCode: 1, stdout: '' })), e => e.code === 'CODE_RUNNER_UNAVAILABLE');
});

test('every console runtime owns a PID 1 deadline before reading input or running student code', () => {
  for (const language of Object.keys(solution)) {
    const args = dockerArguments(language, 'test-container');
    const command = args.slice(args.indexOf(runtimeImages[language]) + 1);
    assert.deepEqual(command.slice(-runtimeCommands[language].length), runtimeCommands[language]);
    assert.ok(command.length > runtimeCommands[language].length);
    assert.ok(args.includes('gotit.code=true'));
    assert.ok(args.some(arg => /^gotit.owner=[a-f0-9]{24}$/.test(arg)));
    const expires = Number(args.find(arg => arg.startsWith('gotit.expires=')).split('=')[1]);
    assert.ok(expires > Date.now() && expires <= Date.now() + 5000);
    if (language === 'php') {
      assert.match(command[2], /hrtime\(true\).*proc_open.*STDIN,STDOUT,STDERR/);
      assert.match(command[2], /proc_terminate\(\$p,9\);proc_close\(\$p\);exit\(137\)/);
    } else if (language !== 'javascript') {
      assert.match(command[2], /p\.wait\(timeout=5\)/);
      assert.match(command[2], /os\._exit/);
    }
  }
  const args = dockerArguments('javascript', 'test-container');
  const supervisor = args[args.indexOf(runtimeImages.javascript) + 3];
  const exits = [], listeners = {};
  let deadline;
  runInNewContext(supervisor, {
    require: () => ({ spawn: (command, childArgs, options) => {
      assert.equal(command, 'node'); assert.deepEqual(Array.from(childArgs), runtimeCommands.javascript.slice(1));
      assert.equal(options.stdio, 'inherit');
      return { once: (event, listener) => { listeners[event] = listener; } };
    } }),
    process: { argv: ['node', ...runtimeCommands.javascript], exit: code => exits.push(code) },
    setTimeout: (callback, ms) => { assert.equal(ms, 5000); deadline = callback; }, clearTimeout: () => {}
  });
  // No child exit and no application/CLI callback is needed to expire PID 1.
  deadline();
  assert.deepEqual(exits, [137]);
  listeners.exit(0); assert.equal(exits.at(-1), 0);
});

test('console reconciliation removes only expired containers owned by this execution installation', async () => {
  const now = 1800000000000, calls = [];
  const expired = 'got-it-code-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const live = 'got-it-code-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  await reconcileCodeContainers(async args => {
    calls.push(args);
    return { exitCode: 0, stdout: args[0] === 'ps' ? `${expired}|${now - 1}\n${live}|${now + 5000}\n` : '' };
  }, now);
  assert.deepEqual(calls[0].slice(0, 5), ['ps', '-a', '--filter', 'label=gotit.code=true', '--filter']);
  assert.match(calls[0][5], /^label=gotit.owner=[a-f0-9]{24}$/);
  assert.deepEqual(calls.slice(1), [['rm', '--force', expired]]);
  for (const stdout of [`unrelated|${now - 1}`, `${expired}|invalid`]) {
    const unsafeCalls = [];
    await assert.rejects(() => reconcileCodeContainers(async args => {
      unsafeCalls.push(args); return { exitCode: 0, stdout };
    }, now), { code: 'CODE_RUNNER_UNAVAILABLE' });
    assert.equal(unsafeCalls.length, 1);
  }
  await assert.rejects(() => reconcileCodeContainers(async () => ({ exitCode: 1, stdout: '' }), now), { code: 'CODE_RUNNER_UNAVAILABLE' });
  await assert.rejects(() => reconcileCodeContainers(async args => ({ exitCode: args[0] === 'ps' ? 0 : 1, stdout: `${expired}|${now - 1}` }), now), { code: 'CODE_RUNNER_UNAVAILABLE' });
});

test('console reconciliation starts immediately, repeats without overlap and drains on stop', async () => {
  const releases = [], calls = [];
  let activeSweeps = 0, maxActive = 0;
  const reconciler = startCodeReconciliation({ intervalMs: 5, processRunner: async (args, input, timeout) => {
    calls.push(args); assert.equal(input, ''); assert.equal(timeout, 3000);
    activeSweeps++; maxActive = Math.max(maxActive, activeSweeps);
    await new Promise(resolve => releases.push(resolve));
    activeSweeps--;
    return { exitCode: 0, stdout: '' };
  } });
  try {
    assert.equal(calls.length, 1);
    assert.equal(reconciler.stats().running, true);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(calls.length, 1);
    releases.shift()();
    const until = Date.now() + 1000;
    while (calls.length < 2 && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(calls.length, 2);
    assert.equal(maxActive, 1);
    let drained = false;
    const stopping = reconciler.stop().then(() => { drained = true; });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(drained, false);
    assert.equal(calls.length, 2);
    releases.shift()();
    await stopping;
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls.length, 2);
    assert.deepEqual(reconciler.stats(), { stopped: true, running: false, attempts: 2, failures: 0, lastError: null });
  } finally {
    for (const release of releases) release();
    await reconciler.stop();
  }
});

test('background console reconciliation tolerates offline Docker and retries without blocking the app', async () => {
  let calls = 0;
  const reconciler = startCodeReconciliation({ intervalMs: 5, processRunner: async () => {
    if (++calls === 1) throw Object.assign(new Error('Docker missing'), { code: 'ENOENT' });
    return { exitCode: 0, stdout: '' };
  } });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reconciler.stats().failures, 1);
    assert.equal(reconciler.stats().lastError, 'ENOENT');
    const until = Date.now() + 1000;
    while (calls < 2 && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(calls >= 2);
    await reconciler.stop();
    assert.equal(reconciler.stats().lastError, null);
  } finally { await reconciler.stop(); }
  for (const intervalMs of [0, -1, NaN, 0.5, 2147483648])
    assert.throws(() => startCodeReconciliation({ intervalMs }), /configuration/);
});

test('startup reconciliation tolerates an expired container disappearing before removal', async () => {
  const expired = 'got-it-code-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', calls = [];
  const reconciler = startCodeReconciliation({ processRunner: async args => {
    calls.push(args);
    if (args[0] === 'ps') return { exitCode: 0, stdout: `${expired}|${Date.now() - 1000}` };
    return { exitCode: 1, stdout: '', stderr: `Error response from daemon: No such container: ${expired}` };
  } });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls[0][0], 'ps');
    assert.ok(calls[0].includes('label=gotit.code=true'));
    assert.ok(calls[0].some(arg => /^label=gotit.owner=[a-f0-9]{24}$/.test(arg)));
    assert.deepEqual(calls.slice(1), [['rm', '--force', expired]]);
  } finally { await reconciler.stop(); }
});

test('idle console reconciliation timer does not keep the process alive', () => {
  const moduleUrl = new URL('../src/code-runner.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import { startCodeReconciliation } from ${JSON.stringify(moduleUrl)}; startCodeReconciliation({ processRunner: async () => ({exitCode:0,stdout:''}) });`], { timeout: 2000, windowsHide: true, encoding: 'utf8' });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test('console recovery failure prevents execution and retains the two-run concurrency bound', async () => {
  const failedCalls = [];
  await assert.rejects(() => executeCode('python', 'print(5)', '', { processRunner: async args => {
    failedCalls.push(args[0]); return { exitCode: 1, stdout: '' };
  } }), { code: 'CODE_RUNNER_UNAVAILABLE' });
  assert.deepEqual(failedCalls, ['ps', 'rm']);
  let release;
  const gate = new Promise(resolve => { release = resolve; }), calls = [];
  const processRunner = async args => {
    calls.push(args[0]);
    if (args[0] === 'run') await gate;
    return { exitCode: 0, stdout: args[0] === 'run' ? '5' : '', stderr: '', stopped: false };
  };
  const first = executeCode('python', 'print(5)', '', { processRunner });
  const second = executeCode('python', 'print(5)', '', { processRunner });
  try {
    await assert.rejects(() => executeCode('python', 'print(5)', '', { processRunner }), { code: 'CODE_RUNNER_BUSY' });
  } finally { release(); }
  assert.deepEqual((await Promise.all([first, second])).map(result => result.output), ['5', '5']);
  assert.equal(calls.filter(command => command === 'run').length, 2);
  assert.equal(calls.filter(command => command === 'rm').length, 2);
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
    assert.equal(evaluate(activity, rule, { value: solution[language], output: '5', passed: true }).result, 'pending_review');
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
  assert.equal(calls, 1); assert.equal(preview.samples[0].output, '5'); assert.equal(preview.samples[0].matches, undefined); assert.equal(preview.samples[0].expectedOutput, undefined);
  assert.doesNotMatch(JSON.stringify(preview), /-4 0|10 7|referenceCode/);
});

test('sandbox uses no network, host mounts or privileged access, and cleans up timeouts and missing runtimes', async () => {
  for (const language of Object.keys(solution)) {
    const args = dockerArguments(language, 'test-container');
    for (const option of ['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=65534:65534', '--memory=128m', '--pull=never']) assert.ok(args.includes(option));
    assert.equal(args.some(arg => ['--privileged', '-v', '--volume', '--mount'].includes(arg)), false);
  }
  const calls = [];
  const processRunner = async (args, input) => { calls.push({ args, input }); return { stdout: args[0] === 'run' ? '5' : '', stderr: '', exitCode: 0, stopped: false }; };
  assert.equal((await executeCode('python', 'print(5)', '', { processRunner })).output, '5');
  assert.equal(calls[0].args[0], 'ps');
  assert.deepEqual(JSON.parse(calls[1].input), { code: 'print(5)', input: '' });
  assert.deepEqual(calls[2].args.slice(0, 2), ['rm', '--force']);
  let removed = false;
  await assert.rejects(() => executeCode('python', 'print(5)', '', { processRunner: async args => {
    if (args[0] === 'rm') { removed = true; return {}; }
    if (args[0] === 'ps') return { stdout: '', exitCode: 0 };
    return { stdout: '', stderr: 'daemon offline', exitCode: 1, stopped: false };
  } }), error => error.code === 'CODE_RUNNER_UNAVAILABLE');
  assert.equal(removed, true);
  const timeout = await executeCode('python', 'while True: pass', '', { processRunner: async args => args[0] === 'rm' ? {} : { stdout: '', stderr: '', exitCode: args[0] === 'ps' ? 0 : null, stopped: args[0] === 'run' } });
  assert.equal(timeout.succeeded, false); assert.match(timeout.error, /limit/);
  const expired = await executeCode('php', '<?php while(true) {}', '', { processRunner: async args => ({ stdout: '', stderr: '', exitCode: args[0] === 'run' ? 137 : 0, stopped: false }) });
  assert.equal(expired.succeeded, false); assert.match(expired.error, /limit/);
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

test('coding submissions require faculty review without executing student code', async () => {
  for (const mode of ['practice', 'graded']) {
    let executions = 0;
    const { store, id, activityId } = setupStore(mode, async () => { executions++; throw new Error('must never run'); });
    try {
      const response = { value: 'print(5)' };
      const result = await store.submitAnswer(id, activityId, response, 'manual-request-0001');
      assert.equal(result.attemptNumber, 1);
      if (mode === 'practice') assert.equal(result.result, 'pending_review');
      assert.equal(store.hasPendingReview(id), true);
      assert.equal(store.sessionView(id).resultsReleased, false);
      const duplicate = await store.submitAnswer(id, activityId, response, 'manual-request-0001');
      assert.equal(duplicate.duplicate, true);
      const { run, session } = store.context(id);
      store.finalize(id);
      assert.throws(() => store.publishStudentResults(run.id, session.candidate_id), e => e.code === 'REVIEW_PENDING');
      store.overrideQuestionScore(run.id, session.candidate_id, activityId, { points: 8, reason: 'Correct approach, minor error' });
      assert.equal(store.hasPendingReview(id), false);
      store.publishStudentResults(run.id, session.candidate_id);
      assert.equal(store.score(id), 8);
      assert.equal(executions, 0);
    } finally { store.close(); }
  }
});

test('queued coding receipts and final drafts save for manual review without a runtime', async () => {
  const { store, id, activityId } = setupStore('graded', async () => { throw new Error('must never run'); });
  try {
    store.saveDraft(id, activityId, { value: 'print(5)' });
    store.finalize(id);
    const until = Date.now() + 3000;
    while (store.codingQueue.stats().pending && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(store.sessionView(id).submittedCount, 1);
    assert.equal(store.hasPendingReview(id), true);
    assert.equal(store.score(id), 0);
  } finally { store.close(); }
});

test('run code accepts custom input and returns output without comparisons or grading', async () => {
  let calls = 0;
  const { store, id, activityId } = setupStore('practice', async (...args) => { calls++; return sumRunner(...args); });
  try {
    const result = await store.previewCode(id, activityId, { value: 'solution', input: '10 20' });
    assert.equal(result.samples[0].output, '30');
    assert.equal(result.samples[0].matches, undefined);
    assert.equal(result.samples[0].expectedOutput, undefined);
    assert.equal(calls, 1);
    assert.equal(store.sessionView(id).submittedCount, 0);
    assert.equal(store.score(id), 0);
    await assert.rejects(() => store.previewCode(id, activityId, { value: 'solution', input: 123 }), e => e.code === 'INVALID_INPUT');
  } finally { store.close(); }
});

test('generated console starters are minimal and never impose imports or entry-point wrappers', async () => {
  for (const language of ['python','php','javascript','sql']) {
    const item={...question(language),starterCode:language==='python'?'import sys\ndef main():\n    pass\nif __name__ == "__main__": main()':'// framework boilerplate'};
    let prompt;
    const proposed=await proposeExam({...request,programmingLanguage:language},{apiKey:'test-key',fetcher:async(_url,options)=>{
      prompt=JSON.parse(options.body).contents[0].parts[0].text;
      return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({missions:[{title:'Compute',activities:[item]}]})}]}}]})};
    }});
    assert.equal(proposed.design.missions[0].activities[0].starterCode,defaultStarterCode(language));
    assert.equal(proposed.missions[0].questions[0].ready,true);
    assert.match(prompt,/no required function signature or entry-point wrapper/);
    assert.doesNotMatch(proposed.design.missions[0].activities[0].starterCode,/import sys|def main|__name__|framework/);
    const custom={...item,starterCode:'// Faculty-authored starting exercise'};
    const approved=buildApprovedPackage({...request,programmingLanguage:language,missions:[{title:'Compute',activities:[custom]}]});
    assert.equal(approved.public.missions[0].activities[0].publicConfig.starterCode,custom.starterCode);
  }
});
