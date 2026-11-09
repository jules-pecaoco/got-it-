import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assignedOrder, evaluate, validatePackage, validatorRegistry } from '../src/engine.mjs';

const fixture = name => ({
  pub: JSON.parse(readFileSync(new URL(`./fixtures/${name}/public-exam.json`, import.meta.url))),
  priv: JSON.parse(readFileSync(new URL(`./fixtures/${name}/private-grading.json`, import.meta.url)))
});
const clone = value => structuredClone(value);

test('two unrelated fictional subjects validate on the same engine', () => {
  assert.deepEqual(validatePackage(...Object.values(fixture('archives'))), []);
  assert.deepEqual(validatePackage(...Object.values(fixture('garden'))), []);
});

test('invalid totals, duplicate IDs, unsupported types, missing rules and cycles block publish', () => {
  const { pub, priv } = fixture('archives');
  const p = clone(pub); p.settings.coreMaxPoints = 99;
  assert.match(validatePackage(p, priv).join(' '), /coreMaxPoints/);
  p.missions[1].activities[0].id = p.missions[0].activities[0].id;
  assert.match(validatePackage(p, priv).join(' '), /duplicated/);
  p.missions[1].activities[0].type = 'arbitrary_code';
  assert.match(validatePackage(p, priv).join(' '), /unsupported/);
  const q = clone(priv); delete q.rules['r-location'];
  assert.match(validatePackage(pub, q).join(' '), /private grading/);
  const cyclic = clone(pub); cyclic.missions[0].dependsOn = ['report'];
  assert.match(validatePackage(cyclic, priv).join(' '), /cycle/);
});

test('manual rationale or source reference is required', () => {
  const { pub, priv } = fixture('garden');
  delete pub.missions[0].activities[0].manualRationale;
  assert.match(validatePackage(pub, priv).join(' '), /sourceRefs or manualRationale/);
});

test('order shuffles only independent group and keeps fixed-last', () => {
  const { pub } = fixture('archives');
  assert.deepEqual(assignedOrder(pub.missions, () => 0), ['reconcile', 'catalog', 'report']);
  assert.deepEqual(assignedOrder(pub.missions, () => 0.99), ['catalog', 'reconcile', 'report']);
});

test('all seven common activity validators use private rules', () => {
  const { pub, priv } = fixture('archives');
  const activities = pub.missions.flatMap(m => m.activities);
  const responses = {
    'archive-location': { value: 'b' },
    'archive-fields': { value: ['date', 'accession'] },
    'archive-claim': { value: true },
    'archive-code': { value: '  ConSerVation  ' },
    'archive-total': { value: 12, unit: 'records' },
    'archive-match': { value: { a: '1998', b: '2006' } },
    'archive-sequence': { value: ['intake', 'verify', 'file'] }
  };
  for (const a of activities) {
    const result = evaluate(a, priv.rules[a.gradingRuleId], responses[a.id]);
    assert.equal(result.result, 'correct', a.type);
    assert.equal(result.awarded.reduce((sum, c) => sum + c.points, 0), a.maxPoints);
  }
  const match = activities.find(a => a.type === 'matching');
  assert.equal(evaluate(match, priv.rules[match.gradingRuleId], { value: { a: '1998', b: '1998' } }).result, 'partially_correct');
  assert.equal(evaluate(activities[0], priv.rules['r-location'], { value: 'a' }).result, 'incorrect');
});

test('publication rejects browser-incompatible choice, matching and sequence labels and IDs', () => {
  for (const [type, field] of [['single_choice', 'options'], ['multiple_choice', 'options'], ['matching', 'left'], ['matching', 'right'], ['sequencing', 'items']]) {
    for (const [key, value] of [['id', 1], ['id', '  '], ['label', 1], ['label', '\u3000'], ['id', null]]) {
      const { pub, priv } = fixture('archives');
      const activity = pub.missions.flatMap(m => m.activities).find(a => a.type === type);
      const original = activity.publicConfig[field][0].id;
      activity.publicConfig[field][0][key] = value;
      // Matching numeric private IDs must not make numeric public IDs valid.
      if (key === 'id') for (const criterion of priv.rules[activity.gradingRuleId].criteria) {
        if (type === 'single_choice' && criterion.answer === original) criterion.answer = value;
        if (type === 'multiple_choice' || type === 'sequencing') criterion.answer = criterion.answer.map(id => id === original ? value : id);
        if (type === 'matching') criterion.answer[field] = criterion.answer[field] === original ? value : criterion.answer[field];
      }
      assert.match(validatePackage(pub, priv).join(' '), /nonblank string id and label/, `${type}.${field}.${key}=${value}`);
    }
  }
});

test('publication rejects normalized blank text and incomplete or invalid answer mappings', () => {
  const cases = [
    ['text_entry', (_a, rule) => { rule.criteria[0].answer = ['\u3000\t\n']; }, /nonblank normalized/],
    ['matching', (a) => { a.publicConfig.left[1].id = a.publicConfig.left[0].id; }, /duplicate ID/],
    ['matching', (_a, rule) => { rule.criteria[1].answer.left = rule.criteria[0].answer.left; }, /distinct criterion/],
    ['matching', (_a, rule) => { rule.criteria[0].answer.right = 'missing'; }, /invalid label/],
    ['sequencing', (_a, rule) => { rule.criteria[0].answer = ['intake', 'intake', 'file']; }, /each public item once/],
    ['multiple_choice', (_a, rule) => { rule.criteria[0].answer = ['missing']; }, /option answer/]
  ];
  for (const [type, mutate, expected] of cases) {
    const { pub, priv } = fixture('archives');
    const a = pub.missions.flatMap(m => m.activities).find(a => a.type === type);
    mutate(a, priv.rules[a.gradingRuleId]);
    assert.match(validatePackage(pub, priv).join(' '), expected);
  }
});

test('malformed package shapes return actionable validation errors without throwing', () => {
  const cases = [
    [(p) => { p.missions = [null]; }, /missions\[0\]/],
    [(p) => { p.missions = [[]]; }, /missions\[0\]/],
    [(p) => { p.missions[0].activities = [null]; }, /activities\[0\]/],
    [(_p, q) => { q.rules['r-location'].criteria = [null]; }, /rules.r-location.criteria\[0\]/],
    [(_p, q) => { q.rules['r-location'].criteria = [[]]; }, /criteria\[0\]/],
    [(p) => { p.settings = []; }, /settings/],
    [(p) => { p.settings.durationMinutes = { toString: null }; p.missions[0].retryPolicy = { maxRetries: null, pointPenalty: 0, timePenaltySeconds: 0 }; }, /durationMinutes/],
    [(_p, q) => { q.rules = []; }, /rules/],
    [(p) => { p.missions[0].activities[0].publicConfig = []; }, /publicConfig/],
    [(p) => { p.missions[0].activities[0].publicConfig.options = [null, null]; }, /options\[0\]/],
    [(p) => { p.missions[0].id = { toString: null }; }, /string ID/],
    [(p) => { p.missions[0].maxPoints = { toString: null }; }, /maxPoints/],
    [(p) => { p.missions[0].dependsOn = [{ toString: null }]; }, /dependsOn/],
    [(p) => { p.missions[0].activities[0].sourceRefs = [null]; }, /source reference/],
    [(p) => { p.loop = p; }, /finite JSON/],
    [(p) => { p.extra = Array(40).fill(null).reduce(value => ({ next: value }), null); }, /depth/],
    [(p) => { p.extra = Infinity; }, /finite JSON/]
  ];
  for (const [mutate, expected] of cases) {
    const { pub, priv } = fixture('archives');
    mutate(pub, priv);
    assert.match(validatePackage(pub, priv).join(' '), expected);
  }
  assert.match(validatePackage([], {}).join(' '), /package objects/);
});

test('table validation safely rejects malformed columns, rows, criteria and target states', () => {
  const cases = [
    [(a) => { a.publicConfig.columns = [null, null]; }, /columns/],
    [(a) => { a.publicConfig.rows = [null, null, null, null, null, null]; }, /rows/],
    [(a) => { a.publicConfig.pageLengths = 'five'; }, /pageLengths/],
    [(_a, rule) => { rule.criteria[0].answer = null; }, /answer object/],
    [(_a, rule) => { rule.criteria[0].answer.kind = { toString: null }; }, /string kind/],
    [(_a, rule) => { rule.criteria.find(c => c.answer.kind === 'order').answer.value = [null]; }, /target state/]
  ];
  for (const [mutate, expected] of cases) {
    const { pub, priv } = fixture('week13');
    const a = pub.missions.flatMap(m => m.activities).find(a => a.type === 'data_inspection');
    mutate(a, priv.rules[a.gradingRuleId]);
    assert.match(validatePackage(pub, priv).join(' '), expected);
  }
  const { pub, priv } = fixture('week13');
  const rule = Object.values(priv.rules).find(rule => rule.criteria.some(c => c.answer?.kind === 'column_search'));
  rule.criteria.find(c => c.answer.kind === 'column_search').answer.value.column = { toString: null };
  assert.match(validatePackage(pub, priv).join(' '), /valid column/);
});

test('publication enforces the 200-question limit before traversing dependency graphs', () => {
  const { pub, priv } = fixture('garden');
  pub.missions = Array.from({ length: 201 }, (_, index) => ({ ...pub.missions[0], id: `mission-${index}` }));
  assert.match(validatePackage(pub, priv).join(' '), /at most 200/);
});

test('table object property order earns the full eight points while sequence array order remains significant', () => {
  const { pub, priv } = fixture('week13');
  const a = pub.missions.flatMap(m => m.activities).find(a => a.type === 'data_inspection');
  const rule = priv.rules[a.gradingRuleId];
  const answer = kind => rule.criteria.find(c => c.answer.kind === kind)?.answer.value;
  const order = clone(answer('order'));
  rule.criteria.find(c => c.answer.kind === 'order').answer.value = order.map(({ column, direction }) => ({ direction, column }));
  assert.deepEqual(validatePackage(pub, priv), []);
  const result = evaluate(a, rule, { value: { pageLength: answer('page_length'), globalSearch: answer('global_search'), pageIndex: answer('page_index') ?? 0, columnSearch: {}, order } });
  assert.equal(result.result, 'correct');
  assert.equal(result.awarded.reduce((sum, criterion) => sum + criterion.points, 0), 8);
  const codeActivity = pub.missions.flatMap(m => m.activities).find(a => a.type === 'datatable_code');
  const parsedCodeState = { pageLength: codeActivity.publicConfig.pageLengths[0], globalSearch: '', pageIndex: 0, order, flags: { paging: true, searching: false, ordering: true } };
  assert.equal(validatorRegistry.datatable_code({ parsedCodeState }, { kind: 'flags', value: { ordering: true, searching: false, paging: true } }, codeActivity), true);
  const sequence = fixture('archives');
  const item = sequence.pub.missions.flatMap(m => m.activities).find(a => a.type === 'sequencing');
  const privateRule = sequence.priv.rules[item.gradingRuleId];
  assert.equal(evaluate(item, privateRule, { value: [...privateRule.criteria[0].answer].reverse() }).result, 'incorrect');
});
