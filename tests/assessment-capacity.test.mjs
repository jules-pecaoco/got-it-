import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { buildApprovedPackage } from '../src/ai.mjs';
import { validateQuestionMix } from '../public/question-types.js';
import { assessmentLimits } from '../public/assessment-limits.js';

test('200 approved questions publish, save/rejoin, finalize, grade and release without loss', () => {
  const store = new Store(':memory:');
  try {
    const source = {
      filename: 'source.md',
      content:
        'Search filters matching rows before pagination. Ordering arranges rows by their values. These fictional examples explain table behavior and the distinction between filtering and ordering.',
    };
    const missions = Array.from({ length: 50 }, (_, group) => ({
      title: `Section ${group + 1}`,
      activities: Array.from({ length: 4 }, (_, index) => ({
        type: 'true_false',
        prompt: `Fictional statement ${group * 4 + index + 1}: searching filters rows.`,
        answer: true,
        manualRationale: 'Faculty reviewed this fictional table statement.',
      })),
    }));
    const built = buildApprovedPackage({
      title: 'Capacity proof',
      subject: 'Fictional',
      kind: 'exam',
      durationMinutes: 40,
      source,
      missions,
    });
    const draft = store.importDraft(built.public, built.private);
    store.publish(draft.examId, draft.version);
    const run = store.createRun({
      examId: draft.examId,
      version: draft.version,
      pin: '4242',
      feedbackMode: 'graded',
      opensAt: new Date(Date.now() - 1000).toISOString(),
      closesAt: new Date(Date.now() + 3600000).toISOString(),
      roster: [{ candidateId: 'CAPACITY-200', displayName: 'Fictional Student', section: 'Audit' }],
    });
    const join = { runId: run.id, candidateId: 'CAPACITY-200', pin: '4242' };
    const { session } = store.join(join);
    const activities = built.public.missions.flatMap((mission) => mission.activities);
    for (const activity of activities) store.saveDraft(session.id, activity.id, { value: true });
    const restored = store.join(join).session;
    assert.equal(restored.id, session.id);
    assert.equal(restored.questionCount, 200);
    assert.equal(restored.savedAnswers.length, 200);
    assert.equal(new Set(restored.questions.map((question) => question.id)).size, 200);
    const final = store.finalize(session.id);
    assert.equal(final.submittedCount, 200);
    assert.equal(final.score, undefined);
    const review = store.reviewStudent(run.id, join.candidateId);
    assert.equal(review.questions.length, 200);
    assert.equal(review.score, 2000);
    store.publishStudentResults(run.id, join.candidateId);
    assert.equal(store.sessionView(session.id).score, 2000);
    assert.equal(
      store.db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE session_id=?').get(session.id).n,
      200,
    );
  } finally {
    store.close();
  }
});

test('one shared limit accepts exactly200 and rejects201 in question mixes', () => {
  assert.equal(assessmentLimits.questions, 200);
  assert.deepEqual(validateQuestionMix({ true_false: 200 }, 200), []);
  assert.ok(validateQuestionMix({ true_false: 201 }, 201).length);
});
