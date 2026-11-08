import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { webTemplate } from './fixtures/web-template.mjs';
import { validateProject, validateWebRule } from '../public/web-project.js';
import { editableQuestion } from '../public/draft-question.js';
import { hash, validatePackage } from '../src/engine.mjs';
import { Store } from '../src/store.mjs';
import { evaluateWeb } from '../src/web-grading.mts';
import { attemptSettlement } from '../src/attempt-settlement.mjs';
import { executionStatus } from '../src/execution-client.mts';
import { studentApi } from '../src/routes/student.mjs';

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

test('expiry checkpoints each web answer before queueing it even at interactive capacity', async () => {
  const store = new Store(':memory:', { automaticSettlement: false });
  try {
    const { public: exam, private: grading } = webTemplate('web-expiry');
    const activity = exam.missions[0].activities[0];
    store.importDraft(exam, grading);
    store.publish(exam.examId, exam.version);
    const run = store.createRun({ examId: exam.examId, version: exam.version, pin: '4242',
      opensAt: new Date(Date.now() - 1000).toISOString(), closesAt: new Date(Date.now() + 600000).toISOString(),
      roster: [{ candidateId: 'A', displayName: 'Alex', section: 'S' }, { candidateId: 'B', displayName: 'Blair', section: 'S' }] });
    const attempts = ['A', 'B'].map(candidateId => store.join({ runId: run.id, candidateId, pin: '4242' }));
    const ids = attempts.map(attempt => attempt.session.id);
    const database = Buffer.from('latest preview database').toString('base64');
    const settlement = attemptSettlement(store, { snapshot: async id => {
      if (id === ids[0]) throw Object.assign(new Error('offline'), { code: 'WEB_WORKSPACE_ENDED' });
      return database;
    } });
    const response = { value: { files: activity.publicConfig.files } };
    store.codingQueue.capacity = 1;
    store.codingQueue.concurrency = 0;
    store.codingQueue.enqueue(ids[0], activity.id, 'preview', 'interactive-preview', response);
    for (const id of ids) store.saveDraft(id, activity.id, response);
    const previousDatabase = Buffer.from('last checkpoint').toString('base64');
    const previous = store.saveDraft(ids[0], activity.id, { value: { ...response.value, database: previousDatabase } });
    const changedFiles = { ...response.value.files, 'updated.txt': 'new work' };
    const save = await studentApi({
      req: { method: 'PUT', headers: { authorization: `Bearer ${attempts[0].token}`, 'if-match': previous.updatedAt } },
      url: { pathname: `/api/me/activities/${activity.id}/draft` }, store,
      body: async () => ({ value: { files: changedFiles } }), answerLimit: () => 1700000,
      webPreviews: { snapshot: async () => { throw Object.assign(new Error('offline'), { code: 'WEB_RUNTIME_UNAVAILABLE' }); } },
      send: (_res, _requestId, result) => result,
    });
    assert.equal(save.saved, true);
    assert.match(save.warning, /latest database changes could not be saved/);
    const draft = store.missionView(ids[0], exam.missions[0].id).activities[0].lastDraft;
    assert.deepEqual(draft.value, { files: changedFiles, database: previousDatabase });
    store.db.prepare('UPDATE sessions SET deadline_at=?').run(new Date(Date.now() - 1000).toISOString());

    await Promise.all([settlement.settle(ids[0]), settlement.settleExpired(run.id)]);
    const jobs = store.db.prepare("SELECT session_id,payload_json FROM coding_jobs WHERE kind='submit'").all();
    assert.deepEqual(jobs.map(job => job.session_id).sort(), [...ids].sort());
    for (const job of jobs) {
      assert.equal(JSON.parse(job.payload_json).value.database, job.session_id === ids[0] ? previousDatabase : database);
      assert.equal(store.context(job.session_id).session.status, 'expired');
    }
    store.db.prepare("UPDATE coding_jobs SET status='failed' WHERE kind='submit' AND session_id=?").run(ids[0]);
    assert.equal(store.sessionView(ids[0]).failedCodingCount, 1);
    assert.equal(store.results(run.id).rows.find(row => row.sessionId === ids[0]).failedCodingCount, 1);
  } finally { store.close(); }
});

test('remote web grading keeps expected outputs in the API and requires manual rubric review', async () => {
  const calls = [];
  const worker = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${'s'.repeat(32)}`);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/status')
      return res.end(JSON.stringify({ available: false, docker: 'unreachable', languages: [], message: 'Docker is not running.' }));
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks)); calls.push({ path: req.url, input });
    if (req.url === '/web/open') return res.end(JSON.stringify({ id: 'environment' }));
    if (req.url === '/web/close') return res.end('{}');
    res.end(JSON.stringify({ status: 200, headers: {}, body: Buffer.from('<h1>Tasks</h1><p>Prepare</p>').toString('base64') }));
  });
  await new Promise(resolve => worker.listen(0, '127.0.0.1', resolve));
  process.env.EXECUTION_ORIGIN = `http://127.0.0.1:${worker.address().port}`; process.env.EXECUTION_SECRET = 's'.repeat(32);
  const store = new Store();
  try {
    const status = await executionStatus(true)();
    assert.equal(status.worker, 'ready');
    assert.equal(status.docker, 'unreachable');
    assert.equal(status.webPreviewConfigured, true);
    const value = webTemplate('web-grade');
    const activity = value.public.missions[0].activities[0];
    activity.retryPolicy = { maxRetries: 1, pointPenalty: 0, timePenaltySeconds: 0 };
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
    store.recoverStudent(run.id, 'A', { minutes: 2, reason: 'Allow a corrected project.' }, 'reopen');
    store.codingQueue.concurrency = 0;
    const failed = store.queueCode(id, activity.id, 'submit', { value: project }, 'failed-web-job-0001');
    store.db.prepare("UPDATE coding_jobs SET status='failed', error_json=? WHERE id=?")
      .run(JSON.stringify({ code: 'WEB_RUNTIME_UNAVAILABLE' }), failed.jobId);
    const revised = { ...project, files: { ...project.files, 'index.php': '<?php echo "Updated";' } };
    await store.submitAnswer(id, 'php-app', { value: revised }, 'web-submission-0002');
    assert.equal(store.hasPendingCode(id), false);
    assert.equal(store.retryGrading(run.id).retried, 0);
    store.finalize(id);
    assert.equal(store.sessionView(id).pendingReview, true);
    assert.equal(store.publishCompletedResults(run.id).publishedCount, 0);
  } finally { store.close(); delete process.env.EXECUTION_ORIGIN; delete process.env.EXECUTION_SECRET; await new Promise(resolve => worker.close(resolve)); }
});

test('editing a legacy web draft retains private HTTP checks and their point weights', () => {
  const value=webTemplate('editable-web');
  const store=new Store(':memory:');
  try {
    store.importDraft(value.public,value.private);
    const before=store.getExam('editable-web',1),activity=before.public.missions[0].activities[0],rule=before.private.rules[activity.gradingRuleId];
    const question={...editableQuestion(activity,rule),prompt:'Updated PHP problem',points:100};
    store.editDraftQuestion('editable-web',1,activity.id,{question,revision:hash(before.public_json+'\n'+before.private_json)});
    const after=store.getExam('editable-web',1),edited=after.private.rules[activity.gradingRuleId];
    assert.deepEqual(edited.criteria.filter(c=>c.answer.kind==='http').map(c=>({answer:c.answer,points:c.points})),rule.criteria.filter(c=>c.answer.kind==='http').map(c=>({answer:c.answer,points:c.points})));
    assert.deepEqual(validatePackage(after.public,after.private),[]);
  }finally{store.close();}
});
