import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePrompt } from '../public/prompt-code.js';

test('question prompts preserve fenced code and indentation for four languages', () => {
  const samples = [
    ['python', 'def greet(name):\n    return f"Hi, {name}"'],
    ['php', '<?php\n$name = "Ada";\necho $name;'],
    ['sql', 'SELECT name\nFROM students\nWHERE score > 90;'],
    ['javascript', 'const table = new DataTable("#studentTable");']
  ];
  for (const [language, code] of samples) {
    const prompt = `Read the code.\n\n\`\`\`${language}\n${code}\n\`\`\`\n\nWhat happens?`;
    assert.deepEqual(parsePrompt(prompt), [
      { type: 'text', text: 'Read the code.\n\n' },
      { type: 'code', language, text: code },
      { type: 'text', text: '\n\nWhat happens?' }
    ]);
  }
  assert.deepEqual(parsePrompt('Use `print(x)` to display a value.'),
    [{ type: 'text', text: 'Use `print(x)` to display a value.' }]);
});
