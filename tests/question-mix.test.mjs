import test from 'node:test';
import assert from 'node:assert/strict';
import { questionTypes, validateQuestionMix } from '../public/question-types.js';
import { buildGeneratedPackage, buildApprovedPackage, generateExam, inspectProposal } from '../src/ai.mjs';
import { validatePackage, evaluate, inspectRows } from '../src/engine.mjs';
import { answerText } from '../public/answer-key.js';
import { parseTableCode } from '../public/table-code.js';

const source = { filename: 'lesson.md', content: 'Search filters matching rows before pagination. Ordering sorts rows by one or two columns. Use the table controls to inspect data. A Python program can read a value and print twice the value. Match each concept to its use.' };
const common = { evidenceQuote: 'Search filters matching rows before pagination.', location: 'Source', prompt: 'Apply the lesson to solve this problem.' };
const table = { columns: [{ id: 'id', label: 'ID' }, { id: 'team', label: 'Team' }, { id: 'score', label: 'Score' }],
  rows: Array.from({ length: 8 }, (_, i) => ({ id: `row${i + 1}`, team: i % 2 ? 'Blue' : "O'Brien", score: i + 1 })), pageLengths: [2, 5, 10] };
const target = { pageLength: 2, pageIndex: 0, globalSearch: '', columnSearch: { team: "O'Brien" }, order: [{ column: 'score', direction: 'desc' }] };
const questions = {
  single_choice: { ...common, type: 'single_choice', options: ['Before paging', 'After paging'], answer: 'Before paging' },
  multiple_choice: { ...common, type: 'multiple_choice', options: ['Search', 'Order', 'Delete'], answer: ['Search', 'Order'] },
  true_false: { ...common, type: 'true_false', answer: true },
  text_entry: { ...common, type: 'text_entry', answer: ['pagination', 'paging'] },
  numeric_entry: { ...common, type: 'numeric_entry', answer: { value: 2, tolerance: 0, unit: '' } },
  matching: { ...common, type: 'matching', pairs: [{ left: 'Search', right: 'Filter matching rows' }, { left: 'Ordering', right: 'Sort rows' }, { left: 'Pagination', right: 'Show a page' }] },
  sequencing: { ...common, type: 'sequencing', options: ['Filter', 'Sort', 'Page'], answer: ['Filter', 'Sort', 'Page'] },
  data_inspection: { ...common, type: 'data_inspection', table, answer: { ...target, pageIndex: 1 } },
  datatable_code: { ...common, type: 'datatable_code', table: { ...table, selector: '#studentTable', scaffold: '// TODO: create a table and apply the requested settings' },
    answer: { ...target, flags: { paging: true, searching: false, ordering: true }, lengthMenu: [2, 5, 10] } },
  code_writing: { ...common, type: 'code_writing', language: 'python', starterCode: '# TODO: read and double', referenceCode: 'print(int(input())*2)',
    samples: [{ input: '2', output: '4' }], comparison: { mode: 'whitespace' }, tests: [{ input: '2', output: '4' }, { input: '-3', output: '-6' }] }
};
const input = { title: 'Varied assessment', subject: 'Programming and tables', kind: 'activity', durationMinutes: 40, questionMode: 'mixed',
  questionCount: 10, questionTypeCounts: Object.fromEntries(questionTypes.map(type => [type.id, 1])), source };
const design = items => ({ missions: Array.from({ length: Math.ceil(items.length / 4) }, (_, index) => ({ title: `Section ${index + 1}`, activities: items.slice(index * 4, index * 4 + 4) })) });
const provider = result => async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }) });

test('all ten types can share an activity or CTF with valid private rules', () => {
  for (const kind of ['activity', 'ctf']) {
    const result = buildGeneratedPackage({ ...input, kind, missionCount: 3 }, design(Object.values(questions)));
    assert.deepEqual(validatePackage(result.public, result.private), []);
    assert.equal(result.public.settings.coreMaxPoints, 100);
    assert.deepEqual(result.public.missions.flatMap(m => m.activities.map(a => a.type)), questionTypes.map(type => type.id));
    assert.doesNotMatch(JSON.stringify(result.public), /referenceCode|"answer"|"pairs"|"criteria"|visible_ids/);
  }
});

test('matching grades each pair independently and rearranges public right-hand choices', () => {
  const result = buildApprovedPackage({ ...input, missions: design([questions.matching]).missions });
  const activity = result.public.missions[0].activities[0], rule = result.private.rules[activity.gradingRuleId];
  assert.equal(activity.publicConfig.right[0].id, 'right2');
  assert.equal(evaluate(activity, rule, { value: { left1: 'right1', left2: 'right2', left3: 'right3' } }).result, 'correct');
  assert.equal(evaluate(activity, rule, { value: { left1: 'right1' } }).result, 'partially_correct');
  assert.equal(rule.criteria.reduce((sum, criterion) => sum + criterion.points, 0), 10);
  assert.match(answerText(activity, rule), /Search: Filter matching rows/);
});

test('generated table targets use server-computed rows and provide a valid reference script, including quotes and flags', () => {
  const result = buildApprovedPackage({ ...input, missions: design([questions.data_inspection, questions.datatable_code]).missions });
  const [inspection, code] = result.public.missions[0].activities;
  const inspectionRule = result.private.rules[inspection.gradingRuleId], codeRule = result.private.rules[code.gradingRuleId];
  assert.equal(evaluate(inspection, inspectionRule, { value: questions.data_inspection.answer }).result, 'correct');
  assert.deepEqual(inspectionRule.criteria.find(c => c.answer.kind === 'visible_ids').answer.value, ['row3', 'row1']);
  const script = answerText(code, codeRule).split('One valid script:\n')[1];
  assert.equal(parseTableCode(script, code.publicConfig).flags.searching, false);
  assert.equal(evaluate(code, codeRule, { value: script }).result, 'correct');
  assert.deepEqual(codeRule.criteria.find(c => c.answer.kind === 'visible_ids').answer.value, ['row8', 'row7']);
  assert.equal(inspectRows(table, { ...target, flags: { paging: false, searching: false, ordering: false } }).visible.length, 8);
  const forged = { ...questions.data_inspection.answer, flags: { paging: false, searching: false, ordering: false } };
  assert.equal(evaluate(inspection, inspectionRule, { value: forged }).result, 'correct');
  assert.ok(code.publicConfig.apiReference.length > 0);
});

test('custom mix enforces requested generation counts, repairs an incorrect mix, and rejects bad requests', async () => {
  const requested = { ...input, questionCount: 4, questionTypeCounts: { single_choice: 2, matching: 1, code_writing: 1 } };
  const good = design([questions.single_choice, questions.single_choice, questions.matching, questions.code_writing]);
  const wrong = design(Array.from({ length: 4 }, () => questions.single_choice));
  assert.throws(() => buildGeneratedPackage(requested, wrong), /wrong question type counts/);
  let calls = 0, prompt;
  const result = await generateExam(requested, { apiKey: 'test-key', fetcher: async (_url, options) => {
    calls++; prompt = JSON.parse(options.body).contents[0].parts[0].text; return provider(calls === 1 ? wrong : good)();
  } });
  assert.equal(calls, 2); assert.match(prompt, /Custom question mix:.*"single_choice":2.*"matching":1.*"code_writing":1/);
  assert.deepEqual(validatePackage(result.public, result.private), []);
  for (const counts of [{ essay: 4 }, { single_choice: 1.5 }, { single_choice: -1 }, {}, { single_choice: 21 }]) {
    assert.ok(validateQuestionMix(counts, 4).length);
    await assert.rejects(() => generateExam({ ...requested, questionTypeCounts: counts }, { apiKey: 'test-key', fetcher: provider(good) }), error => error.code === 'INVALID_AI_REQUEST');
  }
});

test('faculty can freely change generated types, counts, and coding language before approval', () => {
  const edited = design([questions.matching, questions.true_false, { ...questions.code_writing, language: 'javascript', referenceCode: "console.log(Number(require('node:fs').readFileSync(0,'utf8'))*2);" }]);
  const restricted = { ...input, questionMode: 'coding', programmingLanguage: 'python', questionCount: 1, missionCount: 1 };
  assert.ok(inspectProposal({ ...restricted, design: edited }).missions[0].questions.every(question => question.ready));
  const result = buildApprovedPackage({ ...restricted, missions: edited.missions });
  assert.equal(result.public.missions[0].activities.length, 3);
  assert.equal(result.public.missions[0].activities[2].publicConfig.language, 'javascript');
  assert.deepEqual(validatePackage(result.public, result.private), []);
  const invalid = structuredClone(questions.matching); invalid.pairs[1].left = invalid.pairs[0].left;
  assert.throws(() => buildApprovedPackage({ ...input, missions: design([invalid]).missions }), /unique left\/right/);
  const empty = structuredClone(questions.data_inspection); empty.answer.globalSearch = 'absent';
  assert.throws(() => buildApprovedPackage({ ...input, missions: design([empty]).missions }), /at least one visible row/);
});
