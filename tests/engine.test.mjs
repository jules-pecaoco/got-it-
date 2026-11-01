import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assignedOrder, evaluate, validatePackage } from '../src/engine.mjs';

const fixture = name => ({
  pub: JSON.parse(readFileSync(new URL(`../examples/${name}/public-exam.json`, import.meta.url))),
  priv: JSON.parse(readFileSync(new URL(`../examples/${name}/private-grading.json`, import.meta.url)))
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
