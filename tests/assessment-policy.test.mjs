import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store } from '../src/store.mjs';

function fixture(configure = () => {}) {
  const store = new Store();
  const pub = JSON.parse(readFileSync(new URL('./fixtures/garden/public-exam.json', import.meta.url)));
  const priv = JSON.parse(readFileSync(new URL('./fixtures/garden/private-grading.json', import.meta.url)));
  configure(pub);
  store.importDraft(pub, priv); store.publish(pub.examId, pub.version);
  const run = store.createRun({ examId: pub.examId, version: pub.version, pin: '4242',
    opensAt: new Date(Date.now() - 1000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString(),
    roster: [{ candidateId: 'A', displayName: 'Alex', section: 'S' }] });
  const id = store.join({ runId: run.id, candidateId: 'A', pin: '4242' }).session.id;
  const mission = store.sessionView(id).order[0].id;
  const activity = store.missionView(id, mission).activities[0].id;
  const correct = activity === 'garden-area' ? { value: 12, unit: 'm2' } : { value: 'b' };
  return { store, run, id, mission, activity, correct };
}

test('revisions survive refresh; stale tabs cannot overwrite or submit over an acknowledged draft', async () => {
  const { store, id, mission, activity, correct } = fixture();
  try {
    assert.throws(() => store.submit(id, activity, { value: '' }), { code: 'INVALID_ANSWER' });
    const saved = store.saveDraft(id, activity, correct, '');
    assert.deepEqual(store.missionView(id, mission).activities[0].lastDraft.value, correct.value);
    assert.throws(() => store.saveDraft(id, activity, { value: 'stale' }, ''), e => e.code === 'DRAFT_CONFLICT');
    const stale = activity === 'garden-area' ? { value: 8, unit: 'm2' } : { value: 'a' };
    await assert.rejects(store.submitAnswer(id, activity, stale, null, ''), { code: 'DRAFT_CONFLICT' });
    assert.equal(store.missionView(id, mission).activities[0].lastDraft.value, correct.value);
    assert.ok(saved.updatedAt);
    const result = store.finalize(id);
    assert.equal(result.resultsReleased, false);
    assert.ok(store.score(id) > 0);
    const count = store.db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n;
    store.finalize(id); assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n, count);
  } finally { store.close(); }
});

test('expiry grades saved drafts once and run close never releases graded scores', () => {
  const { store, run, id, activity, correct } = fixture();
  try {
    store.saveDraft(id, activity, correct);
    // Move acknowledgement and deadline together to model an on-time saved draft.
    store.db.prepare('UPDATE answer_drafts SET updated_at=?').run(new Date(Date.now() - 2000).toISOString());
    store.db.prepare('UPDATE sessions SET deadline_at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), id);
    store.settleExpired(); store.settleExpired();
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n, 1);
    assert.equal(store.sessionView(id).status, 'expired');
    store.db.prepare('UPDATE runs SET closes_at=?').run(new Date(Date.now() - 1000).toISOString());
    assert.equal(store.sessionView(id).score, undefined);
    store.publishStudentResults(run.id, 'A');
    assert.ok(store.sessionView(id).score > 0);
  } finally { store.close(); }
});

test('a retry penalty cannot strand other answers saved before expiry', () => {
  const { store, id } = fixture(pub => {
    pub.missions[0].activities[0].retryPolicy = { maxRetries: 2, pointPenalty: 0, timePenaltySeconds: 30 };
  });
  try {
    store.submit(id, 'garden-area', { value: 0, unit: 'm2' });
    store.saveDraft(id, 'garden-area', { value: 12, unit: 'm2' });
    store.saveDraft(id, 'garden-observation', { value: 'b' });
    const now = Date.now();
    const update = store.db.prepare('UPDATE answer_drafts SET updated_at=? WHERE activity_id=?');
    update.run(new Date(now - 3000).toISOString(), 'garden-area');
    update.run(new Date(now - 2000).toISOString(), 'garden-observation');
    store.db.prepare('UPDATE sessions SET deadline_at=? WHERE id=?').run(new Date(now - 1000).toISOString(), id);

    store.settleExpired();
    const result = store.finalize(id);
    assert.equal(result.status, 'expired');
    assert.equal(result.submittedCount, 2);
    assert.equal(result.deadlineAt, new Date(now - 3000).toISOString());
    assert.equal(store.score(id), 100);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n, 3);
  } finally { store.close(); }
});

test('clearing a saved draft leaves the question unanswered and uses no retry', () => {
  const { store, id, activity, correct } = fixture();
  try {
    const saved = store.saveDraft(id, activity, correct);
    assert.equal(saved.gradable, true);
    const cleared = store.saveDraft(id, activity, { value: '' }, saved.updatedAt);
    assert.equal(cleared.gradable, false);
    assert.equal(store.finalize(id).submittedCount, 0);
  } finally { store.close(); }
});
