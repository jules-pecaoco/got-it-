import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestGrade } from '../src/ai-grading.mjs';
import { validateCodeConfig } from '../public/code-task.js';
import { buildGeneratedPackage } from '../src/ai.mjs';
import { editableQuestion } from '../public/draft-question.js';

const question = { prompt: 'Read price and quantity, then print total.', type: 'code_writing', maxPoints: 10,
  publicConfig: { language: 'python' }, expectedAnswer: 'Multiply price by quantity.',
  attempts: [{ response: { value: 'print(15 * 5)' }, result: 'pending_review' }] };

test('AI grading is bounded, advisory, and does not mutate the reviewed submission', async () => {
  const before = structuredClone(question);
  const result = await suggestGrade(question, { provider: async (prompt, options) => {
    assert.match(prompt, /untrusted DATA/);
    assert.match(prompt, /Do not claim to have executed/);
    assert.match(prompt, /print\(15 \* 5\)/);
    assert.equal(options.outputTokenLimit, 2048);
    return { points: 4, feedback: 'Correct multiplication, but the answer is hardcoded instead of reading input.' };
  } });
  assert.equal(result.points, 4);
  assert.deepEqual(question, before);
});

test('invalid or unbounded model grades are rejected instead of saved or silently clamped', async () => {
  for (const result of [{ points: 11, feedback: 'Too high' }, { points: -1, feedback: 'Negative' },
    { points: 1.5, feedback: 'Not a whole number' }, { points: 5, feedback: '' }, { points: '5', feedback: 'Wrong type' }]) {
    await assert.rejects(suggestGrade(question, { provider: async () => result }), { code: 'AI_GRADING_INVALID' });
  }
});

test('AI grading requires a submitted answer and propagates provider failures', async () => {
  await assert.rejects(suggestGrade({ ...question, attempts: [] }), { code: 'AI_GRADING_INVALID' });
  await assert.rejects(suggestGrade(question, { provider: async () => { throw Object.assign(new Error('quota'), { code: 'AI_RATE_LIMITED' }); } }), { code: 'AI_RATE_LIMITED' });
});

test('AI checking excludes database snapshots from project submissions', async () => {
  await suggestGrade({ ...question, type: 'web_project', attempts: [{ response: { value: { files: { 'index.html': '<h1>Total</h1>' }, database: 'PRIVATE_DATABASE_BYTES' } } }] }, {
    provider: async prompt => { assert.ok(!prompt.includes('PRIVATE_DATABASE_BYTES')); assert.match(prompt, /index.html/); return { points: 5, feedback: 'Static source review only.' }; },
  });
});

test('contextual console samples survive generation and saved-question editing without changing raw input', () => {
  const input = '15\n5\n';
  const output = 'What is the price: What is the quantity: Total Price: 75\n';
  const transcript = 'What is the price: 15\nWhat is the quantity: 5\nTotal Price: 75';
  const source = { filename: 'lesson.txt', content: 'Read a price and quantity and multiply them to calculate the total price. Use descriptive input prompts and label the printed total. Test with zero and positive prices.' };
  const draft = buildGeneratedPackage({ title: 'Order total', subject: 'Python', questionMode: 'coding', programmingLanguage: 'python', kind: 'quiz', durationMinutes: 40, missionCount: 1, questionCount: 1, source }, {
    missions: [{ title: 'Order total', activities: [{ type: 'code_writing', language: 'python', prompt: question.prompt,
      starterCode: '# Write your solution here\n', samples: [{ input, output, transcript }], comparison: { mode: 'whitespace' },
      referenceCode: 'price = int(input("What is the price: "))\nquantity = int(input("What is the quantity: "))\nprint("Total Price:", price * quantity)',
      tests: [{ input, output }, { input: '0\n5\n', output: 'What is the price: What is the quantity: Total Price: 0\n' }], evidenceQuote: source.content, location: 'Source' }] }],
  });
  const activity = draft.public.missions[0].activities[0];
  assert.deepEqual(validateCodeConfig(activity.publicConfig), []);
  assert.equal(activity.publicConfig.samples[0].transcript, transcript);
  assert.equal(editableQuestion(activity, draft.private.rules[activity.gradingRuleId]).samples[0].input, input);
  assert.equal(editableQuestion(activity, draft.private.rules[activity.gradingRuleId]).samples[0].transcript, transcript);
  assert.ok(validateCodeConfig({ ...activity.publicConfig, samples: [{ input, output, transcript: 5 }] }).length);
});
