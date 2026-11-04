// Post-fix audit verification: isolated database, fictional records, loopback only.
// evidence.json preserves the original audit; this writes verification.json.
// Run: node --experimental-sqlite artifacts/audit-2026-11-02/reproduce.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.DATA_FILE = ':memory:';
process.env.DEMO_MODE = '1';
const { server, store } = await import('../../src/server.mjs');
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const evidence = {};
const createRun = (examId = 'garden-demo', roster = undefined) => store.createRun({
  examId, version: 1, pin: 'audit-pin', feedbackMode: 'graded',
  opensAt: new Date(Date.now() - 60_000).toISOString(),
  closesAt: new Date(Date.now() + 3600_000).toISOString(),
  roster: roster ?? [{ candidateId: 'AUDIT-001', displayName: 'Fictional Student', section: 'Audit' }]
});
const post = async (path, data, token) => {
  const response = await fetch(base + path, {
    method: 'POST', headers: {
      'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {})
    }, body: JSON.stringify(data)
  });
  return { status: response.status, payload: await response.json() };
};

try {
  // A released graded score is hidden again when faculty reopens the attempt.
  const recoveryRun = createRun();
  const joined = store.join({ runId: recoveryRun.id, candidateId: 'AUDIT-001', pin: 'audit-pin' });
  const mission = store.missionView(joined.session.id, joined.session.order[0].id);
  const activity = mission.activities[0];
  store.submit(joined.session.id, activity.id,
    activity.type === 'numeric_entry' ? { value: 12, unit: 'm2' } : { value: 'b' });
  store.finalize(joined.session.id);
  store.publishStudentResults(recoveryRun.id, 'AUDIT-001');
  store.recoverStudent(recoveryRun.id, 'AUDIT-001', { minutes: 5, reason: 'Audit reproduction' }, 'reopen');
  const reopened = store.sessionView(joined.session.id);
  evidence.reopenedGradedAttempt = {
    status: reopened.status, resultsReleased: reopened.resultsReleased,
    scoreIncluded: Object.hasOwn(reopened, 'score'), score: reopened.score
  };
  assert.equal(reopened.status, 'in_progress');
  assert.equal(reopened.resultsReleased, false);
  assert.equal(Object.hasOwn(reopened, 'score'), false);
  const nextMission = store.sessionView(joined.session.id).order.find(item => item.unlocked && !item.completed);
  const nextActivity = store.missionView(joined.session.id, nextMission.id).activities[0];
  store.submit(joined.session.id, nextActivity.id,
    nextActivity.type === 'numeric_entry' ? { value: 12, unit: 'm2' } : { value: 'b' });
  evidence.reopenedGradedAttempt.scoreIncludedAfterNewSubmission = Object.hasOwn(store.sessionView(joined.session.id), 'score');
  assert.equal(evidence.reopenedGradedAttempt.scoreIncludedAfterNewSubmission, false);

  // Valid credentials alone rotate another student's existing token.
  store.join({ runId: recoveryRun.id, candidateId: 'AUDIT-001', pin: 'audit-pin' });
  let oldTokenRejected = false;
  try { store.requireCandidate(joined.token); } catch { oldTokenRejected = true; }
  evidence.sharedCredentials = { oldTokenRejectedAfterRejoin: oldTokenRejected };
  assert.equal(oldTokenRejected, true);

  // Successful readiness and joins do not exhaust the failed-credential budget.
  const roster = Array.from({ length: 12 }, (_, index) => ({
    candidateId: `NAT-${index + 1}`, displayName: `Fictional Student ${index + 1}`, section: 'Audit'
  }));
  const classroomRun = createRun('garden-demo', roster);
  const statuses = [];
  for (const student of roster) {
    const input = { runId: classroomRun.id, candidateId: student.candidateId, pin: 'audit-pin' };
    const preview = await post('/api/auth/student/preview', input);
    const join = preview.status === 200 ? await post('/api/auth/student/join', input) : null;
    statuses.push({ student: student.candidateId, preview: preview.status, join: join?.status ?? null });
  }
  evidence.classroomSharedIp = {
    attemptedStudents: roster.length,
    joinedStudents: statuses.filter(item => item.join === 200).length,
    statuses
  };
  assert.equal(evidence.classroomSharedIp.joinedStudents, 12);
  assert.equal(statuses[10].preview, 200);

  // Publication rejects IDs that cannot match the HTTP route's ID pattern.
  const source = store.getExam('garden-demo', 1);
  const customPublic = structuredClone(source.public);
  customPublic.examId = 'audit-id-contract';
  const badId = 'question_with_underscore';
  customPublic.missions[0].activities[0].id = badId;
  store.importDraft(customPublic, source.private);
  const validationErrors = store.validate(customPublic.examId, 1);
  assert.throws(() => store.publish(customPublic.examId, 1), error => error.code === 'PACKAGE_INVALID');
  evidence.publishedUnreachableQuestion = { validationErrors, publicationRejected: true };
  assert.ok(validationErrors.length > 0);

  // Logout revokes server access, and split UTF-8 characters survive intact.
  const instructor = store.loginInstructor('audit-password', 'audit-password');
  const logout = await post('/api/instructor/logout', {}, instructor.token);
  const afterLogout = await fetch(base + '/api/instructor/assessments', {
    headers: { Authorization: `Bearer ${instructor.token}` }
  });
  await afterLogout.arrayBuffer();
  evidence.facultyLogout = { logoutEndpointStatus: logout.status, tokenStillAuthorized: afterLogout.status === 200 };
  assert.equal(logout.status, 200);
  assert.equal(afterLogout.status, 401);
  const freshInstructor = store.loginInstructor('audit-password', 'audit-password');
  const utf8Run = createRun();
  const expectedName = 'Caf\u00e9';
  const encoded = Buffer.from(JSON.stringify({ name: expectedName }), 'utf8');
  const split = encoded.indexOf(0xc3) + 1;
  const utf8Status = await new Promise((resolve, reject) => {
    const request = http.request(`${base}/api/instructor/runs/${utf8Run.id}/name`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${freshInstructor.token}` }
    }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.write(encoded.subarray(0, split));
    setTimeout(() => request.end(encoded.subarray(split)), 50);
  });
  const savedName = store.listRuns().find(run => run.id === utf8Run.id).name;
  evidence.splitUtf8Body = { status: utf8Status, expectedName, savedName, preserved: expectedName === savedName };
  assert.equal(utf8Status, 200);
  assert.equal(savedName, expectedName);

  console.log(JSON.stringify(evidence, null, 2));
  writeFileSync(new URL('./verification.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
} finally {
  await new Promise(resolve => server.close(resolve));
  store.close();
}
