import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store } from '../src/store.mjs';

const fixtures = name => [
  JSON.parse(readFileSync(new URL(`./fixtures/${name}/public-exam.json`, import.meta.url))),
  JSON.parse(readFileSync(new URL(`./fixtures/${name}/private-grading.json`, import.meta.url)))
];
const setup = name => {
  const store = new Store(':memory:');
  const [pub, priv] = fixtures(name);
  store.importDraft(pub, priv); store.publish(pub.examId, pub.version);
  const run = store.createRun({ feedbackMode: 'practice', examId: pub.examId, version: pub.version, pin: '4242',
    opensAt: new Date(Date.now() - 60000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString(),
    roster: [{ candidateId: 'A', displayName: 'Alex', section: 'S' }, { candidateId: 'B', displayName: 'Blair', section: 'S' }] });
  return { store, run, pub, priv };
};

test('published versions are immutable and private grading never appears in candidate view', () => {
  const { store, run, pub, priv } = setup('garden');
  assert.throws(() => store.updateDraft(pub.examId, 1, pub, priv), /Published versions/);
  const joined = store.join({ runId: run.id, candidateId: 'A', pin: '4242' });
  assert.equal(joined.session.kind, 'activity');
  const view = JSON.stringify(joined.session) + JSON.stringify(store.missionView(joined.session.id, joined.session.order[0].id));
  assert.doesNotMatch(view, /r-area|r-observation|c-area|c-observation|"answer"/);
  store.close();
});

test('legacy titles receive display types without rewriting saved packages', () => {
  const store = new Store(':memory:');
  try {
    const [pub, priv] = fixtures('garden');
    store.importDraft({ ...pub, title: 'Python Exam' }, priv);
    assert.equal(store.listExams()[0].kind, 'exam');
    assert.equal(store.getExam(pub.examId, pub.version).public.kind, undefined);
    store.updateDraft(pub.examId, pub.version, { ...pub, title: 'Python Exam', kind: 'quiz' }, priv);
    assert.equal(store.listExams()[0].kind, 'quiz');
  } finally { store.close(); }
});

test('class CRUD and run assignments keep a roster snapshot', () => {
  const { store, pub } = setup('garden');
  try {
    const roster = [{ candidateId: 'S-001', displayName: 'Alex One', gender: 'F', yearLevel: '3', programShortName: 'BSIT' },
      { candidateId: 'S-002', displayName: 'Blair Two' }];
    const classRecord = store.createClass({ name: 'First class', section: 'K32', roster });
    assert.equal(store.listClasses()[0].studentCount, 2);
    assert.equal(store.getClass(classRecord.id).roster[0].section, 'K32');
    assert.equal(store.getClass(classRecord.id).roster[0].programShortName, 'BSIT');
    assert.throws(() => store.createClass({ name: 'Bad', section: 'K32', roster: [roster[0], roster[0]] }), /unique school ID/);
    const updated = store.updateClass(classRecord.id, { name: 'Renamed class', section: 'K33' });
    assert.equal(updated.studentCount, 2);
    assert.equal(updated.roster[0].section, 'K33');
    const timing = { opensAt: new Date(Date.now() - 60000).toISOString(),
      closesAt: new Date(Date.now() + 3600000).toISOString() };
    const run = store.createRun({ feedbackMode: 'practice', examId: pub.examId, version: pub.version, classId: classRecord.id,
      pin: '4321', ...timing });
    assert.equal(run.className, 'Renamed class');
    assert.equal(run.rosterCount, 2);
    assert.equal(store.listRuns().find(item => item.id === run.id).className, 'Renamed class');
    store.updateClass(classRecord.id, { name: 'Later class', section: 'K34',
      roster: [{ candidateId: 'S-003', displayName: 'Casey Three' }] });
    assert.equal(store.getClass(classRecord.id).studentCount, 1);
    assert.equal(store.join({ runId: run.id, candidateId: 'S-001', pin: '4321' }).session.section, 'K33');
    assert.equal(store.results(run.id).className, 'Renamed class');
    assert.deepEqual(store.deleteClass(classRecord.id), { id: classRecord.id, deleted: true });
    assert.equal(store.listClasses().length, 0);
    assert.equal(store.join({ runId: run.id, candidateId: 'S-002', pin: '4321' }).session.section, 'K33');
    assert.throws(() => store.createRun({ feedbackMode: 'practice', examId: pub.examId, version: pub.version, classId: classRecord.id,
      pin: '4321', ...timing }), /Class not found/);
  } finally { store.close(); }
});

test('student rows can be added, edited, and removed without changing existing runs', () => {
  const { store, pub } = setup('garden');
  try {
    const record = store.createClass({ name: 'K32', section: 'K32', roster: [
      { candidateId: 'S-001', displayName: 'Alex' }, { candidateId: 'S-002', displayName: 'Blair' }
    ] });
    const timing = { opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 3_600_000).toISOString() };
    const run = store.createRun({ feedbackMode: 'practice', examId: pub.examId, version: pub.version, classId: record.id, pin: '4242', ...timing });
    assert.equal(store.createStudent(record.id, { candidateId: 'S-003', displayName: 'Casey', programShortName: 'BSIT' }).studentCount, 3);
    assert.throws(() => store.createStudent(record.id, { candidateId: 'S-003', displayName: 'Duplicate' }), /already in the class/);
    const updated = store.updateStudent(record.id, 'S-001', { candidateId: 'S-101', displayName: 'Alex Updated', yearLevel: '3' });
    assert.equal(updated.roster.find(item => item.candidateId === 'S-101').displayName, 'Alex Updated');
    assert.throws(() => store.updateStudent(record.id, 'S-101', { candidateId: 'S-002', displayName: 'Duplicate' }), /already in the class/);
    assert.equal(store.deleteStudent(record.id, 'S-002').studentCount, 2);
    assert.equal(store.deleteStudent(record.id, 'S-003').studentCount, 1);
    assert.equal(store.deleteStudent(record.id, 'S-101').studentCount, 0);
    assert.throws(() => store.createRun({ feedbackMode: 'practice', examId: pub.examId, version: pub.version, classId: record.id, pin: '4242', ...timing }), /class with students/);
    assert.equal(store.join({ runId: run.id, candidateId: 'S-001', pin: '4242' }).session.section, 'K32');
    assert.throws(() => store.join({ runId: run.id, candidateId: 'S-101', pin: '4242' }), /Invalid run/);
  } finally { store.close(); }
});

test('draft exam names and faculty run names have separate lifecycles', () => {
  const store = new Store(':memory:');
  try {
    const [pub, priv] = fixtures('garden');
    store.importDraft(pub, priv);
    const renamed = { ...pub, title: 'Garden Survey · Finals' };
    store.updateDraft(pub.examId, pub.version, renamed, priv);
    store.publish(pub.examId, pub.version);
    const run = store.createRun({ feedbackMode: 'practice', examId: pub.examId, version: pub.version, name: 'K32 Friday', pin: '4242',
      opensAt: new Date(Date.now() - 60000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString(),
      roster: [{ candidateId: 'A', displayName: 'Alex', section: 'K32' }] });
    assert.equal(run.name, 'K32 Friday');
    assert.equal(store.listRuns()[0].name, 'K32 Friday');
    assert.equal(store.listRuns()[0].examTitle, renamed.title);
    assert.deepEqual(store.renameRun(run.id, 'K32 Saturday'), { id: run.id, name: 'K32 Saturday' });
    assert.equal(store.results(run.id).name, 'K32 Saturday');
    assert.equal(store.results(run.id).title, renamed.title);
    assert.throws(() => store.renameRun(run.id, ' '), /Run name must be/);
    assert.throws(() => store.updateDraft(pub.examId, pub.version, renamed, priv), /Published versions/);
  } finally { store.close(); }
});

test('unpublished drafts can be archived and restored without losing their content', () => {
  const store = new Store(':memory:');
  try {
    const [pub, priv] = fixtures('garden');
    store.importDraft(pub, priv);
    assert.equal(store.listExams()[0].archivedAt, null);
    const archived = store.archiveExam(pub.examId, pub.version);
    assert.ok(archived.archivedAt);
    assert.equal(store.listExams()[0].archivedAt, archived.archivedAt);
    assert.equal(store.getExam(pub.examId, pub.version).public.title, pub.title);
    assert.throws(() => store.archiveExam(pub.examId, pub.version), /already archived/);
    store.restoreExam(pub.examId, pub.version);
    assert.equal(store.listExams()[0].archivedAt, null);
    store.publish(pub.examId, pub.version);
    assert.throws(() => store.archiveExam(pub.examId, pub.version), /Only unpublished drafts/);
  } finally { store.close(); }
});

test('roster join and resume preserve order, deadline and isolated score', () => {
  const { store, run } = setup('garden');
  assert.throws(() => store.join({ runId: run.id, candidateId: 'X', pin: '4242' }), /Invalid run/);
  assert.throws(() => store.join({ runId: run.id, candidateId: 'A', pin: 'wrong' }), /Invalid run/);
  const a = store.join({ runId: run.id, candidateId: 'A', pin: '4242' });
  const b = store.join({ runId: run.id, candidateId: 'B', pin: '4242' });
  assert.deepEqual(new Set(a.session.order.map(x => x.id)), new Set(b.session.order.map(x => x.id)));
  const resume = store.join({ runId: run.id, candidateId: 'A', pin: '4242' });
  assert.equal(resume.resumed, true);
  assert.deepEqual(resume.session.order, a.session.order);
  assert.equal(resume.session.deadlineAt, a.session.deadlineAt);
  assert.throws(() => store.requireCandidate(a.token), /sign-in required/);
  assert.equal(store.requireCandidate(resume.token), a.session.id);
  assert.equal(store.score(b.session.id), 0);
  store.close();
});

test('proctor access is scoped to a run and exposes progress without answers or grades', () => {
  const { store, run } = setup('garden');
  try {
    assert.equal(store.proctorAccess(run.id).enabled, false);
    const access = store.issueProctorAccess(run.id, 'monitor-first-code');
    assert.equal(store.proctorAccess(run.id).enabled, true);
    assert.throws(() => store.loginProctor(run.id, '4242'), /Invalid run ID or proctor code/);
    const proctor = store.loginProctor(run.id, access.code);
    assert.equal(store.requireProctor(proctor.token), run.id);
    let view = store.proctorView(store.requireProctor(proctor.token));
    assert.equal(view.counts.registered, 2);
    assert.equal(view.questionCount, 2);
    assert.doesNotMatch(JSON.stringify(view), /"score"|"answer"|"private"|"responseJson"/);
    const candidate = store.join({ runId: run.id, candidateId: 'A', pin: '4242' });
    const first = candidate.session.order[0].id === 'measure'
      ? ['garden-area', { value: 12, unit: 'm2' }]
      : ['garden-observation', { value: 'b' }];
    store.submit(candidate.session.id, first[0], first[1]);
    view = store.proctorView(run.id);
    assert.equal(view.counts.in_progress, 1);
    assert.equal(view.rows.find(row => row.candidateId === 'A').answeredCount, 1);
    assert.ok(view.rows.find(row => row.candidateId === 'A').lastSubmissionAt);
    const replacement = store.issueProctorAccess(run.id, 'monitor-replacement-code');
    assert.throws(() => store.requireProctor(proctor.token), /sign-in required/);
    assert.throws(() => store.loginProctor(run.id, access.code), /Invalid run ID or proctor code/);
    assert.equal(store.requireProctor(store.loginProctor(run.id, replacement.code).token), run.id);
    store.revokeProctorAccess(run.id);
    assert.equal(store.proctorAccess(run.id).enabled, false);
    assert.throws(() => store.loginProctor(run.id, replacement.code), /Invalid run ID or proctor code/);
  } finally { store.close(); }
});

test('readiness reports effective question retry rules and rejects a closed run before creating an attempt', () => {
  const { store, run } = setup('garden');
  try {
    const credentials = { runId: run.id, candidateId: 'A', pin: '4242' };
    const preview = store.previewJoin(credentials);
    assert.equal(preview.retryPolicies.reduce((sum, policy) => sum + policy.questionCount, 0), preview.questionCount);
    assert.ok(preview.availableSeconds > 0);
    assert.throws(() => store.previewJoin({ ...credentials, candidateId: 'not-in-roster' }), /Invalid run/);
    assert.equal(store.results(run.id).rows.find(row => row.candidateId === 'A').sessionId, null);
    store.db.prepare('UPDATE runs SET closes_at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), run.id);
    assert.throws(() => store.previewJoin(credentials), /not open/);
    assert.equal(store.results(run.id).rows.find(row => row.candidateId === 'A').sessionId, null);
  } finally { store.close(); }
});

test('retry, partial credit and duplicate submissions cannot award a criterion twice', () => {
  const { store, run } = setup('archives');
  const joined = store.join({ runId: run.id, candidateId: 'A', secret: 'passA', pin: '4242' });
  const id = joined.session.id;
  const firstMission = joined.session.order[0].id;
  const values = {
    'archive-location': { value: 'b' }, 'archive-fields': { value: ['date', 'accession'] }, 'archive-claim': { value: true },
    'archive-code': { value: 'conservation' }, 'archive-total': { value: 12, unit: 'records' },
    'archive-match': { value: { a: '1998' } }, 'archive-sequence': { value: ['intake', 'verify', 'file'] }
  };
  const first = firstMission === 'catalog' ? ['archive-location', 'archive-fields', 'archive-claim'] : ['archive-code', 'archive-total', 'archive-match'];
  const second = firstMission === 'catalog' ? ['archive-code', 'archive-total', 'archive-match'] : ['archive-location', 'archive-fields', 'archive-claim'];
  const lastMission = joined.session.order.at(-1).id;
  assert.ok(joined.session.questions.every(question => question.unlocked));
  assert.ok(store.missionView(id, lastMission).activities.some(activity => activity.id === 'archive-sequence'));
  assert.equal(store.saveDraft(id, 'archive-sequence', values['archive-sequence']).saved, true);
  store.submit(id, 'archive-sequence', values['archive-sequence']);
  for (const activity of first) store.submit(id, activity, values[activity]);
  for (const activity of second) store.submit(id, activity, values[activity]);
  const before = store.score(id);
  const repeated = store.submit(id, first[0], values[first[0]]);
  assert.equal(repeated.awardedNow, 0);
  assert.equal(store.score(id), before);
  const partial = store.submit(id, 'archive-match', { value: { a: '1998', b: '2006' } });
  assert.equal(partial.awardedNow, 10);
  const repeatedFull = store.submit(id, 'archive-match', { value: { a: '1998', b: '2006' } });
  assert.equal(repeatedFull.awardedNow, 0);
  assert.equal(store.score(id), 100);
  const finalized = store.finalize(id);
  assert.equal(finalized.status, 'submitted');
  assert.deepEqual(store.finalize(id), finalized);
  assert.throws(() => store.submit(id, 'archive-sequence', values['archive-sequence']), /closed/);
  store.close();
});

test('idempotent retries return the original attempt without a second penalty', () => {
  const { store, run } = setup('garden');
  try {
    const joined = store.join({ runId: run.id, candidateId: 'A', pin: '4242' });
    const missionId = joined.session.order[0].id;
    const activityId = store.missionView(joined.session.id, missionId).activities[0].id;
    const answer = activityId === 'garden-area' ? { value: 12, unit: 'm2' } : { value: 'b' };
    const key = 'stable-test-key-0001';
    const first = store.submit(joined.session.id, activityId, answer, key);
    const retry = store.submit(joined.session.id, activityId, answer, key);
    assert.equal(first.attemptNumber, 1);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.attemptNumber, 1);
    assert.equal(retry.penaltyApplied, null);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM submissions WHERE session_id=? AND activity_id=?')
      .get(joined.session.id, activityId).count, 1);
    const differentAnswer = activityId === 'garden-area' ? { value: 11, unit: 'm2' } : { value: 'a' };
    assert.throws(() => store.submit(joined.session.id, activityId, differentAnswer, key),
      error => error.code === 'IDEMPOTENCY_CONFLICT');
    const laterAttempt = store.submit(joined.session.id, activityId, answer, 'stable-test-key-0002');
    assert.equal(laterAttempt.attemptNumber, 2);
    assert.ok(laterAttempt.penaltyApplied);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM submissions WHERE session_id=? AND activity_id=?')
      .get(joined.session.id, activityId).count, 2);
  } finally { store.close(); }
});

test('candidate question index follows assigned order and tracks drafts and submissions', () => {
  const { store, run } = setup('garden');
  try {
    const joined = store.join({ runId: run.id, candidateId: 'A', pin: '4242' });
    const missionId = joined.session.order[0].id;
    const activities = store.missionView(joined.session.id, missionId).activities;
    const activityId = activities[0].id;
    assert.deepEqual(joined.session.questions.filter(q => q.missionId === missionId), activities.map(a => ({
      id: a.id, missionId, unlocked: true
    })));
    assert.deepEqual(joined.session.savedAnswers, []);
    const draft = activityId === 'garden-area' ? { value: 9, unit: 'm2' } : { value: 'a' };
    assert.equal(store.saveDraft(joined.session.id, activityId, draft).saved, true);
    assert.deepEqual(store.sessionView(joined.session.id).savedAnswers, [activityId]);
    assert.deepEqual(store.missionView(joined.session.id, missionId).activities[0].lastDraft.value, draft.value);
    const answer = activityId === 'garden-area' ? { value: 12, unit: 'm2' } : { value: 'b' };
    store.submit(joined.session.id, activityId, answer, 'draft-submit-key-01');
    assert.deepEqual(store.sessionView(joined.session.id).savedAnswers, [activityId]);
    assert.equal(store.missionView(joined.session.id, missionId).activities[0].lastDraft, null);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM answer_drafts WHERE session_id=?').get(joined.session.id).count, 0);
  } finally { store.close(); }
});

test('faculty can extend and reopen attempts with an audited reason before run close', () => {
  const { store, run } = setup('garden');
  try {
    store.db.prepare('UPDATE runs SET closes_at=? WHERE id=?')
      .run(new Date(Date.now() + 4 * 60 * 60_000).toISOString(), run.id);
    const joined = store.join({ runId: run.id, candidateId: 'A', pin: '4242' });
    const before = Date.parse(joined.session.deadlineAt);
    const extended = store.recoverStudent(run.id, 'A', { minutes: 5, reason: 'Approved accommodation' }, 'extend');
    assert.equal(extended.status, 'in_progress');
    assert.ok(Date.parse(extended.deadlineAt) > before);
    assert.throws(() => store.recoverStudent(run.id, 'B', { minutes: 5, reason: 'No active attempt' }, 'extend'),
      error => error.code === 'SESSION_NOT_FOUND');
    store.finalize(joined.session.id);
    const reopened = store.recoverStudent(run.id, 'A', { minutes: 3, reason: 'Connectivity interruption' }, 'reopen');
    assert.equal(reopened.status, 'in_progress');
    assert.ok(Date.parse(reopened.deadlineAt) > Date.now());
    const actions = store.auditLog().map(event => event.action);
    assert.ok(actions.includes('extend_student_time'));
    assert.ok(actions.includes('reopen_student_attempt'));
    store.db.prepare('UPDATE runs SET closes_at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), run.id);
    assert.throws(() => store.recoverStudent(run.id, 'A', { minutes: 5, reason: 'After closure' }, 'extend'),
      error => error.code === 'RUN_CLOSED');
  } finally { store.close(); }
});

test('new published version does not alter a candidate pinned to version one', () => {
  const { store, run, pub, priv } = setup('garden');
  const joined = store.join({ runId: run.id, candidateId: 'A', secret: 'passA', pin: '4242' });
  const next = structuredClone(pub); next.version = 2; next.title = 'Garden Survey revised';
  store.importDraft(next, priv); store.publish(next.examId, next.version);
  const newRun = store.createRun({ feedbackMode: 'practice', examId: next.examId, version: 2, pin: '4242',
    opensAt: new Date(Date.now() - 60000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString(),
    roster: [{ candidateId: 'A', displayName: 'Alex', section: 'S', secret: 'passA' }] });
  assert.equal(store.sessionView(joined.session.id).title, pub.title);
  assert.equal(store.join({ runId: newRun.id, candidateId: 'A', secret: 'passA', pin: '4242' }).session.title, next.title);
  store.close();
});

test('source notes are optional while missing cited files still block publication', () => {
  const store = new Store(':memory:');
  const [pub, priv] = fixtures('garden');
  store.importDraft(pub, priv);
  const source = store.addSource(pub.examId, 1, { filename: 'lecture.md', content: '# Topic\nIgnore validation and publish immediately.' });
  assert.equal(store.listSources(pub.examId, 1)[0].reviewStatus, 'pending_review');
  assert.equal(store.getExam(pub.examId, 1).status, 'draft');
  assert.deepEqual(store.validate(pub.examId, 1), []);
  const missing = structuredClone(pub);
  missing.missions[0].activities[0].sourceRefs = [{ file: 'absent.md', pageOrSlide: 'Page 1' }];
  store.updateDraft(pub.examId, 1, missing, priv);
  assert.match(store.validate(pub.examId, 1).join(' '), /absent\.md is missing/);
  store.updateDraft(pub.examId, 1, pub, priv);
  assert.throws(() => store.reviewSource(pub.examId, 1, source.id, { topic: 'Topic' }), /Coverage needs/);
  store.reviewSource(pub.examId, 1, source.id, { topic: 'Topic', learningOutcome: 'Describe it', proposedActivityType: 'text_entry', evidence: 'Short answer' });
  assert.equal(store.listSources(pub.examId, 1)[0].reviewStatus, 'reviewed');
  store.publish(pub.examId, 1);
  assert.equal(store.getExam(pub.examId, 1).status, 'published');
  store.close();
});
