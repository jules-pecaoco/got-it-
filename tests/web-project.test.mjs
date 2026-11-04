import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { webTemplate } from '../src/web-template.mjs';
import { validateProject, validateWebRule } from '../public/web-project.js';
import { validatePackage } from '../src/engine.mjs';
import { Store } from '../src/store.mjs';
import { evaluateWeb } from '../src/web-grading.mts';

test('web packages validate files and private checks without leaking the rubric', () => {
  const value = webTemplate('web-test');
  assert.deepEqual(validatePackage(value.public, value.private), []);
  assert.doesNotMatch(JSON.stringify(value.public), /"contains"|quality|privateTests/);
  assert.ok(validateProject({ files: { '../index.php': '<?php' } }).length);
  assert.ok(validateProject({ files: { 'index.php': '<?php', 'x.php/../y.php': '' } }).length);
  assert.ok(validateProject({ files: { 'index.php': 'a'.repeat(50001) } }).length);
  const rule = structuredClone(value.private.rules['php-rubric']); rule.criteria[0].answer.path = '//other-host/';
  assert.ok(validateWebRule(value.public.missions[0].activities[0].publicConfig, rule).length);
});

test('remote web grading keeps expected outputs in the API and requires manual rubric review', async () => {
  const calls = [];
  const worker = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks)); calls.push({ path: req.url, input });
    assert.equal(req.headers.authorization, `Bearer ${'s'.repeat(32)}`);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/web/open') return res.end(JSON.stringify({ id: 'environment' }));
    if (req.url === '/web/close') return res.end('{}');
    res.end(JSON.stringify({ status: 200, headers: {}, body: Buffer.from('<h1>Tasks</h1><p>Prepare</p>').toString('base64') }));
  });
  await new Promise(resolve => worker.listen(0, '127.0.0.1', resolve));
  process.env.EXECUTION_ORIGIN = `http://127.0.0.1:${worker.address().port}`; process.env.EXECUTION_SECRET = 's'.repeat(32);
  const store = new Store();
  try {
    const value = webTemplate('web-grade');
    const activity = value.public.missions[0].activities[0];
    const project = { files: activity.publicConfig.files, database: Buffer.from('student state').toString('base64') };
    const evaluation = await evaluateWeb(activity.publicConfig, value.private.rules['php-rubric'], { value: project });
    assert.equal(evaluation.awarded.reduce((sum, item) => sum + item.points, 0), 70);
    assert.equal(calls[0].input.project.database, undefined);
    assert.ok(calls.every(call => !JSON.stringify(call.input).includes('"contains"')));
    store.importDraft(value.public, value.private); store.publish(value.public.examId, 1);
    const run = store.createRun({ examId: value.public.examId, version: 1, pin: '4242', opensAt: new Date(Date.now() - 1000).toISOString(), closesAt: new Date(Date.now() + 600000).toISOString(), roster: [{ candidateId: 'A', displayName: 'Alex', section: 'S' }] });
    const id = store.join({ runId: run.id, candidateId: 'A', pin: '4242' }).session.id;
    await store.submitAnswer(id, 'php-app', { value: project }, 'web-submission-0001');
    store.finalize(id);
    assert.equal(store.sessionView(id).pendingReview, true);
    assert.throws(() => store.publishStudentResults(run.id, 'A'), e => e.code === 'REVIEW_PENDING');
    assert.equal(store.publishCompletedResults(run.id).publishedCount, 0);
    store.overrideQuestionScore(run.id, 'A', 'php-app', { points: 90, reason: 'Rubric reviewed: functional and readable.' });
    store.publishStudentResults(run.id, 'A'); assert.equal(store.sessionView(id).score, 90);
  } finally { store.close(); delete process.env.EXECUTION_ORIGIN; delete process.env.EXECUTION_SECRET; await new Promise(resolve => worker.close(resolve)); }
});
