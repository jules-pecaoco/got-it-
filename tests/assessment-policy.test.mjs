import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store } from '../src/store.mjs';

function fixture() {
  const store = new Store();
  const pub = JSON.parse(readFileSync(new URL('../examples/garden/public-exam.json', import.meta.url)));
  const priv = JSON.parse(readFileSync(new URL('../examples/garden/private-grading.json', import.meta.url)));
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

test('revisions survive refresh; stale tabs cannot overwrite an acknowledged draft', () => {
  const { store, id, mission, activity, correct } = fixture();
  try {
    store.submit(id, activity, { value: '' });
    const saved = store.saveDraft(id, activity, correct, '');
    assert.deepEqual(store.missionView(id, mission).activities[0].lastDraft.value, correct.value);
    assert.throws(() => store.saveDraft(id, activity, { value: 'stale' }, ''), e => e.code === 'DRAFT_CONFLICT');
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
