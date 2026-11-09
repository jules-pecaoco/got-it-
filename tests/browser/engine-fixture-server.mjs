// Fictional browser fixture. AI requests never leave this process.
await import('./fixture-server.mjs');
const { store } = await import('../../src/server.mjs');
const { inspectProposal, buildGeneratedPackage } = await import('../../src/ai.mjs');
const { answerText } = await import('../../public/answer-key.js');
const { readFileSync, writeFileSync } = await import('node:fs');
process.env.GEMINI_API_KEY = 'fictional-browser-key';
store.aiJobs.budgetOptions = { maxCalls: 1 };
store.aiJobs.proposer = async (input, { budget, signal }) => {
  budget.claim();
  budget.record({ inputTokens: 1, outputTokens: 1, reasoningTokens: 0, totalTokens: 2, knownTokens: 2, outcome: 'success' });
  await new Promise(resolve => setTimeout(resolve, 80));
  if (signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'AI_ABORTED', status: 499 });
  const batch = Number(/Batch (\d+)/.exec(input.customPrompt)?.[1] ?? 1) - 1;
  const questions = Array.from({ length: input.questionCount }, (_, index) => ({
    type: 'single_choice', prompt: `Question ${batch * 20 + index + 1}: Which operation narrows matching records?`,
    options: ['Search', 'Ordering', 'Paging'], answer: 'Search',
    evidenceQuote: input.source.content, location: 'Source', sourceMatchPercent: 100,
  }));
  return inspectProposal({ ...input, design: { missions: Array.from({ length: Math.ceil(questions.length / 4) }, (_, index) => ({ title: `Section ${batch * 5 + index + 1}`, activities: questions.slice(index * 4, index * 4 + 4) })) } });
};

const manifestPath = new URL('../../output/playwright/product-audit-manifest.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath));
const source = { filename: 'table-browser.md', content: 'DataTables supports search filters and ordering columns before pagination. Search can match words across columns. Column filters narrow specific fields. The table view responds to the requested settings.' };
const item = { type: 'datatable_code', prompt: 'Show Alex records in BSIT, ordered by name, two per page.',
  evidenceQuote: source.content, location: 'Source', table: { selector: '#studentTable', scaffold: '// TODO: configure the table.', pageLengths: [2, 5, 10],
    columns: [{ id: 'name', label: 'Name' }, { id: 'course', label: 'Course' }], rows: [
      { id: 'r1', name: 'Alex Rivera', course: 'BSIT' }, { id: 'r2', name: 'Alex Jones', course: 'BSCS' },
      { id: 'r3', name: 'Alex Quinn', course: 'BSIT' }, { id: 'r4', name: '<b>Alex</b>', course: 'BSIT' },
      { id: 'r5', name: 'Sam Lee', course: 'BSIT' }, { id: 'r6', name: 'Jo Cruz', course: 'BSCS' },
    ] }, answer: { flags: { paging: true, searching: true, ordering: true }, pageLength: 2, pageIndex: 0, lengthMenu: [2, 5, 10], globalSearch: 'Alex BSIT', columnSearch: { course: 'BSIT' }, order: [{ column: 'name', direction: 'asc' }] } };
const tableExam = buildGeneratedPackage({ title: 'Table agreement', subject: 'DataTables', kind: 'quiz', durationMinutes: 40, questionCount: 1, source }, { missions: [{ title: 'Table behavior', activities: [item] }] });
store.importDraft(tableExam.public, tableExam.private);
store.addSource(tableExam.public.examId, 1, source);
store.publish(tableExam.public.examId, 1);
const run = store.createRun({ examId: tableExam.public.examId, version: 1, classId: manifest.classId, name: 'Table agreement', pin: '4242', feedbackMode: 'practice', opensAt: new Date(Date.now() - 60000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString() });
const activity = tableExam.public.missions[0].activities[0];
const script = answerText(activity, tableExam.private.rules[activity.gradingRuleId]).split('One valid script:\n')[1];
writeFileSync(manifestPath, JSON.stringify({ ...manifest, tableRunId: run.id, tableScript: script }, null, 2));
