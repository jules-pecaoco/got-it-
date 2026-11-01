import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, inspectRows, validatePackage } from '../src/engine.mjs';
import { parseTableCode } from '../public/table-code.js';
import { Store } from '../src/store.mjs';

const base = new URL('../exam-packages/itp255-week13-draft/', import.meta.url);
const pub = JSON.parse(readFileSync(new URL('public-exam.json', base)));
const priv = JSON.parse(readFileSync(new URL('private-grading.json', base)));
const source = readFileSync(new URL('Week_13-2_extracted.md', base), 'utf8');

const targetState = activity => {
  const values = Object.fromEntries(priv.rules[activity.gradingRuleId].criteria.map(c => [c.answer.kind, c.answer.value]));
  return {
    pageLength: values.page_length,
    pageIndex: values.page_index ?? 0,
    globalSearch: values.global_search,
    columnSearch: values.column_search ? { [values.column_search.column]: values.column_search.term } : {},
    order: values.order,
    lengthMenu: values.length_menu
  };
};
const correctCode = activity => {
  const state = targetState(activity);
  const index = id => activity.publicConfig.columns.findIndex(column => column.id === id);
  return `const table = new DataTable('#studentTable', {\n` +
    `  paging: true, searching: true, ordering: true,\n` +
    `  pageLength: ${state.pageLength}, lengthMenu: [${state.lengthMenu.join(', ')}],\n` +
    `  order: [${state.order.map(item => `[${index(item.column)}, '${item.direction}']`).join(', ')}]\n` +
    `});\n` +
    `table.search('${state.globalSearch}').draw();\n` +
    `table.column(${index(Object.keys(state.columnSearch)[0])}).search('${Object.values(state.columnSearch)[0]}').draw();`;
};

test('Week 13 version 7 fits 40 minutes and has retry rules by mission and flag', () => {
  assert.deepEqual(validatePackage(pub, priv), []);
  assert.equal(pub.version, 7);
  assert.equal(pub.settings.durationMinutes, 40);
  assert.equal(pub.settings.coreMaxPoints, 100);
  assert.equal(pub.missions.length, 5);
  assert.equal(pub.missions.filter(m => m.activities[0].type === 'datatable_code').length, 2);
  assert.equal(pub.missions.filter(m => m.activities[0].type === 'data_inspection').length, 3);
  assert.deepEqual(pub.missions.map(m => m.maxPoints), [10, 15, 20, 25, 30]);
  assert.equal(pub.missions.at(-1).fixedLast, true);
  for (const mission of pub.missions) {
    const [table, flag] = mission.activities;
    assert.equal(table.publicConfig.rows.length, 36);
    assert.equal(table.publicConfig.columns.length, 6);
    assert.equal(flag.type, 'text_entry');
    assert.equal(mission.retryPolicy.maxRetries, 2);
    assert.ok(mission.retryPolicy.pointPenalty > 0);
    assert.ok(mission.retryPolicy.timePenaltySeconds > 0);
    assert.deepEqual(flag.retryPolicy, { maxRetries: 2, pointPenalty: 1, timePenaltySeconds: 10 });
    if (table.type === 'datatable_code') {
      assert.match(table.publicConfig.scaffold, /TODO: set the page size/);
      assert.match(table.publicConfig.scaffold, /TODO: search all columns/);
      assert.match(table.publicConfig.scaffold, /TODO: filter the campus column/);
      assert.doesNotMatch(table.publicConfig.scaffold, /pageLength:|\.search\('/);
    }
    assert.deepEqual(table.sourceRefs.map(r => r.file), ['Week_13-2_extracted.md']);
  }
  for (const slide of ['Slide 5', 'Slide 7', 'Slide 9', 'Slide 10', 'Slide 11', 'Slide 13', 'Slide 14', 'Slide 17', 'Slide 18', 'Slide 23'])
    assert.match(source, new RegExp(slide));
});

test('inspection grades the requested page, not a matching first page', () => {
  const activity = pub.missions[2].activities[0];
  const state = targetState(activity);
  assert.equal(state.pageIndex, 1);
  assert.equal(evaluate(activity, priv.rules[activity.gradingRuleId], { value: state }).result, 'correct');
  const firstPage = { ...state, pageIndex: 0 };
  const wrong = evaluate(activity, priv.rules[activity.gradingRuleId], { value: firstPage });
  assert.equal(wrong.result, 'partially_correct');
  assert.equal(wrong.awarded.some(item => item.id === 'page-two-page_index'), false);
  assert.equal(wrong.awarded.some(item => item.id === 'page-two-visible_ids'), false);
  assert.notDeepEqual(inspectRows(activity.publicConfig, state).visible.map(row => row.id),
    inspectRows(activity.publicConfig, firstPage).visible.map(row => row.id));
});

test('both code missions are solvable from the scaffold and reject arbitrary JavaScript', () => {
  for (const mission of pub.missions.filter(m => m.activities[0].type === 'datatable_code')) {
    const activity = mission.activities[0];
    const code = correctCode(activity);
    const state = parseTableCode(code, activity.publicConfig);
    assert.deepEqual(state.order, targetState(activity).order);
    assert.equal(evaluate(activity, priv.rules[activity.gradingRuleId], { value: code }).result, 'correct');
    assert.throws(() => parseTableCode(`${code}\nwindow.alert(1);`, activity.publicConfig));
  }
});

test('published version 7 supports the complete CTF on first attempts', () => {
  const store = new Store(':memory:');
  try {
    store.importDraft(pub, priv);
    const added = store.addSource(pub.examId, pub.version, { filename: 'Week_13-2_extracted.md', content: source });
    assert.deepEqual(store.validate(pub.examId, pub.version), []);
    store.reviewSource(pub.examId, pub.version, added.id, {
      topic: 'DataTables pagination, search and multicolumn ordering',
      learningOutcome: 'Investigate a six-column table and build filtered views from a code scaffold',
      proposedActivityType: 'data_inspection and datatable_code',
      evidence: 'The submitted table state, code and ticket flags match the inspected pages'
    });
    assert.deepEqual(store.validate(pub.examId, pub.version), []);
    store.publish(pub.examId, pub.version);
    const run = store.createRun({ examId: pub.examId, version: pub.version, pin: '4321',
      opensAt: new Date(Date.now() - 1000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString(),
      roster: [{ candidateId: 'TEST-001', displayName: 'Test Candidate', section: 'Test' }] });
    const sid = store.join({ runId: run.id, candidateId: 'TEST-001', pin: '4321' }).session.id;
    let expectedScore = 0;
    for (const [index, mission] of pub.missions.entries()) {
      assert.equal(store.progress(sid)[index].unlocked, true);
      const [table, flag] = mission.activities;
      const value = table.type === 'datatable_code' ? correctCode(table) : targetState(table);
      store.submit(sid, table.id, { value });
      const answer = priv.rules[flag.gradingRuleId].criteria[0].answer[0];
      const scored = store.submit(sid, flag.id, { value: `FLAG{${answer}}` });
      expectedScore += mission.maxPoints;
      assert.equal(scored.score, expectedScore);
      assert.equal(store.missionView(sid, mission.id).activities[1].attemptsRemaining, 2);
      if (index + 1 < pub.missions.length) assert.equal(store.progress(sid)[index + 1].unlocked, true);
    }
    assert.equal(store.score(sid), 100);
  } finally { store.close(); }
});
