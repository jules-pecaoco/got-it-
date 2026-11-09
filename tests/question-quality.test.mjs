import test from 'node:test';
import assert from 'node:assert/strict';
import { questionQualityIssues, minimalGeneratedQuestion } from '../public/question-quality.js';
import { proposeExam } from '../src/ai.mjs';

const source = {
  filename: 'lesson.md',
  content:
    'Search filters matching rows before pagination. Ordering arranges the matching rows by column values. Both operations affect the table view but do not modify the original records.',
};
const request = {
  title: 'Table concepts',
  subject: 'Programming',
  kind: 'quiz',
  questionMode: 'objective',
  questionCount: 1,
  durationMinutes: 20,
  source,
};
const flawed = {
  type: 'single_choice',
  prompt: 'Which operation narrows the records shown?',
  options: [
    'Sort',
    'Paging',
    'Search filters matching rows before pagination and retains only records that match the requested search',
  ],
  answer:
    'Search filters matching rows before pagination and retains only records that match the requested search',
  evidenceQuote: 'Search filters matching rows before pagination.',
  location: 'Source',
};
const fixed = {
  ...flawed,
  options: [
    'Search filters matching rows',
    'Ordering arranges matching rows',
    'Paging divides matching rows',
  ],
  answer: 'Search filters matching rows',
};
const design = (question) => ({ missions: [{ title: 'Table views', activities: [question] }] });
const response = (value) => ({
  ok: true,
  json: async () => ({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }],
  }),
});

test('conspicuous correct-answer length and position-dependent choices are flagged without forcing equal lengths', () => {
  assert.match(questionQualityIssues(flawed).join(' '), /longer/);
  assert.deepEqual(questionQualityIssues(fixed), []);
  assert.match(
    questionQualityIssues({
      ...fixed,
      options: ['All of the above', 'Option A'],
      answer: 'All of the above',
    }).join(' '),
    /position/,
  );
});

test('quality gets one repair; unresolved clues remain visible and editable for faculty', async () => {
  let calls = 0;
  const repaired = await proposeExam(request, {
    apiKey: 'fake-key',
    fetcher: async (_url, options) => {
      calls++;
      if (calls === 2)
        assert.match(
          JSON.parse(options.body).contents[0].parts[0].text,
          /Repair only these quality concerns/,
        );
      return response(design(calls === 1 ? flawed : fixed));
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(repaired.missions[0].questions[0].qualityWarnings, []);
  calls = 0;
  const flagged = await proposeExam(request, {
    apiKey: 'fake-key',
    fetcher: async () => {
      calls++;
      return response(design(flawed));
    },
  });
  assert.equal(calls, 2);
  assert.equal(flagged.missions[0].questions[0].ready, true);
  assert.match(flagged.missions[0].questions[0].qualityWarnings.join(' '), /longer/);
});

test('generated table and web scaffolds omit assessed logic, while private reference and fixture stay intact', () => {
  const table = {
    type: 'datatable_code',
    table: {
      scaffold: 'const table = new DataTable("#studentTable", {pageLength: 5});',
      selector: '#studentTable',
    },
  };
  const minimal = minimalGeneratedQuestion(table);
  assert.match(minimal.table.scaffold, /TODO/);
  assert.doesNotMatch(minimal.table.scaffold, /new DataTable|pageLength/);
  assert.match(table.table.scaffold, /new DataTable/);
  const web = {
    type: 'web_project',
    files: {
      'index.php': '<?php $db->query("SELECT * FROM tasks");',
      'script.js': 'submitTask();',
      'style.css': '.answer { color: red; }',
    },
    seedSql: 'CREATE TABLE tasks(id);',
    expectedHtml: 'Expected static output',
  };
  const starter = minimalGeneratedQuestion(web);
  assert.match(starter.files['index.php'], /^<\?php/);
  assert.doesNotMatch(JSON.stringify(starter.files), /SELECT|submitTask|\.answer/);
  assert.equal(starter.seedSql, web.seedSql);
  assert.equal(starter.expectedHtml, web.expectedHtml);
});

test('numbering is removed consistently from generated sequence labels and private sequence values', () => {
  const value = minimalGeneratedQuestion({
    type: 'sequencing',
    options: ['Step 1: Collect records', '2. Check records'],
    answer: ['Step 1: Collect records', '2. Check records'],
  });
  assert.deepEqual(value.options, ['Collect records', 'Check records']);
  assert.deepEqual(value.answer, ['Collect records', 'Check records']);
});
