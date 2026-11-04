import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store } from '../src/store.mjs';
import { asFaculty } from '../src/faculty-access.mjs';

test('faculty ownership isolates assessments, classes, runs and audit records', () => {
  const store = new Store();
  try {
    store.setFacultyPassword('alice', 'alice-password-long');
    store.setFacultyPassword('blair', 'blair-password-long');
    const token = store.loginInstructor('alice-password-long', '', 'alice').token;
    assert.equal(store.requireInstructor(token), 'alice');
    assert.throws(() => store.loginInstructor('wrong', '', 'alice'), e => e.status === 401);
    const pub = JSON.parse(readFileSync(new URL('./fixtures/garden/public-exam.json', import.meta.url)));
    const priv = JSON.parse(readFileSync(new URL('./fixtures/garden/private-grading.json', import.meta.url)));
    let classroom;
    asFaculty('alice', () => {
      store.importDraft(pub, priv); store.publish(pub.examId, pub.version);
      classroom = store.createClass({ name: 'Class', section: 'A', roster: [{ candidateId: 'A', displayName: 'Alex' }] });
      store.createRun({ examId: pub.examId, version: pub.version, classId: classroom.id, pin: '4242',
        opensAt: new Date(Date.now() - 1000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString() });
      assert.equal(store.listRuns().length, 1);
    });
    asFaculty('blair', () => {
      assert.equal(store.listExams().length, 0); assert.equal(store.listClasses().length, 0); assert.equal(store.listRuns().length, 0);
      assert.throws(() => store.getExam(pub.examId, pub.version), e => e.status === 404);
      assert.throws(() => store.getClass(classroom.id), e => e.status === 404);
      assert.equal(store.auditLog().length, 0);
    });
    store.setFacultyPassword('alice', 'changed-password-long');
    assert.throws(() => store.requireInstructor(token), e => e.status === 401);
  } finally { store.close(); }
});
