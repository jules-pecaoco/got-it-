import { readFileSync, writeFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.DATA_FILE = ':memory:';
process.env.DEMO_MODE = '0';
process.env.INSTRUCTOR_PASSWORD = 'product-audit-only';
process.env.PUBLIC_ORIGIN = 'http://127.0.0.1:3397';
process.env.PREVIEW_ORIGIN = '';
process.env.EXECUTION_ORIGIN = '';
process.env.GEMINI_API_KEY = '';

const { server, store } = await import('../../src/server.mjs');
const { buildGeneratedPackage } = await import('../../src/ai.mjs');
const { webTemplate } = await import('../../tests/fixtures/web-template.mjs');
const source = {
  filename: 'programming.txt',
  content:
    'Read two integers from input and print their sum. Handle zero and negative numbers. Test the solution with different inputs and print only the computed result.',
};
const exam = buildGeneratedPackage(
  {
    title: 'Programming fundamentals',
    subject: 'Computer programming',
    kind: 'quiz',
    questionMode: 'coding',
    programmingLanguage: 'python',
    durationMinutes: 40,
    missionCount: 1,
    questionCount: 1,
    source,
  },
  {
    missions: [
      {
        title: 'Working with input',
        activities: [
          {
            type: 'code_writing',
            language: 'python',
            prompt: 'Read two integers and print their sum. Handle zero and negative values.',
            starterCode: '# Write your solution here\n',
            samples: [{ input: '2 3', output: '5' }],
            comparison: { mode: 'whitespace' },
            referenceCode: 'a, b = map(int, input().split())\nprint(a + b)',
            tests: [
              { input: '2 3', output: '5' },
              { input: '0 -4', output: '-4' },
            ],
            evidenceQuote: 'Read two integers from input and print their sum.',
            location: 'Source',
          },
        ],
      },
    ],
  },
);
store.importDraft(exam.public, exam.private);
store.addSource(exam.public.examId, 1, source);
store.publish(exam.public.examId, 1);
const roster = Array.from({ length: 35 }, (_, i) => ({
  candidateId: `AUDIT-${String(i + 1).padStart(3, '0')}`,
  displayName:
    ['Alex Rivera', 'Sam Lee', 'Jamie Cruz', 'Maria Christina de los Santos Villanueva'][i] ||
    `Student ${i + 1}`,
}));
const classroom = store.createClass({ name: 'BS Information Technology', section: 'IT 1-A', roster });
const run = store.createRun({
  examId: exam.public.examId,
  version: 1,
  classId: classroom.id,
  name: 'Programming fundamentals · IT 1-A',
  pin: '4242',
  feedbackMode: 'graded',
  opensAt: new Date(Date.now() - 60000).toISOString(),
  closesAt: new Date(Date.now() + 86400000).toISOString(),
});
store.issueProctorAccess(run.id, 'audit-proctor');
store.join({ runId: run.id, candidateId: 'AUDIT-002', pin: '4242' });
for (const candidateId of ['AUDIT-003', 'AUDIT-004']) {
  const joined = store.join({ runId: run.id, candidateId, pin: '4242' });
  store.saveDraft(joined.session.id, 'm1-q1', { value: 'a, b = map(int, input().split())\nprint(a + b)' });
  store.finalize(joined.session.id);
}
const draft = structuredClone(exam.public);
draft.examId = 'audit-programming-draft';
draft.title = 'Input and output practice';
store.importDraft(draft, exam.private);
const web = webTemplate('audit-web-draft');
store.importDraft(web.public, web.private);

const objective = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/garden/public-exam.json', import.meta.url)),
);
const privateObjective = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/garden/private-grading.json', import.meta.url)),
);
objective.examId = 'audit-measurements';
objective.title = 'Measurements and observations';
objective.subject = 'Science';
objective.kind = 'quiz';
objective.description = 'Calculate an area and interpret a field observation.';
store.importDraft(objective, privateObjective);
store.publish(objective.examId, 1);
const objectiveRun = store.createRun({
  examId: objective.examId,
  version: 1,
  classId: classroom.id,
  name: 'Measurements · IT 1-A',
  pin: '4242',
  feedbackMode: 'graded',
  opensAt: new Date(Date.now() - 60000).toISOString(),
  closesAt: new Date(Date.now() + 86400000).toISOString(),
});

const manifest = {
  origin: process.env.PUBLIC_ORIGIN,
  runId: run.id,
  objectiveRunId: objectiveRun.id,
  classId: classroom.id,
  database: ':memory:',
  student: 'AUDIT-001',
  pin: '4242',
  password: 'product-audit-only',
  proctorCode: 'audit-proctor',
};
writeFileSync(
  new URL('../../output/playwright/product-audit-manifest.json', import.meta.url),
  JSON.stringify(manifest, null, 2),
);
server.listen(3397, '127.0.0.1', () => console.log(JSON.stringify(manifest)));
