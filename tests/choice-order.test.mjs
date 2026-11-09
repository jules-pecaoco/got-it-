import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';

const createAssessment = () => {
  const options = [
    { id: 'oak', label: 'Oak' },
    { id: 'pine', label: 'Pine' },
    { id: 'elm', label: 'Elm' },
  ];
  const items = [
    { id: 'collect', label: 'Collect the samples' },
    { id: 'check', label: 'Check the labels' },
    { id: 'save', label: 'Save the record' },
  ];
  const activities = [
    { id: 'single', type: 'single_choice', publicConfig: { options: structuredClone(options) } },
    { id: 'multiple', type: 'multiple_choice', publicConfig: { options: structuredClone(options) } },
    { id: 'sequence', type: 'sequencing', publicConfig: { items } },
  ].map((a) => ({
    ...a,
    prompt: 'Answer this fictional assessment question.',
    maxPoints: 10,
    gradingRuleId: `rule-${a.id}`,
    manualRationale: 'Fictional regression example.',
  }));
  const pub = {
    schemaVersion: '1.0',
    examId: 'choice-order-test',
    version: 1,
    title: 'Fictional tree survey',
    subject: 'Synthetic examples',
    kind: 'quiz',
    settings: { durationMinutes: 30, coreMaxPoints: 30, bonusMaxPoints: 0 },
    missions: [{ id: 'survey', title: 'Survey', maxPoints: 30, activities }],
  };
  const answers = { single: 'pine', multiple: ['oak', 'elm'], sequence: ['collect', 'check', 'save'] };
  const priv = {
    rules: Object.fromEntries(
      activities.map((a) => [
        a.gradingRuleId,
        { type: a.type, criteria: [{ id: `criterion-${a.id}`, points: 10, answer: answers[a.id] }] },
      ]),
    ),
  };
  return { pub, priv, answers };
};
const setup = (customize = () => {}) => {
  const store = new Store(':memory:');
  const assessment = createAssessment();
  customize(assessment);
  store.importDraft(assessment.pub, assessment.priv);
  store.publish(assessment.pub.examId, 1);
  const run = store.createRun({
    examId: assessment.pub.examId,
    version: 1,
    feedbackMode: 'practice',
    shuffleQuestions: false,
    pin: '4242',
    opensAt: new Date(Date.now() - 60000).toISOString(),
    closesAt: new Date(Date.now() + 3600000).toISOString(),
    roster: [
      { candidateId: 'SYNTHETIC-A', displayName: 'Synthetic A', section: 'Test' },
      { candidateId: 'SYNTHETIC-B', displayName: 'Synthetic B', section: 'Test' },
    ],
  });
  const admission = { runId: run.id, candidateId: 'SYNTHETIC-A', pin: '4242' };
  return { store, ...assessment, admission };
};
const choiceIds = (activity) =>
  activity.publicConfig[activity.type === 'sequencing' ? 'items' : 'options'].map((choice) => choice.id);
const displayed = (store, sessionId) => store.missionView(sessionId, 'survey').activities;

test('new sessions receive stable nonidentity choice pools without changing published answers', () => {
  const { store, pub, priv, answers, admission } = setup();
  try {
    const original = store.getExam(pub.examId, 1);
    const { session } = store.join(admission);
    const first = displayed(store, session.id);
    assert.equal(
      store.db
        .prepare('SELECT COUNT(*) AS count FROM session_choice_orders WHERE session_id=?')
        .get(session.id).count,
      3,
    );
    for (const activity of first) {
      const source = pub.missions[0].activities.find((a) => a.id === activity.id);
      assert.notDeepEqual(choiceIds(activity), choiceIds(source), activity.type);
      assert.deepEqual([...choiceIds(activity)].sort(), [...choiceIds(source)].sort());
      assert.deepEqual(
        activity.publicConfig[activity.type === 'sequencing' ? 'items' : 'options']
          .slice()
          .sort((a, b) => a.id.localeCompare(b.id)),
        source.publicConfig[source.type === 'sequencing' ? 'items' : 'options']
          .slice()
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
      assert.equal(Object.hasOwn(activity, 'gradingRuleId'), false);
    }
    assert.deepEqual(displayed(store, session.id).map(choiceIds), first.map(choiceIds));
    assert.deepEqual(store.join(admission).session.id, session.id);
    assert.deepEqual(displayed(store, session.id).map(choiceIds), first.map(choiceIds));
    assert.deepEqual(store.getExam(pub.examId, 1).public, original.public);
    assert.deepEqual(store.getExam(pub.examId, 1).private, priv);
    for (const activity of first) {
      // This is the same JSON transport shape used by browser controls: IDs stay strings.
      const response = JSON.parse(JSON.stringify({ value: answers[activity.id] }));
      assert.equal(store.submit(session.id, activity.id, response).result, 'correct');
    }
    assert.equal(store.sessionView(session.id).score, 30);
    assert.deepEqual(store.getExam(pub.examId, 1).public, original.public);
    assert.deepEqual(store.getExam(pub.examId, 1).private, priv);
  } finally {
    store.close();
  }
});

test('draft refresh and rejoin preserve assigned choices and stable sequence response IDs', () => {
  const { store, admission, answers } = setup();
  try {
    const { session } = store.join(admission);
    const order = displayed(store, session.id).map(choiceIds);
    store.saveDraft(session.id, 'single', { value: answers.single });
    store.saveDraft(session.id, 'multiple', { value: answers.multiple });
    store.saveDraft(session.id, 'sequence', { value: ['collect', '', 'save'] });
    const rejoined = store.join(admission);
    assert.equal(rejoined.resumed, true);
    assert.deepEqual(displayed(store, session.id).map(choiceIds), order);
    const drafts = Object.fromEntries(displayed(store, session.id).map((a) => [a.id, a.lastDraft]));
    assert.equal(drafts.single.value, 'pine');
    assert.deepEqual(drafts.multiple.value, ['oak', 'elm']);
    assert.deepEqual(drafts.sequence.value, ['collect', '', 'save']);
    assert.equal(drafts.sequence.gradable, false);
    assert.deepEqual(new Set(store.sessionView(session.id).savedAnswers), new Set(['single', 'multiple']));
    store.saveDraft(session.id, 'sequence', { value: answers.sequence });
    store.finalize(session.id);
    assert.equal(store.sessionView(session.id).score, 30);
    assert.equal(
      store.db.prepare('SELECT COUNT(*) AS count FROM submissions WHERE session_id=?').get(session.id).count,
      3,
    );
  } finally {
    store.close();
  }
});

test('sequencing display avoids the private correct sequence even when public items start in a different order', () => {
  const { store, admission } = setup(({ pub, priv, answers }) => {
    const activity = pub.missions[0].activities.find((a) => a.type === 'sequencing');
    activity.publicConfig.items = [
      { id: 'check', label: 'Check the labels' },
      { id: 'collect', label: 'Collect the samples' },
    ];
    answers.sequence = ['collect', 'check'];
    priv.rules['rule-sequence'].criteria[0].answer = answers.sequence;
  });
  try {
    const { session } = store.join(admission);
    const activity = displayed(store, session.id).find((a) => a.type === 'sequencing');
    assert.notDeepEqual(choiceIds(activity), ['collect', 'check']);
    assert.equal(store.submit(session.id, 'sequence', { value: ['collect', 'check'] }).result, 'correct');
  } finally {
    store.close();
  }
});

test('legacy sessions without persisted choice pools retain their original display on rejoin', () => {
  const { store, pub, admission } = setup();
  try {
    const { session } = store.join(admission);
    // Absence of rows models sessions created before the additive table migration.
    store.db.prepare('DELETE FROM session_choice_orders WHERE session_id=?').run(session.id);
    const original = pub.missions[0].activities.map(choiceIds);
    assert.deepEqual(displayed(store, session.id).map(choiceIds), original);
    assert.equal(store.join(admission).resumed, true);
    assert.deepEqual(displayed(store, session.id).map(choiceIds), original);
    assert.equal(
      store.db
        .prepare('SELECT COUNT(*) AS count FROM session_choice_orders WHERE session_id=?')
        .get(session.id).count,
      0,
    );
  } finally {
    store.close();
  }
});
