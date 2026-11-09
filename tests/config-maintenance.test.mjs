import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../src/store.mjs';
import { migrate } from '../src/migrations.mjs';
import { removeDemoAssessments, removeUnusedDrafts } from '../src/maintenance.mjs';
import { initializeStoreSchema } from '../src/store-schema.mjs';

test('migration preserves the newest legacy AI review for each faculty owner', () => {
  const store = new Store(':memory:');
  try {
    store.db.exec('DROP TABLE faculty_ai_proposals; DELETE FROM schema_migrations WHERE version=4;');
    const token = store.db.prepare('INSERT INTO instructor_tokens (token_hash,expires_at,faculty_id) VALUES (?,?,?)');
    const review = store.db.prepare('INSERT INTO ai_proposals (token_hash,data_json,updated_at) VALUES (?,?,?)');
    for (const [hash, owner, text, date] of [
      ['session-one', 'teacher-a', 'older review', '2026-10-01'],
      ['session-two', 'teacher-a', 'current review', '2026-10-02'],
      ['session-three', 'teacher-b', 'other teacher review', '2026-10-01'],
    ]) {
      token.run(hash, '2027-01-01', owner);
      review.run(hash, JSON.stringify({ text }), date);
    }
    migrate(store.db);
    migrate(store.db);
    const saved = store.db.prepare('SELECT owner_id,data_json FROM faculty_ai_proposals ORDER BY owner_id').all();
    assert.deepEqual(saved.map(row => [row.owner_id, JSON.parse(row.data_json).text]), [
      ['teacher-a', 'current review'], ['teacher-b', 'other teacher review'],
    ]);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM ai_proposals').get().count, 3);
  } finally {
    store.close();
  }
});

test('shared configuration loads .env independently of cwd, keeps explicit overrides and the in-memory sentinel', () => {
  const root = mkdtempSync(join(tmpdir(), 'gotit-config-'));
  try {
    writeFileSync(join(root, '.env'), 'DATA_FILE=data/recovered.sqlite\n');
    const configModule = new URL('../src/config.mjs', import.meta.url).href;
    const script = `import {loadConfig} from ${JSON.stringify(configModule)}; console.log(JSON.stringify(loadConfig(${JSON.stringify(root)}).dataFile));`;
    const env = { ...process.env };
    delete env.DATA_FILE;
    delete env.NODE_OPTIONS;
    const selected = overrides => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: tmpdir(), env: { ...env, ...overrides }, encoding: 'utf8'
    }).trim());
    assert.equal(selected({}), resolve(root, 'data/recovered.sqlite'));
    assert.equal(selected({ DATA_FILE: 'explicit.sqlite' }), resolve(root, 'explicit.sqlite'));
    assert.equal(selected({ DATA_FILE: ':memory:' }), ':memory:');
    assert.equal(selected({ NODE_ENV: 'test', DATA_FILE: '' }), resolve(root, 'data/studio.sqlite'));
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  }
});

test('demo cleanup removes all dependent records and retains unrelated assessments', () => {
  const store = new Store(':memory:');
  try {
    const pub = JSON.parse(readFileSync(new URL('./fixtures/garden/public-exam.json', import.meta.url)));
    const priv = JSON.parse(readFileSync(new URL('./fixtures/garden/private-grading.json', import.meta.url)));
    pub.missions.forEach(mission => { delete mission.shuffleGroup; });
    pub.missions[0].activities[0].retryPolicy = { maxRetries: 2, pointPenalty: 1, timePenaltySeconds: 0 };
    store.importDraft(pub, priv);
    store.publish(pub.examId, 1);
    store.importDraft({ ...pub, examId: 'keep-this-assessment' }, priv);
    const run = store.createRun({ examId: pub.examId, version: 1, pin: '4242',
      opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 3600_000).toISOString(),
      roster: [{ candidateId: 'A', displayName: 'Fictional A', section: 'QA' }] });
    const joined = store.join({ runId: run.id, candidateId: 'A', pin: '4242' });
    store.saveDraft(joined.session.id, 'garden-area', { value: 8, unit: 'm2' });
    store.submit(joined.session.id, 'garden-area', { value: 8, unit: 'm2' });
    store.submit(joined.session.id, 'garden-area', { value: 12, unit: 'm2' });
    store.saveDraft(joined.session.id, 'garden-observation', { value: 'b' });
    store.finalize(joined.session.id);
    store.overrideQuestionScore(run.id, 'A', 'garden-area', { points: 30, reason: 'Reviewed points' });
    store.issueProctorAccess(run.id, 'audit-proctor');
    store.loginProctor(run.id, 'audit-proctor');
    assert.deepEqual(removeDemoAssessments(store, ['garden-demo'])['garden-demo'], { runs: 1, sessions: 1 });
    assert.equal(store.listExams().length, 1);
    assert.equal(store.listExams()[0].examId, 'keep-this-assessment');
    for (const table of ['sessions', 'penalty_events', 'score_overrides', 'answer_drafts', 'score_events', 'submissions', 'proctor_tokens', 'roster', 'runs'])
      assert.equal(store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { store.close(); }
});

test('draft cleanup removes unused drafts and sources while preserving published versions and answer drafts', () => {
  const store = new Store(':memory:');
  try {
    const pub = JSON.parse(readFileSync(new URL('./fixtures/garden/public-exam.json', import.meta.url)));
    const priv = JSON.parse(readFileSync(new URL('./fixtures/garden/private-grading.json', import.meta.url)));
    store.importDraft(pub, priv); store.publish(pub.examId, pub.version);
    store.importDraft({ ...pub, examId: 'unused-draft' }, priv);
    store.addSource('unused-draft', 1, { filename: 'notes.txt', content: 'Temporary source' });
    const run = store.createRun({ examId: pub.examId, version: 1, pin: '4242', opensAt: new Date(Date.now() - 1000).toISOString(),
      closesAt: new Date(Date.now() + 600000).toISOString(), roster: [{ candidateId: 'A', displayName: 'Alex', section: 'S' }] });
    const joined = store.join({ runId: run.id, candidateId: 'A', pin: '4242' });
    const activity = store.missionView(joined.session.id, joined.session.order[0].id).activities[0];
    store.saveDraft(joined.session.id, activity.id, activity.type === 'numeric_entry' ? { value: 12, unit: 'm2' } : { value: 'b' });
    assert.deepEqual(removeUnusedDrafts(store), { removedDrafts: 1 });
    assert.equal(store.listExams().length, 1);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM source_documents').get().n, 0);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM answer_drafts').get().n, 1);
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { store.close(); }
});

test('legacy candidate tokens expire on schema upgrade without losing resumable attempts', () => {
  const store = new Store(':memory:');
  try {
    const pub = JSON.parse(readFileSync(new URL('./fixtures/garden/public-exam.json', import.meta.url)));
    const priv = JSON.parse(readFileSync(new URL('./fixtures/garden/private-grading.json', import.meta.url)));
    store.importDraft(pub, priv); store.publish(pub.examId, 1);
    const run = store.createRun({ examId: pub.examId, version: 1, pin: '4242',
      opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 3600_000).toISOString(),
      roster: [{ candidateId: 'A', displayName: 'Fictional A', section: 'QA' }] });
    const input = { runId: run.id, candidateId: 'A', pin: '4242' };
    const before = store.join(input);
    store.db.exec('ALTER TABLE sessions DROP COLUMN token_expires_at');
    initializeStoreSchema(store.db);
    assert.throws(() => store.requireCandidate(before.token), error => error.status === 401);
    const after = store.join(input);
    assert.equal(after.session.id, before.session.id);
    assert.equal(after.session.deadlineAt, before.session.deadlineAt);
    assert.deepEqual(after.session.order, before.session.order);
  } finally { store.close(); }
});
