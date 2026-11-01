import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSyntax, syntaxLanguages, tokenizeCode } from '../public/code-highlight.js';

const named = (source, language, type) => tokenizeCode(source, language)
  .filter(part => part.type === type).map(part => part.text);

test('syntax colors preserve code text and keep comments and strings intact', () => {
  const samples = [
    ['javascript', 'const table = new DataTable("#studentTable"); // TODO search'],
    ['php', '<?php echo "<b>$name</b>" . $name; // TODO SELECT'],
    ['sql', "select name from students where note = 'SELECT -- text'; -- comment"],
    ['python', 'def search(rows):\n    """SELECT # text"""\n    return rows # TODO']
  ];
  assert.deepEqual(syntaxLanguages.map(([name]) => name), samples.map(([name]) => name));
  for (const [language, source] of samples) {
    assert.equal(tokenizeCode(source, language).map(part => part.text).join(''), source);
    assert.ok(named(source, language, 'comment').length);
    assert.ok(named(source, language, 'string').length);
  }
  assert.deepEqual(named(samples[0][1], 'javascript', 'keyword'), ['const', 'new']);
  assert.deepEqual(named(samples[1][1], 'php', 'variable'), ['$name']);
  assert.deepEqual(named(samples[2][1], 'sql', 'keyword'), ['select', 'from', 'where']);
  assert.deepEqual(named(samples[3][1], 'python', 'keyword'), ['def', 'return']);
  assert.equal(normalizeSyntax('py'), 'python');
  assert.equal(normalizeSyntax('JS'), 'javascript');
  assert.equal(normalizeSyntax('constructor'), 'javascript');
});
