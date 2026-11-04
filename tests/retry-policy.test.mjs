import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store } from '../src/store.mjs';
import { validatePackage } from '../src/engine.mjs';
import { answerText } from '../public/answer-key.js';
import { parseTableCode } from '../public/table-code.js';

const base = new URL('../exam-packages/itp255-week13-draft/', import.meta.url);
const pub = JSON.parse(readFileSync(new URL('public-exam.json', base)));
const priv = JSON.parse(readFileSync(new URL('private-grading.json', base)));
const source = readFileSync(new URL('Week_13-2_extracted.md', base), 'utf8');

function setup() {
  const store = new Store(':memory:');
  store.importDraft(pub, priv);
  const document = store.addSource(pub.examId, pub.version, { filename: 'Week_13-2_extracted.md', content: source });
  store.reviewSource(pub.examId, pub.version, document.id, {
    topic: 'DataTables page length, search and ordering',
    learningOutcome: 'Inspect filtered pages and build table code',
    proposedActivityType: 'data_inspection and datatable_code',
    evidence: 'Candidate table state and code reveal the requested tickets'
  });
  store.publish(pub.examId, pub.version);
  const run = store.createRun({ feedbackMode: 'practice', examId: pub.examId, version: pub.version, pin: '4321',
    opensAt: new Date(Date.now() - 1000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString(),
    roster: [{ candidateId: 'TEST-001', displayName: 'Test Candidate', section: 'Test' }] });
  const sid = store.join({ runId: run.id, candidateId: 'TEST-001', pin: '4321' }).session.id;
  return { store, run, sid };
}

test('retry policy validates bounds and can override a mission rule', () => {
  assert.deepEqual(validatePackage(pub, priv), []);
  const wrong = structuredClone(pub);
  wrong.missions[0].retryPolicy.maxRetries = -1;
  assert.match(validatePackage(wrong, priv).join(' '), /invalid retry policy/);
  const unlimited = structuredClone(pub);
  unlimited.missions[0].retryPolicy.maxRetries = null;
  assert.deepEqual(validatePackage(unlimited, priv), []);
});

test('each retry costs points and time, stops at the attempt limit, and appears in results', () => {
  const { store, run, sid } = setup();
  try {
    const [table, flag] = pub.missions[0].activities;
    const values = Object.fromEntries(priv.rules[table.gradingRuleId].criteria.map(c => [c.answer.kind, c.answer.value]));
    const correct = { pageLength: values.page_length, pageIndex: 0, globalSearch: values.global_search,
      columnSearch: {}, order: values.order };
    const initialDeadline = Date.parse(store.sessionView(sid).deadlineAt);
    assert.equal(store.submit(sid, table.id, { value: {} }).attemptNumber, 1);
    assert.equal(store.score(sid), 0);
    const second = store.submit(sid, table.id, { value: correct });
    assert.equal(second.result, 'correct');
    assert.deepEqual(second.penaltyApplied, { points: 1, seconds: 10 });
    assert.equal(second.score, 7);
    assert.equal(Date.parse(second.deadlineAt), initialDeadline - 10000);
    const third = store.submit(sid, table.id, { value: correct });
    assert.equal(third.score, 6);
    assert.equal(third.attemptsRemaining, 0);
    assert.equal(Date.parse(third.deadlineAt), initialDeadline - 20000);
    assert.throws(() => store.submit(sid, table.id, { value: correct }), /No attempts remain/);
    assert.equal(store.missionView(sid, 'find').activities[0].attemptsUsed, 3);
    assert.equal(store.results(run.id).rows[0].score, 6);

    store.submit(sid, flag.id, { value: 'wrong' });
    const answer = priv.rules[flag.gradingRuleId].criteria[0].answer[0];
    const flagRetry = store.submit(sid, flag.id, { value: answer });
    assert.deepEqual(flagRetry.penaltyApplied, { points: 1, seconds: 10 });
    assert.equal(flagRetry.score, 7);
    assert.equal(Date.parse(flagRetry.deadlineAt), initialDeadline - 30000);
  } finally { store.close(); }
});

test('an editable copy keeps reviewed sources and leaves the published version unchanged', () => {
  const { store } = setup();
  try {
    const copy = store.cloneExam(pub.examId, pub.version);
    assert.equal(copy.version, pub.version + 1);
    assert.equal(copy.status, 'draft');
    assert.equal(store.getExam(pub.examId, pub.version).status, 'published');
    assert.equal(store.listSources(pub.examId, copy.version)[0].reviewStatus, 'reviewed');
    const copied = store.getExam(pub.examId, copy.version);
    copied.public.missions[0].retryPolicy = { maxRetries: 0, pointPenalty: 0, timePenaltySeconds: 0 };
    store.updateDraft(pub.examId, copy.version, copied.public, copied.private);
    assert.deepEqual(store.validate(pub.examId, copy.version), []);
    store.publish(pub.examId, copy.version);
    assert.equal(store.getExam(pub.examId, pub.version).public.missions[0].retryPolicy.maxRetries, 2);
  } finally { store.close(); }
});

test('faculty answer key gives readable table state and a valid code solution', () => {
  const code = pub.missions[3].activities[0];
  const text = answerText(code, priv.rules[code.gradingRuleId]);
  assert.match(text, /Visible tickets:/);
  assert.match(text, /One valid script:/);
  const script = text.split('One valid script:\n')[1];
  assert.doesNotThrow(() => parseTableCode(script, code.publicConfig));
  const flag = pub.missions[0].activities[1];
  assert.match(answerText(flag, priv.rules[flag.gradingRuleId]), /Q\d+/);
});
