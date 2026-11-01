import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeneratedPackage } from '../src/ai.mjs';
import { zipSync, strToU8 } from 'fflate';

process.env.NODE_ENV = 'test';
process.env.DATA_FILE = ':memory:';
process.env.DEMO_MODE = '1';
const { server, store } = await import('../src/server.mjs');
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (path, { method = 'GET', data, token } = {}) => {
  const response = await fetch(base + path, { method, headers: {
    ...(data ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {})
  }, body: data ? JSON.stringify(data) : undefined });
  return { response, payload: response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text() };
};
test.after(() => { server.close(); store.close(); });

test('candidate API protects private rules, persists score and finalizes', async () => {
  const demo = (await call('/api/demo')).payload.data;
  const run = demo.runs.find(x => x.examId === 'garden-demo' && x.name === 'The Garden Survey');
  const joined = (await call('/api/auth/student/join', { method: 'POST', data: {
    runId: run.id, candidateId: demo.candidates[0].candidateId, pin: demo.pin
  } })).payload.data;
  const token = joined.token;
  const session = (await call('/api/me/session', { token })).payload.data;
  assert.equal(session.status, 'in_progress');
  const mission = (await call(`/api/me/missions/${session.order[0].id}`, { token })).payload.data;
  assert.doesNotMatch(JSON.stringify(mission), /gradingRuleId|"answer"|"rules"/);
  const activity = mission.activities[0];
  const submission = activity.type === 'numeric_entry' ? { value: 12, unit: 'm2' } : { value: 'b' };
  const first = await call(`/api/me/activities/${activity.id}/submit`, { method: 'POST', data: submission, token });
  assert.equal(first.payload.data.awardedNow, 50);
  const second = await call(`/api/me/activities/${activity.id}/submit`, { method: 'POST', data: submission, token });
  assert.equal(second.payload.data.awardedNow, 0);
  const finish = await call('/api/me/finalize', { method: 'POST', data: {}, token });
  assert.equal(finish.payload.data.status, 'submitted');
  assert.equal((await call(`/api/me/activities/${activity.id}/submit`, { method: 'POST', data: submission, token })).response.status, 403);
  assert.equal((await call('/api/instructor/exams')).response.status, 401);
});

test('graded runs save answers without revealing results until the run closes', async () => {
  const instructor = store.loginInstructor('demo-instructor', 'demo-instructor').token;
  const created = await call('/api/instructor/runs', { method: 'POST', token: instructor, data: {
    examId: 'garden-demo', version: 1, name: 'Graded feedback check', pin: '4321', feedbackMode: 'graded',
    opensAt: new Date(Date.now() - 60_000).toISOString(),
    closesAt: new Date(Date.now() + 3600_000).toISOString(),
    roster: [{ candidateId: 'G-001', displayName: 'Fictional Candidate', section: 'Demo' }]
  } });
  assert.equal(created.response.status, 201);
  const runId = created.payload.data.id;
  assert.equal(created.payload.data.feedbackMode, 'graded');
  const joined = await call('/api/auth/student/join', { method: 'POST', data: {
    runId, candidateId: 'G-001', pin: '4321'
  } });
  const candidate = joined.payload.data;
  assert.equal(candidate.session.feedbackMode, 'graded');
  assert.equal(candidate.session.resultsReleased, false);
  assert.doesNotMatch(JSON.stringify(candidate.session), /"score"/);
  const mission = (await call(`/api/me/missions/${candidate.session.order[0].id}`, { token: candidate.token })).payload.data;
  const activity = mission.activities[0];
  const submission = activity.type === 'numeric_entry' ? { value: 12, unit: 'm2' } : { value: 'b' };
  const answer = await call(`/api/me/activities/${activity.id}/submit`, { method: 'POST', data: submission, token: candidate.token });
  assert.equal(answer.payload.data.saved, true);
  assert.doesNotMatch(JSON.stringify(answer.payload.data), /"result"|"feedbackCode"|"score"|"awardedNow"/);
  const active = await call('/api/me/session', { token: candidate.token });
  assert.doesNotMatch(JSON.stringify(active.payload.data), /"score"/);
  const finished = await call('/api/me/finalize', { method: 'POST', data: {}, token: candidate.token });
  assert.equal(finished.payload.data.status, 'submitted');
  assert.doesNotMatch(JSON.stringify(finished.payload.data), /"score"/);
  assert.equal((await call(`/api/instructor/runs/${runId}/results`, { token: instructor })).payload.data.rows[0].score, 50);
  store.db.prepare('UPDATE runs SET closes_at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), runId);
  const released = await call('/api/me/results', { token: candidate.token });
  assert.equal(released.payload.data.resultsReleased, true);
  assert.equal(released.payload.data.score, 50);
  const resumed = await call('/api/auth/student/join', { method: 'POST', data: { runId, candidateId: 'G-001', pin: '4321' } });
  assert.equal(resumed.payload.data.session.score, 50);
});

test('instructor results and CSV show roster identity and server score', async () => {
  const demo = (await call('/api/demo')).payload.data;
  const run = demo.runs.find(x => x.examId === 'garden-demo' && x.name === 'The Garden Survey');
  const login = await call('/api/instructor/login', { method: 'POST', data: { password: demo.instructorPassword } });
  const token = login.payload.data.token;
  const results = await call(`/api/instructor/runs/${run.id}/results`, { token });
  assert.equal(results.payload.data.rows.length, 2);
  assert.equal(results.payload.data.rows.find(x => x.candidateId === 'DEMO-001').score, 50);
  const exportResult = await call(`/api/instructor/runs/${run.id}/export.csv`, { token });
  assert.match(exportResult.payload, /DEMO-001/);
  assert.match(exportResult.payload, /Alex Rivera/);
});

test('faculty can name a run without changing its login ID or exam version', async () => {
  const login = await call('/api/instructor/login', { method: 'POST', data: { password: 'demo-instructor' } });
  const token = login.payload.data.token;
  const run = (await call('/api/instructor/runs', { method: 'POST', token, data: {
    examId: 'garden-demo', version: 1, name: 'Section K32 Finals', pin: '4242',
    opensAt: new Date(Date.now() - 60000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString(),
    roster: [{ candidateId: 'K32-001', displayName: 'Test Student', section: 'K32' }]
  } })).payload.data;
  assert.equal(run.name, 'Section K32 Finals');
  assert.equal((await call('/api/instructor/runs', { token })).payload.data.find(x => x.id === run.id).name, 'Section K32 Finals');
  assert.equal((await call(`/api/instructor/runs/${run.id}/name`, { method: 'PUT', data: { name: 'Section K32 Quiz' } })).response.status, 401);
  const renamed = await call(`/api/instructor/runs/${run.id}/name`, { method: 'PUT', token, data: { name: 'Section K32 Quiz' } });
  assert.equal(renamed.payload.data.name, 'Section K32 Quiz');
  assert.equal((await call(`/api/instructor/runs/${run.id}/results`, { token })).payload.data.name, 'Section K32 Quiz');
  assert.equal((await call(`/api/instructor/runs/${run.id}/name`, { method: 'PUT', token, data: { name: ' ' } })).response.status, 400);
});

test('faculty class API supports roster CRUD and run assignment', async () => {
  assert.equal((await call('/api/instructor/classes')).response.status, 401);
  const login = await call('/api/instructor/login', { method: 'POST', data: { password: 'demo-instructor' } });
  const token = login.payload.data.token;
  const data = { name: 'Section K32', section: 'K32',
    roster: [{ candidateId: 'K32-101', displayName: 'Fictional Student' }] };
  const created = await call('/api/instructor/classes', { method: 'POST', token, data });
  assert.equal(created.response.status, 201);
  const classId = created.payload.data.id;
  assert.equal((await call('/api/instructor/classes', { token })).payload.data.find(item => item.id === classId).studentCount, 1);
  const edited = await call(`/api/instructor/classes/${classId}`, { method: 'PUT', token,
    data: { name: 'Section K32 Updated', section: 'K32' } });
  assert.equal(edited.payload.data.name, 'Section K32 Updated');
  const run = await call('/api/instructor/runs', { method: 'POST', token, data: {
    examId: 'garden-demo', version: 1, classId, name: 'Class activity', pin: '4321',
    opensAt: new Date(Date.now() - 60000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString()
  } });
  assert.equal(run.response.status, 201);
  assert.equal(run.payload.data.className, 'Section K32 Updated');
  assert.equal(run.payload.data.rosterCount, 1);
  assert.equal((await call(`/api/instructor/classes/${classId}`, { token })).payload.data.roster[0].candidateId, 'K32-101');
  assert.equal((await call(`/api/instructor/classes/${classId}`, { method: 'DELETE' })).response.status, 401);
  assert.equal((await call(`/api/instructor/classes/${classId}`, { method: 'DELETE', token })).response.status, 200);
  assert.equal((await call(`/api/instructor/runs/${run.payload.data.id}/results`, { token })).payload.data.className, 'Section K32 Updated');
});

test('faculty student API enforces authentication and edits individual class rows', async () => {
  const login = await call('/api/instructor/login', { method: 'POST', data: { password: 'demo-instructor' } });
  const token = login.payload.data.token;
  const created = await call('/api/instructor/classes', { method: 'POST', token, data: {
    name: 'Row editing', section: 'K33', roster: [{ candidateId: 'R-001', displayName: 'First Student' }]
  } });
  const classId = created.payload.data.id;
  const path = `/api/instructor/classes/${classId}/students`;
  assert.equal((await call(path, { method: 'POST', data: { candidateId: 'R-002', displayName: 'Second Student' } })).response.status, 401);
  assert.equal((await call(path, { method: 'POST', token, data: { candidateId: 'R-002', displayName: 'Second Student' } })).response.status, 201);
  assert.equal((await call(path, { method: 'POST', token, data: { candidateId: 'R-002', displayName: 'Duplicate' } })).response.status, 409);
  const edited = await call(`${path}/R-002`, { method: 'PUT', token, data: {
    candidateId: 'R-102', displayName: 'Renamed Student', gender: 'F', yearLevel: '2', programShortName: 'BSIT'
  } });
  assert.equal(edited.payload.data.roster.find(item => item.candidateId === 'R-102').programShortName, 'BSIT');
  assert.equal((await call(`${path}/R-002`, { method: 'DELETE', token })).response.status, 404);
  assert.equal((await call(`${path}/R-102`, { method: 'DELETE', token })).payload.data.studentCount, 1);
});

test('instructor can import, validate and publish a new topic package', async () => {
  const login = await call('/api/instructor/login', { method: 'POST', data: { password: 'demo-instructor' } });
  const token = login.payload.data.token;
  const pub = {
    schemaVersion: '1.0', examId: 'navigation-demo', version: 1, title: 'Map Reading', subject: 'Fictional navigation',
    kind: 'activity', difficulty: 'easy',
    settings: { durationMinutes: 30, coreMaxPoints: 10, bonusMaxPoints: 0 },
    missions: [{ id: 'map', title: 'Read the map', maxPoints: 10, activities: [{ id: 'direction', type: 'single_choice',
      prompt: 'Which way is north on a standard map?', publicConfig: { options: [{ id: 'up', label: 'Up' }, { id: 'down', label: 'Down' }] },
      maxPoints: 10, gradingRuleId: 'direction-rule', manualRationale: 'Fictional demonstration item.' }] }]
  };
  const priv = { rules: { 'direction-rule': { type: 'single_choice', criteria: [{ id: 'direction-point', points: 10, answer: 'up' }] } } };
  const created = await call('/api/instructor/assessments', { method: 'POST', data: { public: pub, private: priv }, token });
  assert.equal(created.response.status, 201);
  const library = await call('/api/instructor/assessments', { token });
  assert.equal(library.payload.data.find(item => item.examId === 'navigation-demo').kind, 'activity');
  const checked = await call('/api/instructor/assessments/navigation-demo/1/validate', { method: 'POST', data: {}, token });
  assert.deepEqual(checked.payload.data.errors, []);
  const unapproved = await call('/api/instructor/assessments/navigation-demo/1/publish', { method: 'POST', data: {}, token });
  assert.equal(unapproved.response.status, 400);
  const published = await call('/api/instructor/assessments/navigation-demo/1/publish', { method: 'POST', data: { approved: true }, token });
  assert.equal(published.payload.data.status, 'published');
  const deniedClone = await call('/api/instructor/assessments/navigation-demo/1/clone', { method: 'POST', data: {} });
  assert.equal(deniedClone.response.status, 401);
  const clone = await call('/api/instructor/assessments/navigation-demo/1/clone', { method: 'POST', data: {}, token });
  assert.equal(clone.response.status, 201);
  assert.equal(clone.payload.data.version, 2);
  assert.equal(clone.payload.data.status, 'draft');
});

test('student and faculty endpoints are separate and the panel is removed', async () => {
  const config = await call('/api/config');
  assert.equal(config.payload.data.platformLabel, 'Got It!');
  assert.equal(config.payload.data.platformTagline, 'Gotta Catch Ed All');
  const student = await call('/app/student');
  assert.equal(student.response.status, 200);
  assert.match(student.payload, /Join activity/);
  assert.match(student.payload, /Got It!/);
  assert.match(student.payload, /Gotta Catch Ed All/);
  assert.match(student.payload, /id="continue-mission"/);
  assert.match(student.payload, /id="completion-panel"/);
  assert.doesNotMatch(student.payload, /<button[^>]*>Instructor<\/button>/i);
  assert.doesNotMatch(student.payload, /<button[^>]*>Panel review<\/button>/i);
  assert.doesNotMatch(student.payload, /href="\/app\/(faculty|panel)"/i);
  assert.doesNotMatch(student.payload, /Answer key/i);
  assert.match(student.payload, /collapsible-reference/);

  const root = await call('/');
  assert.equal(root.response.status, 200);
  assert.match(root.payload, /Join activity/);
  assert.doesNotMatch(root.payload, /href="\/app\/(faculty|panel)"/i);

  const faculty = await call('/app/faculty');
  assert.equal(faculty.response.status, 200);
  assert.match(faculty.payload, /Got It!/);
  assert.match(faculty.payload, /Gotta Catch Ed All/);
  assert.match(faculty.payload, /Faculty Studio/);
  assert.match(faculty.payload, /id="ai-difficulty"/);
  assert.match(faculty.payload, /id="ai-questions"/);
  assert.match(faculty.payload, /Package JSON/);
  assert.match(faculty.payload, /Answer key \(faculty only\)/);
  assert.match(faculty.payload, /aria-label="Faculty workflow"/);
  assert.match(faculty.payload, /id="proctor-access"/);
  for (const step of ['exams', 'rules', 'sources', 'review', 'classes', 'run', 'results'])
    assert.match(faculty.payload, new RegExp(`data-step="${step}"`));

  const panel = await call('/app/panel');
  assert.equal(panel.response.status, 404);
  assert.equal((await call('/panel.html')).response.status, 404);
  const proctor = await call('/app/proctor');
  assert.equal(proctor.response.status, 200);
  assert.match(proctor.payload, /Got It!/);
  assert.match(proctor.payload, /Proctor sign in/);
  assert.doesNotMatch(proctor.payload, /Answer key|Faculty workflow/);
});

test('faculty-issued proctor codes allow only read-only monitoring of their run', async () => {
  const instructor = store.loginInstructor('demo-instructor', 'demo-instructor').token;
  const runs = (await call('/api/instructor/runs', { token: instructor })).payload.data;
  const runId = runs[0].id;
  const accessPath = `/api/instructor/runs/${runId}/proctor-access`;
  assert.equal((await call(accessPath)).response.status, 401);
  const issued = await call(accessPath, { method: 'POST', token: instructor });
  assert.equal(issued.response.status, 200);
  const code = issued.payload.data.code;
  assert.ok(code.length >= 20);
  assert.equal((await call(accessPath, { token: instructor })).payload.data.code, undefined);
  assert.equal((await call('/api/proctor/run')).response.status, 401);
  const joined = await call('/api/auth/proctor/join', { method: 'POST', data: { runId, code } });
  assert.equal(joined.response.status, 200);
  const proctor = joined.payload.data.token;
  const overview = await call('/api/proctor/run', { token: proctor });
  assert.equal(overview.payload.data.runId, runId);
  assert.ok(Array.isArray(overview.payload.data.rows));
  assert.doesNotMatch(JSON.stringify(overview.payload.data), /"score"|"answer"|"private"|"responseJson"/);
  assert.equal((await call('/api/instructor/runs', { token: proctor })).response.status, 401);
  assert.equal((await call('/api/me/session', { token: proctor })).response.status, 401);
  assert.equal((await call(accessPath, { method: 'DELETE', token: proctor })).response.status, 401);
  const replacement = await call(accessPath, { method: 'POST', token: instructor });
  assert.notEqual(replacement.payload.data.code, code);
  assert.equal((await call('/api/proctor/run', { token: proctor })).response.status, 401);
  assert.equal((await call('/api/auth/proctor/join', { method: 'POST', data: { runId, code } })).response.status, 401);
  const current = (await call('/api/auth/proctor/join', { method: 'POST', data: {
    runId, code: replacement.payload.data.code } })).payload.data.token;
  assert.equal((await call('/api/proctor/run', { token: current })).response.status, 200);
  assert.equal((await call(accessPath, { method: 'DELETE', token: instructor })).response.status, 200);
  assert.equal((await call('/api/proctor/run', { token: current })).response.status, 401);
});

test('AI draft intake is faculty-only and queues its source for human review', async () => {
  const source = { filename: 'topic.txt', content: 'Section 1: Search filters table rows before paging. The remaining matches are then divided into pages.' };
  const design = { missions: [{ title: 'Filter first', activities: [{ type: 'true_false',
    prompt: 'Search runs before pagination in this table workflow.', answer: true,
    evidenceQuote: 'Search filters table rows before paging. The remaining matches are then divided into pages.', location: 'Section 1' }] }] };
  const draft = buildGeneratedPackage({ title: 'Search Workflow', subject: 'Table search', durationMinutes: 20, missionCount: 1, source }, design);
  const path = '/api/instructor/ai/draft';
  assert.equal((await call(path, { method: 'POST', data: { ...draft, source } })).response.status, 401);
  const login = await call('/api/instructor/login', { method: 'POST', data: { password: 'demo-instructor' } });
  const token = login.payload.data.token;
  const created = await call(path, { method: 'POST', token, data: { ...draft, source } });
  assert.equal(created.response.status, 201);
  const { examId, version } = created.payload.data;
  const sources = (await call(`/api/instructor/exams/${examId}/${version}/sources`, { token })).payload.data;
  assert.equal(sources[0].reviewStatus, 'pending_review');
  const validation = (await call(`/api/instructor/exams/${examId}/${version}/validate`, { method: 'POST', token, data: {} })).payload.data;
  assert.deepEqual(validation.errors, []);
  const published = await call(`/api/instructor/exams/${examId}/${version}/publish`, { method: 'POST', token, data: { approved: true } });
  assert.equal(published.payload.data.status, 'published');
  const studentView = await call(`/api/instructor/exams/${examId}/${version}`);
  assert.equal(studentView.response.status, 401);
});

test('approved AI selections save a draft only through the faculty endpoint', async () => {
  const source = { filename: 'selection.txt', content: 'Section 1: Search filters table rows before paging. The remaining matches are then divided into pages.' };
  const question = { type: 'true_false', prompt: 'Does search run before pagination?', answer: true,
    evidenceQuote: 'Search filters table rows before paging. The remaining matches are then divided into pages.', location: 'Section 1' };
  const data = { title: 'Selected Search', subject: 'Table search', durationMinutes: 20, missionCount: 1,
    mode: 'quiz', source, missions: [{ title: 'Filter first', activities: [question,
      { ...question, prompt: 'Can this be approved despite a low source match?', evidenceQuote: '', sourceMatchPercent: 0 }] }] };
  const path = '/api/instructor/ai/approved-draft';
  assert.equal((await call(path, { method: 'POST', data })).response.status, 401);
  const login = await call('/api/instructor/login', { method: 'POST', data: { password: 'demo-instructor' } });
  const token = login.payload.data.token;
  const rejected = await call(path, { method: 'POST', token, data: { ...data, missions: [{ title: 'Empty', activities: [] }] } });
  assert.equal(rejected.response.status, 422);
  const created = await call(path, { method: 'POST', token, data });
  assert.equal(created.response.status, 201);
  const { examId, version } = created.payload.data;
  const detail = await call(`/api/instructor/exams/${examId}/${version}`, { token });
  assert.equal(detail.payload.data.public.missions[0].activities.length, 2);
  assert.match(detail.payload.data.public.missions[0].activities[1].manualRationale, /Faculty approved/);
  assert.ok(question.evidenceQuote.startsWith(detail.payload.data.private.evidence[0].quote));
  const sources = await call(`/api/instructor/exams/${examId}/${version}/sources`, { token });
  assert.equal(sources.payload.data[0].reviewStatus, 'pending_review');
});

test('unfinished faculty AI proposals are private and recoverable', async () => {
  const path = '/api/instructor/ai/proposal';
  assert.equal((await call(path)).response.status, 401);
  const login = await call('/api/instructor/login', { method: 'POST', data: { password: 'demo-instructor' } });
  const token = login.payload.data.token;
  assert.equal((await call(path, { token })).payload.data, null);
  const data = { input: { source: { filename: 'lesson.txt', content: 'A focused fictional source.' } },
    proposal: { design: { missions: [{ title: 'First', activities: [] }] } }, selected: ['0:0'] };
  assert.equal((await call(path, { method: 'PUT', token, data })).payload.data.saved, true);
  assert.deepEqual((await call(path, { token })).payload.data, data);
  assert.equal((await call(path, { method: 'DELETE', token })).payload.data.deleted, true);
  assert.equal((await call(path, { token })).payload.data, null);
});

test('faculty can archive and restore a draft but students cannot', async () => {
  const login = await call('/api/instructor/login', { method: 'POST', data: { password: 'demo-instructor' } });
  const token = login.payload.data.token;
  const pub = { schemaVersion: '1.0', examId: 'archive-sample', version: 1, title: 'Unpublished sample',
    subject: 'Fictional', settings: { durationMinutes: 20, coreMaxPoints: 10, bonusMaxPoints: 0 },
    missions: [{ id: 'one', title: 'One', maxPoints: 10, activities: [{ id: 'q1', type: 'true_false',
      prompt: 'Is this a test?', publicConfig: {}, maxPoints: 10, gradingRuleId: 'rule-q1',
      manualRationale: 'This is a fictional test fixture.' }] }] };
  const priv = { rules: { 'rule-q1': { type: 'true_false', criteria: [{ id: 'c1', points: 10, answer: true }] } } };
  assert.equal((await call('/api/instructor/exams', { method: 'POST', token, data: { public: pub, private: priv } })).response.status, 201);
  const path = '/api/instructor/exams/archive-sample/1/archive';
  assert.equal((await call(path, { method: 'POST' })).response.status, 401);
  assert.equal((await call(path, { method: 'POST', token })).response.status, 200);
  assert.ok((await call('/api/instructor/exams', { token })).payload.data.find(x => x.examId === 'archive-sample').archivedAt);
  assert.equal((await call('/api/instructor/exams/archive-sample/1/restore', { method: 'POST', token })).response.status, 200);
  assert.equal((await call('/api/instructor/exams', { token })).payload.data.find(x => x.examId === 'archive-sample').archivedAt, null);
});

test('faculty material intake extracts PowerPoint slide text before source review', async () => {
  const bytes = zipSync({ 'ppt/slides/slide3.xml': strToU8('<a:p><a:r><a:t>Search filters records before paging.</a:t></a:r></a:p>') });
  const data = { filename: 'lesson.pptx', base64: Buffer.from(bytes).toString('base64') };
  assert.equal((await call('/api/instructor/materials/extract', { method: 'POST', data })).response.status, 401);
  const login = await call('/api/instructor/login', { method: 'POST', data: { password: 'demo-instructor' } });
  const extracted = await call('/api/instructor/materials/extract', { method: 'POST', data, token: login.payload.data.token });
  assert.equal(extracted.response.status, 200);
  assert.equal(extracted.payload.data.filename, 'lesson.pptx');
  assert.equal(extracted.payload.data.content, '# Slide 3\nSearch filters records before paging.');
});

test('question shuffle stays fixed and faculty can review and override a finished answer', async () => {
  const token = store.loginInstructor('demo-instructor', 'demo-instructor').token;
  const created = await call('/api/instructor/runs', { method: 'POST', token, data: {
    examId: 'archives-demo', version: 1, name: 'Shuffled review', pin: '4321',
    feedbackMode: 'graded', shuffleQuestions: true,
    opensAt: new Date(Date.now() - 60_000).toISOString(),
    closesAt: new Date(Date.now() + 3600_000).toISOString(),
    roster: [{ candidateId: 'S-001', displayName: 'Fictional Student', section: 'Demo' }]
  } });
  assert.equal(created.response.status, 201);
  const runId = created.payload.data.id;
  assert.equal(created.payload.data.shuffleQuestions, true);
  assert.equal((await call('/api/instructor/runs', { token })).payload.data.find(run => run.id === runId).shuffleQuestions, true);
  const credentials = { runId, candidateId: 'S-001', pin: '4321' };
  const joined = (await call('/api/auth/student/join', { method: 'POST', data: credentials })).payload.data;
  const missionId = joined.session.order[0].id;
  const path = `/api/me/missions/${missionId}`;
  const firstView = (await call(path, { token: joined.token })).payload.data;
  const ids = firstView.activities.map(activity => activity.id);
  const original = store.getExam('archives-demo', 1).public.missions.find(mission => mission.id === missionId);
  assert.deepEqual(new Set(ids), new Set(original.activities.map(activity => activity.id)));
  const resumed = (await call('/api/auth/student/join', { method: 'POST', data: credentials })).payload.data;
  assert.equal(resumed.resumed, true);
  assert.deepEqual((await call(path, { token: resumed.token })).payload.data.activities.map(activity => activity.id), ids);
  const studentToken = resumed.token;
  const activity = firstView.activities[0];
  const submissions = {
    'archive-location': { value: 'b' }, 'archive-fields': { value: ['date', 'accession'] },
    'archive-claim': { value: true }, 'archive-code': { value: 'conservation' },
    'archive-total': { value: 12, unit: 'records' }, 'archive-match': { value: { a: '1998', b: '2006' } }
  };
  const submitted = await call(`/api/me/activities/${activity.id}/submit`, {
    method: 'POST', token: studentToken, data: submissions[activity.id]
  });
  assert.equal(submitted.response.status, 200);
  const reviewPath = `/api/instructor/runs/${runId}/students/S-001`;
  assert.equal((await call(reviewPath)).response.status, 401);
  assert.equal((await call(reviewPath, { token: studentToken })).response.status, 401);
  const liveReview = (await call(reviewPath, { token })).payload.data;
  const liveQuestion = liveReview.questions.find(question => question.id === activity.id);
  assert.deepEqual(liveQuestion.attempts[0].response, submissions[activity.id]);
  assert.ok(liveQuestion.expectedAnswer);
  assert.equal(liveReview.canOverride, false);
  const overridePath = `${reviewPath}/scores/${activity.id}`;
  assert.equal((await call(overridePath, { method: 'PUT', token,
    data: { points: 0, reason: 'Faculty review' } })).response.status, 409);
  await call('/api/me/finalize', { method: 'POST', token: studentToken, data: {} });
  const finishedReview = (await call(reviewPath, { token })).payload.data;
  assert.equal(finishedReview.canOverride, true);
  const question = finishedReview.questions.find(item => item.id === activity.id);
  const replacement = question.automaticPoints === 0 ? question.maxPoints : 0;
  assert.equal((await call(overridePath, { method: 'PUT', token,
    data: { points: question.maxPoints + 1, reason: 'Faculty review' } })).response.status, 400);
  const overridden = (await call(overridePath, { method: 'PUT', token,
    data: { points: replacement, reason: 'Faculty review' } })).payload.data;
  assert.equal(overridden.questions.find(item => item.id === activity.id).override.points, replacement);
  assert.equal(overridden.score, Math.max(0, finishedReview.score - question.automaticPoints + replacement));
  const gradebook = (await call(`/api/instructor/runs/${runId}/results`, { token })).payload.data;
  assert.equal(gradebook.rows[0].score, overridden.score);
  const exportResult = await call(`/api/instructor/runs/${runId}/export.csv`, { token });
  assert.ok(exportResult.payload.includes(`"S-001","Fictional Student","Demo","submitted","${overridden.score}"`));
  const restored = (await call(overridePath, { method: 'DELETE', token })).payload.data;
  assert.equal(restored.score, finishedReview.score);
  assert.equal(restored.questions.find(item => item.id === activity.id).override, null);
  const audit = (await call('/api/instructor/audit', { token })).payload.data;
  assert.ok(audit.some(event => event.action === 'override_question_score' && event.detail.activityId === activity.id));
  assert.ok(audit.some(event => event.action === 'clear_question_score_override' && event.detail.activityId === activity.id));
});
