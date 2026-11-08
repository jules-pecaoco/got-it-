import { buildTableQuestion } from '../src/generated-tables.mjs';
import { draftSchema } from '../src/ai-provider.mjs';
import { createTableQuestionEditor } from '../public/question-type-editors.js';
import { Store } from '../src/store.mjs';
import { hash } from '../src/engine.mjs';
import { editableQuestion } from '../public/draft-question.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { questionTypes, validateQuestionMix } from '../public/question-types.js';
import { buildGeneratedPackage, buildApprovedPackage, generateExam, proposeExam, inspectProposal, regenerateInvalidQuestions, generationLanguagePlan } from '../src/ai.mjs';
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
  web_project: { ...common, type: 'web_project', projectKind: 'frontend', files: { 'index.html': '<h1>TODO</h1>' }, expectedHtml: '<h1>Table controls</h1>', rubric: ['Working interface'] },
  code_writing: { ...common, type: 'code_writing', language: 'python', starterCode: '# TODO: read and double', referenceCode: 'print(int(input())*2)',
    samples: [{ input: '2', output: '4' }], comparison: { mode: 'whitespace' }, tests: [{ input: '2', output: '4' }, { input: '-3', output: '-6' }] }
};
const input = { title: 'Varied assessment', subject: 'Programming and tables', kind: 'activity', durationMinutes: 40, questionMode: 'mixed',
  questionCount: 11, questionTypeCounts: Object.fromEntries(questionTypes.map(type => [type.id, 1])), source };
const design = items => ({ missions: Array.from({ length: Math.ceil(items.length / 4) }, (_, index) => ({ title: `Section ${index + 1}`, activities: items.slice(index * 4, index * 4 + 4) })) });
const provider = result => async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }) });

test('all supported types can share an activity or CTF with valid private rules', () => {
  for (const kind of ['activity', 'ctf']) {
    const result = buildGeneratedPackage({ ...input, kind, missionCount: 3 }, design(Object.values(questions)));
    assert.deepEqual(validatePackage(result.public, result.private), []);
    assert.equal(result.public.settings.coreMaxPoints, 110);
    assert.deepEqual(result.public.missions.flatMap(m => m.activities.map(a => a.type)), questionTypes.map(type => type.id));
    assert.doesNotMatch(JSON.stringify(result.public), /referenceCode|"answer"|"pairs"|"criteria"|visible_ids/);
  }
});

test('matching grades each pair independently and rearranges public right-hand choices', () => {
  const result = buildApprovedPackage({ ...input, missions: design([questions.matching]).missions });
  const activity = result.public.missions[0].activities[0], rule = result.private.rules[activity.gradingRuleId];
  assert.ok(activity.publicConfig.right.every(item => /^right-[a-f0-9]+$/.test(item.id)));
  assert.equal(evaluate(activity, rule, { value: Object.fromEntries(rule.criteria.map(c => [c.answer.left, c.answer.right])) }).result, 'correct');
  assert.equal(evaluate(activity, rule, { value: { [rule.criteria[0].answer.left]: rule.criteria[0].answer.right } }).result, 'partially_correct');
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

test('saved questions of every type round-trip through the form model without losing grading data', () => {
  const store=new Store(':memory:');
  try {
    const value=buildGeneratedPackage(input,design(Object.values(questions)));
    store.importDraft(value.public,value.private);
    for(const activity of value.public.missions.flatMap(m=>m.activities)){
      const before=store.getExam(value.public.examId,1);
      const current=before.public.missions.flatMap(m=>m.activities).find(a=>a.id===activity.id);
      const rule=before.private.rules[current.gradingRuleId];
      const question={...editableQuestion(current,rule),prompt:current.prompt+' Edited.',points:20};
      const revision=hash(before.public_json+'\n'+before.private_json);
      store.editDraftQuestion(value.public.examId,1,activity.id,{question,revision});
      const after=store.getExam(value.public.examId,1);
      assert.deepEqual(validatePackage(after.public,after.private),[]);
      const edited=after.public.missions.flatMap(m=>m.activities).find(a=>a.id===activity.id);
      assert.equal(edited.prompt,question.prompt);
      assert.equal(edited.maxPoints,20);
      assert.equal(edited.id,activity.id);
      assert.equal(edited.gradingRuleId,activity.gradingRuleId);
      assert.deepEqual(edited.publicConfig,current.publicConfig);
      assert.deepEqual(after.private.rules[edited.gradingRuleId].criteria.map(c=>c.answer),rule.criteria.map(c=>c.answer));
      assert.throws(()=>store.editDraftQuestion(value.public.examId,1,activity.id,{question,revision}),e=>e.code==='DRAFT_CHANGED');
    }
    store.publish(value.public.examId,1);
    const after=store.getExam(value.public.examId,1),activity=after.public.missions[0].activities[0];
    assert.throws(()=>store.editDraftQuestion(value.public.examId,1,activity.id,{question:{...editableQuestion(activity,after.private.rules[activity.gradingRuleId]),points:20},revision:hash(after.public_json+'\n'+after.private_json)}),e=>e.code==='IMMUTABLE_VERSION');
  }finally{store.close();}
});


test('faculty preview repairs an incorrect initial mix and exposes unresolved generation warnings', async () => {
  const requested = { ...input, questionCount: 2, questionTypeCounts: { single_choice: 1, true_false: 1 } };
  let calls = 0;
  const preview = await proposeExam(requested, { apiKey: 'test-key', fetcher: async () => provider(++calls === 1
    ? design([questions.single_choice, questions.single_choice]) : design([questions.single_choice, questions.true_false]))() });
  assert.equal(calls, 2);
  assert.deepEqual(preview.design.missions[0].activities.map(q => q.type), ['single_choice', 'true_false']);
  assert.equal(preview.warnings, undefined);
  const unresolved = await proposeExam(requested, { apiKey: 'test-key', fetcher: provider(design([questions.single_choice, questions.single_choice])) });
  assert.match(unresolved.warnings[0], /wrong question type counts/);
});

test('selected PHP and SQL languages coexist and missing selected languages are rejected', () => {
  const php = { ...questions.code_writing, language: 'php', referenceCode: '<?php echo 4;', starterCode: '<?php // TODO' };
  const sql = { ...questions.code_writing, language: 'sql', referenceCode: 'SELECT 4;', starterCode: '-- TODO' };
  const requested = { ...input, questionMode: 'coding', programmingLanguage: 'php,sql', questionCount: 2 };
  const result = buildGeneratedPackage(requested, design([php, sql]));
  assert.deepEqual(result.public.missions[0].activities.map(a => a.publicConfig.language), ['php', 'sql']);
  assert.throws(() => buildGeneratedPackage(requested, design([php, php])), /missing the selected sql/);
});

test('duplicate correct choices cannot create an unanswerable multiple-answer question', () => {
  assert.throws(() => buildApprovedPackage({ ...input, missions: design([{ ...questions.multiple_choice, answer: ['Search', 'Search'] }]).missions }), /answer must match/);
});


test('table editor survives malformed AI order and preserves column order and a final empty cell', () => {
  const previous = globalThis.document;
  class Element {
    append() {} prepend() {} addEventListener() {} remove() {}
    set value(value) { this.storedValue = String(value); }
    get value() { return this.storedValue; }
  }
  globalThis.document = { createElement: () => new Element() };
  try {
    for (const order of ['score asc', { column: 'score', direction: 'asc' }, [null]])
      assert.doesNotThrow(() => createTableQuestionEditor({ answer: { order } }));
    const question = structuredClone(questions.data_inspection);
    question.table.columns = [question.table.columns[1], question.table.columns[0], question.table.columns[2]];
    question.table.rows.at(-1).score = '';
    const edited = createTableQuestionEditor(question).value('data_inspection');
    assert.deepEqual(edited.table.columns.map(c => c.id), question.table.columns.map(c => c.id));
    assert.equal(edited.table.rows.at(-1).score, '');
  } finally { globalThis.document = previous; }
});


test('regeneration replaces only selected invalid questions and retains the original type and source', async () => {
  const broken = { ...questions.data_inspection, table: {}, answer: { order: ['asc'] } };
  const original = design([questions.single_choice, broken, broken]);
  let prompt;
  const result = await regenerateInvalidQuestions({ ...input, design: original, targets: [{ missionIndex: 0, questionIndex: 1 }] }, {
    apiKey: 'test-key', fetcher: async (_url, options) => {
      prompt = JSON.parse(options.body).contents[0].parts[0].text;
      return provider(design([questions.data_inspection]))();
    },
  });
  assert.deepEqual(result.design.missions[0].activities[0], original.missions[0].activities[0]);
  assert.deepEqual(result.design.missions[0].activities[2], broken);
  assert.equal(result.missions[0].questions[1].ready, true);
  assert.equal(result.regeneration[0].replaced, true);
  assert.match(prompt, /Validation error to fix:.*table.columns/);
  assert.ok(prompt.includes(source.content));
  assert.deepEqual(original.missions[0].activities[1], broken);
});

test('failed regeneration preserves original questions and refuses valid or duplicate targets', async () => {
  const broken = { ...questions.data_inspection, table: {} };
  const original = design([questions.single_choice, broken]);
  const request = { ...input, design: original, targets: [{ missionIndex: 0, questionIndex: 1 }] };
  const result = await regenerateInvalidQuestions(request, { apiKey: 'test-key', fetcher: provider(design([broken])) });
  assert.equal(result.regeneration[0].replaced, false);
  assert.deepEqual(result.design, original);
  for (const targets of [[{ missionIndex: 0, questionIndex: 0 }], [{ missionIndex: 99, questionIndex: 0 }], [...request.targets, ...request.targets]])
    await assert.rejects(() => regenerateInvalidQuestions({ ...request, targets }), error => error.code === 'INVALID_AI_REQUEST');
});


test('regeneration preserves console language and keeps originals on provider failure', async () => {
  const broken = { ...questions.code_writing, samples: [] };
  const request = { ...input, design: design([broken]), targets: [{ missionIndex: 0, questionIndex: 0 }] };
  const fixed = await regenerateInvalidQuestions(request, { apiKey: 'test-key', fetcher: provider(design([questions.code_writing])) });
  assert.equal(fixed.regeneration[0].replaced, true);
  assert.equal(fixed.design.missions[0].activities[0].language, 'python');
  const unavailable = await regenerateInvalidQuestions(request, { apiKey: 'test-key', fetcher: async () => ({ ok: false, status: 429 }) });
  assert.equal(unavailable.regeneration[0].replaced, false);
  assert.deepEqual(unavailable.design, request.design);
  assert.match(unavailable.regeneration[0].issue, /quota/);
});


test('table validation reports actionable field paths for malformed generated tables', () => {
  const cases = [
    [q => { q.table.rows = q.table.rows.slice(0, 3); }, /table.rows: expected 6–40 rows; received 3/],
    [q => { q.table.rows[0].id = 1; }, /table.rows\[0\].id/],
    [q => { q.table.rows[1].id = q.table.rows[0].id; }, /duplicate row ID/],
    [q => { delete q.table.rows[0].team; }, /table.rows\[0\].team/],
    [q => { q.table.columns[1].id = q.table.columns[0].id; }, /duplicate column ID/],
    [q => { q.answer.order = ['asc']; }, /answer.order\[0\]/],
    [q => { q.answer.order = [null]; }, /answer.order\[0\]/],
    [q => { q.answer.columnSearch = 'team'; }, /answer.columnSearch/],
  ];
  for (const [mutate, expected] of cases) {
    const question = structuredClone(questions.data_inspection); mutate(question);
    assert.throws(() => buildTableQuestion(question), expected);
  }
  const code = structuredClone(questions.datatable_code); code.answer.flags = null;
  assert.throws(() => buildTableQuestion(code), /answer.flags/);
});

test('invalid table previews are repaired automatically and schema constrains rows and sorting', async () => {
  const requested = { ...input, questionCount: 1, questionTypeCounts: { data_inspection: 1 } };
  const broken = structuredClone(questions.data_inspection); broken.answer.order = ['asc'];
  let calls = 0, repairPrompt = '';
  const preview = await proposeExam(requested, { apiKey: 'test-key', fetcher: async (_url, options) => {
    calls++; repairPrompt = JSON.parse(options.body).contents[0].parts[0].text;
    return provider(design([calls === 1 ? broken : questions.data_inspection]))();
  } });
  assert.equal(calls, 2);
  assert.equal(preview.missions[0].questions[0].ready, true);
  assert.match(repairPrompt, /answer.order\[0\]/);
  const tableSchema = draftSchema.properties.missions.items.properties.activities.items.anyOf[0];
  assert.equal(tableSchema.properties.table.properties.rows.minItems, 6);
  assert.deepEqual(tableSchema.properties.table.properties.rows.items.properties.id, { type: 'string' });
  assert.deepEqual(tableSchema.properties.answer.properties.order.items.required, ['column', 'direction']);
});

test('language allocation rejects impossible mixes before using the provider', async () => {
  let calls = 0;
  const requested = { ...input, programmingLanguage: 'php,sql', questionCount: 1, questionTypeCounts: { code_writing: 1 } };
  await assert.rejects(() => proposeExam(requested, { apiKey: 'test-key', fetcher: async () => { calls++; throw new Error('must not call'); } }), /2 selected languages.*only 1/);
  assert.equal(calls, 0);
  assert.deepEqual(generationLanguagePlan({ ...requested, questionCount: 2, questionTypeCounts: { code_writing: 2 } }), [
    { type: 'code_writing', language: 'php', minimumQuestions: 1 },
    { type: 'code_writing', language: 'sql', minimumQuestions: 1 },
  ]);
  assert.deepEqual(generationLanguagePlan({ ...requested, questionTypeCounts: { data_inspection: 1 } }), []);
  assert.deepEqual(generationLanguagePlan({ ...requested, questionMode: 'objective' }), []);
});
