import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectRows,
  filterTableRows,
  tableCellText,
  datatableColumnTypes,
  compareTableCells,
  datatableSearchMatches,
} from '../public/table-state.js';
import { inspectRows as engineRows, evaluate, validatePackage } from '../src/engine.mjs';
import { buildTableQuestion } from '../src/generated-tables.mjs';

const config = {
  columns: [
    { id: 'name', label: 'Name' },
    { id: 'course', label: 'Course' },
    { id: 'amount', label: 'Amount' },
  ],
  pageLengths: [2, 5, 10],
  rows: [
    { id: 'a', name: 'Alex Rivera', course: 'BSIT', amount: '10' },
    { id: 'b', name: 'Alex Jones', course: 'BSCS', amount: 2 },
    { id: 'c', name: 'José Cruz', course: 'BSIT', amount: null },
    { id: 'd', name: 'Item 2', course: 'BSIT', amount: '' },
    { id: 'e', name: 'Item 10', course: 'BSCS', amount: 2 },
    { id: 'f', name: 'item 1', course: 'BSIT', amount: '1' },
  ],
};
const state = (extra = {}) => ({
  pageLength: 10,
  pageIndex: 0,
  globalSearch: '',
  columnSearch: {},
  order: [{ column: 'name', direction: 'asc' }],
  ...extra,
});
const ids = (result) => result.visible.map((row) => row.id);
const view = (settings, mode = 'datatable', table = config) => inspectRows(table, state(settings), { mode });

test('inspection preserves per-cell normalized terms and natural sorting while DataTables uses smart row search', () => {
  assert.equal(engineRows, inspectRows);
  assert.deepEqual(ids(view({ globalSearch: 'Alex BSIT' }, 'inspection')), []);
  assert.deepEqual(ids(view({ globalSearch: 'Alex BSIT' })), ['a']);
  assert.deepEqual(ids(view({ globalSearch: '  ＡＬＥＸ   ＲＩＶＥＲＡ  ' }, 'inspection')), ['a']);
  assert.deepEqual(ids(view({ globalSearch: 'Item' }, 'inspection')), ['f', 'd', 'e']);
  assert.deepEqual(ids(view({ globalSearch: 'Item' })), ['f', 'e', 'd']);
  assert.deepEqual(ids(inspectRows(config, state({ globalSearch: 'Alex BSIT' }))), []);
});

test('smart search supports independent words, quoted phrases, exclusions, diacritics and literal punctuation', () => {
  assert.deepEqual(ids(view({ globalSearch: 'BSIT Alex' })), ['a']);
  assert.deepEqual(ids(view({ globalSearch: '"Alex Rivera" BSIT' })), ['a']);
  assert.deepEqual(ids(view({ globalSearch: '"Alex BSIT"' })), []);
  assert.deepEqual(ids(view({ globalSearch: '“Alex Rivera” !BSCS' })), ['a']);
  assert.deepEqual(ids(view({ globalSearch: 'Alex !Rivera' })), ['b']);
  assert.deepEqual(ids(view({ globalSearch: 'JOSE' })), ['c']);
  assert.deepEqual(ids(view({ globalSearch: 'JOSE' }, 'inspection')), []);
  assert.equal(datatableSearchMatches(['Price (net): $5.00', 'A+B'], '(net): $5.00 A+B'), true);
  assert.equal(datatableSearchMatches(['literal .*'], '.*'), true);
  assert.equal(datatableSearchMatches(['ordinary text'], '.*'), false);
  assert.equal(datatableSearchMatches(['Alex'], '!a'), true);
  assert.equal(datatableSearchMatches(['Alex'], '!al'), false);
});

test('column smart search remains scoped to its column and combines with global search', () => {
  assert.deepEqual(ids(view({ columnSearch: { name: 'Alex !Rivera' } })), ['b']);
  assert.deepEqual(ids(view({ columnSearch: { name: 'Alex BSIT' } })), []);
  assert.deepEqual(ids(view({ globalSearch: 'Alex', columnSearch: { course: 'BSIT' } })), ['a']);
  assert.deepEqual(ids(view({ globalSearch: 'Alex', columnSearch: { missing: 'no match' } })), ['b', 'a']);
  assert.deepEqual(
    filterTableRows(config, state({ globalSearch: 'Alex' }), { mode: 'datatable' }).map((row) => row.id),
    ['a', 'b'],
  );
});

test('numeric inference and explicit comparison preserve nulls, empty cells, case folding and stable ties', () => {
  assert.deepEqual(Object.fromEntries(datatableColumnTypes(config)), {
    name: 'string',
    course: 'string',
    amount: 'numeric',
  });
  assert.deepEqual(ids(view({ order: [{ column: 'amount', direction: 'asc' }] })), [
    'c',
    'd',
    'f',
    'b',
    'e',
    'a',
  ]);
  assert.deepEqual(ids(view({ order: [{ column: 'amount', direction: 'desc' }] })), [
    'a',
    'b',
    'e',
    'f',
    'c',
    'd',
  ]);
  assert.deepEqual(
    ids(
      view({
        order: [
          { column: 'amount', direction: 'asc' },
          { column: 'name', direction: 'desc' },
        ],
      }),
    ),
    ['c', 'd', 'f', 'e', 'b', 'a'],
  );
  assert.equal(compareTableCells('Item 10', 'Item 2', 'string'), -1);
  assert.equal(compareTableCells('ALex', 'alex', 'string'), 0);
  assert.equal(compareTableCells('10', 2, 'numeric'), 1);
  assert.equal(compareTableCells(null, '', 'numeric'), 0);
  assert.equal(compareTableCells('$1,200', '20', 'numeric'), 1);
  assert.equal(tableCellText(null), '');
  assert.equal(tableCellText(false), 'false');
  const mixed = {
    columns: [{ id: 'cell', label: 'Cell' }],
    rows: [{ cell: 2 }, { cell: '10' }, { cell: 'unknown' }],
  };
  assert.equal(datatableColumnTypes(mixed).get('cell'), 'string');
  assert.equal(
    datatableColumnTypes({ ...mixed, rows: [{ cell: null }, { cell: '' }] }).get('cell'),
    'string',
  );
});

test('flags, filtered counts and page offsets follow the same rules without mutating source rows', () => {
  const original = structuredClone(config);
  const page = view({ globalSearch: 'BSIT', pageLength: 2, pageIndex: 1 });
  assert.equal(page.filteredCount, 4);
  assert.deepEqual(ids(page), ['d', 'c']);
  assert.deepEqual(
    ids(
      view({
        globalSearch: 'impossible',
        columnSearch: { name: 'impossible' },
        flags: { searching: false, ordering: false, paging: false },
      }),
    ),
    ['a', 'b', 'c', 'd', 'e', 'f'],
  );
  assert.deepEqual(ids(view({ flags: { ordering: false }, pageLength: 2, pageIndex: 1 })), ['c', 'd']);
  assert.equal(view({ flags: { paging: false }, pageLength: 2, pageIndex: 5 }).visible.length, 6);
  assert.deepEqual(ids(view({ pageLength: 2, pageIndex: 50 })), []);
  assert.deepEqual(config, original);
});

test('generated DataTables targets and grading share smart search rather than inspection search', () => {
  const target = {
    ...state({ globalSearch: 'Alex BSIT', columnSearch: { course: 'BSIT' }, pageLength: 2 }),
    flags: { paging: true, searching: true, ordering: true },
    lengthMenu: [2, 5, 10],
  };
  const built = buildTableQuestion({
    type: 'datatable_code',
    table: { ...config, selector: '#studentTable', scaffold: '// Write your table setup here.' },
    answer: target,
  });
  assert.deepEqual(built.answers.find((answer) => answer.kind === 'visible_ids').value, ['a']);
  const activity = {
    id: 'table-task',
    type: 'datatable_code',
    prompt: 'Create the requested fictional table view.',
    manualRationale: 'Fictional table example.',
    gradingRuleId: 'rule-table',
    maxPoints: built.answers.length,
    publicConfig: built.config,
  };
  const rule = {
    type: 'datatable_code',
    criteria: built.answers.map((answer, index) => ({ id: `table-${index}`, points: 1, answer })),
  };
  const pub = {
    schemaVersion: '1.0',
    examId: 'table-mode-test',
    version: 1,
    title: 'Synthetic table modes',
    subject: 'Tables',
    settings: { durationMinutes: 30, coreMaxPoints: activity.maxPoints, bonusMaxPoints: 0 },
    missions: [{ id: 'table', title: 'Table', maxPoints: activity.maxPoints, activities: [activity] }],
  };
  assert.deepEqual(validatePackage(pub, { rules: { 'rule-table': rule } }), []);
  const code =
    "const table = new DataTable('#studentTable', {paging:true,searching:true,ordering:true,pageLength:2,lengthMenu:[2,5,10],order:[[0,'asc']]}); table.search('Alex BSIT').draw(); table.column(1).search('BSIT').draw();";
  assert.equal(evaluate(activity, rule, { value: code }).result, 'correct');
});
