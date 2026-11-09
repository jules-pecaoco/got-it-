import test from 'node:test';
import assert from 'node:assert/strict';
import { regenerateInvalidQuestions } from '../src/ai.mjs';

const source = { filename: 'source.md', content: 'Search filters matching rows before pagination. Ordering arranges the records by column values. These fictional statements explain how table operations affect what the student sees.' };
const question = { type: 'true_false', prompt: 'Searching filters the view.', answer: 'not a boolean', evidenceQuote: source.content, location: 'Source' };
const request = { title: 'Action budget', subject: 'Fictional', durationMinutes: 20, difficulty: 'medium', source,
  design: { missions: Array.from({ length: 5 }, () => ({ title: 'Table concepts', activities: Array.from({ length: 4 }, () => structuredClone(question)) })) },
  targets: Array.from({ length: 20 }, (_, index) => ({ missionIndex: Math.floor(index / 4), questionIndex: index % 4 })) };

test('one regeneration action shares a six-call budget across all targets and preserves originals on pause', async () => {
  let calls = 0;
  const result = await regenerateInvalidQuestions(request, { apiKey: 'fake-key', fetcher: async () => {
    calls++;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ missions: [{ title: 'Replacement', activities: [question] }] }) }] } }] }) };
  } });
  assert.equal(calls, 6);
  assert.equal(result.paused, true);
  assert.ok(result.pendingTargets.length > 0);
  assert.equal(result.budget.calls, 6);
  assert.deepEqual(result.design, request.design);
});

test('payment and quota failures stop the whole regeneration action after one provider call', async () => {
  for (const status of [402, 429]) {
    let calls = 0;
    const result = await regenerateInvalidQuestions(request, { apiKey: 'fake-key', fetcher: async () => { calls++; return { ok: false, status }; } });
    assert.equal(calls, 1);
    assert.equal(result.paused, true);
    assert.equal(result.pendingTargets.length, 20);
    assert.equal(result.regeneration[0].replaced, false);
    assert.deepEqual(result.design, request.design);
  }
});
