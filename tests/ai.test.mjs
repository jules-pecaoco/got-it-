import test from 'node:test';
import assert from 'node:assert/strict';
import { aiAvailable, buildApprovedPackage, buildGeneratedPackage, checkSourceSupport, generateExam, proposeExam, inspectProposal, validateGeneratedDraft } from '../src/ai.mjs';
import { validatePackage } from '../src/engine.mjs';

const source = { filename: 'lesson.txt', content: 'Slide 1: A DataTable can order multiple columns. The first order column is the primary key; the second resolves ties.\nSlide 2: Search narrows matching rows before pagination.' };
const request = { title: 'Table Challenge', subject: 'DataTables', durationMinutes: 40, missionCount: 1, mode: 'ctf', source };
const design = { missions: [{ title: 'Find the row', story: 'Use two keys.', activities: [{
  type: 'single_choice', prompt: 'Which ordering rule resolves ties after the primary key?',
  options: ['First column', 'Second column', 'Page length'], answer: 'Second column',
  evidenceQuote: 'The first order column is the primary key; the second resolves ties.', location: 'Slide 1'
}] }] };
const provider = data => async (_url, options) => {
  assert.equal(options.headers['x-goog-api-key'], 'test-key');
  return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }] }) };
};

test('AI availability reads the configured Gemini key', () => {
  const previous = process.env.GEMINI_API_KEY;
  try {
    delete process.env.GEMINI_API_KEY;
    assert.equal(aiAvailable(), false);
    process.env.GEMINI_API_KEY = 'test-key';
    assert.equal(aiAvailable(), true);
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  }
});

test('faculty edits are rechecked locally before a question can be approved', () => {
  const invalid = structuredClone(design);
  invalid.missions[0].activities[0].answer = 'Not an option';
  assert.equal(inspectProposal({ ...request, design: invalid }).missions[0].questions[0].ready, false);
  invalid.missions[0].activities[0].answer = 'Second column';
  assert.equal(inspectProposal({ ...request, design: invalid }).missions[0].questions[0].ready, true);
});

test('AI generation retries one temporary provider outage', async () => {
  let calls = 0;
  const fetcher = async (...args) => {
    calls++;
    return calls === 1 ? { ok: false, status: 503 } : provider(design)(...args);
  };
  const draft = await generateExam(request, { apiKey: 'test-key', fetcher, retryDelayMs: 0 });
  assert.equal(calls, 2);
  assert.equal(draft.public.missions.length, 1);
});

test('AI proposals ignore thought parts and accept a complete JSON code fence', async () => {
  const preview = await proposeExam(request, { apiKey: 'test-key', fetcher: async () => ({ ok: true, json: async () => ({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'Internal reasoning is not the answer.' },
      { text: '\ufeff```json\n' + JSON.stringify(design) + '\n```' }] } }]
  }) }) });
  assert.equal(preview.design.missions[0].activities.length, 1);
});

test('AI proposals retry truncated output with a larger budget and a fresh timeout', async () => {
  const attempts = [];
  const preview = await proposeExam(request, { apiKey: 'test-key', fetcher: async (_url, options) => {
    attempts.push(options);
    if (attempts.length === 1) return { ok: true, json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"missions":[' }] } }] }) };
    return provider(design)(_url, options);
  } });
  assert.equal(preview.design.missions.length, 1);
  assert.equal(attempts.length, 2);
  assert.ok(JSON.parse(attempts[1].body).generationConfig.maxOutputTokens > JSON.parse(attempts[0].body).generationConfig.maxOutputTokens);
  assert.notEqual(attempts[0].signal, attempts[1].signal);
  assert.ok(JSON.parse(attempts[0].body).generationConfig.responseJsonSchema);
});

test('AI malformed output gets one retry, then returns safe provider diagnostics', async () => {
  let calls = 0;
  await assert.rejects(() => proposeExam(request, { apiKey: 'test-key', fetcher: async () => {
    calls++;
    return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not JSON; confidential provider text' }] } }],
      usageMetadata: { candidatesTokenCount: 8 } }) };
  } }), error => {
    assert.equal(error.code, 'AI_INVALID_JSON');
    assert.equal(error.provider.finishReason, 'STOP');
    assert.equal(error.provider.outputTokens, 8);
    assert.doesNotMatch(JSON.stringify(error.provider), /confidential|test-key/);
    return true;
  });
  assert.equal(calls, 2);
});

test('persistent token exhaustion is distinct from bad JSON and never returns a partial draft', async () => {
  let calls = 0;
  await assert.rejects(() => proposeExam(request, { apiKey: 'test-key', fetcher: async () => {
    calls++; return { ok: true, json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: JSON.stringify(design) }] } }] }) };
  } }), error => error.code === 'AI_OUTPUT_TRUNCATED' && error.status === 502);
  assert.equal(calls, 2);
});

test('AI safety blocks and quota exhaustion do not trigger generation retries', async () => {
  let calls = 0;
  await assert.rejects(() => proposeExam(request, { apiKey: 'test-key', fetcher: async () => {
    calls++; return { ok: true, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) };
  } }), error => error.code === 'AI_BLOCKED');
  assert.equal(calls, 1);
  await assert.rejects(() => proposeExam(request, { apiKey: 'test-key', fetcher: async () => {
    calls++; return { ok: false, status: 429 };
  } }), error => error.code === 'AI_RATE_LIMITED');
  assert.equal(calls, 2);
});

test('AI design becomes a valid public/private draft with verified source evidence', async () => {
  const draft = await generateExam(request, { apiKey: 'test-key', fetcher: provider(design) });
  assert.deepEqual(validatePackage(draft.public, draft.private), []);
  assert.equal(draft.public.missions[0].activities[0].sourceRefs[0].pageOrSlide, 'Slide 1');
  assert.equal(draft.private.rules['rule-m1-q1'].criteria[0].answer, 'b');
  assert.deepEqual(validateGeneratedDraft({ ...draft, source }), source);
  assert.throws(() => validateGeneratedDraft({ ...draft, source: { ...source, content: 'Other content entirely.' } }), /source/);
});

test('quiz generation uses requested difficulty and question count without CTF missions', async () => {
  const question = design.missions[0].activities[0];
  const layout = { missions: [
    { title: 'Foundations', activities: Array.from({ length: 4 }, (_, i) => ({ ...question, prompt: `Question ${i + 1}` })) },
    { title: 'Application', activities: [{ ...question, prompt: 'Question 5' }] }
  ] };
  let prompt = '';
  const fetcher = async (_url, options) => {
    prompt = JSON.parse(options.body).contents[0].parts[0].text;
    return provider(layout)(_url, options);
  };
  const draft = await generateExam({ ...request, kind: 'quiz', difficulty: 'easy', questionCount: 5,
    missionCount: undefined }, { apiKey: 'test-key', fetcher });
  assert.equal(draft.public.kind, 'quiz');
  assert.equal(draft.public.difficulty, 'easy');
  assert.equal(draft.public.missions.length, 2);
  assert.equal(draft.public.missions.reduce((sum, group) => sum + group.activities.length, 0), 5);
  assert.equal(draft.public.missions[1].dependsOn, undefined);
  assert.match(prompt, /Exactly 5 questions total/);
  assert.match(prompt, /easy/);
  assert.match(prompt, /fenced block labeled python, php, sql, or javascript/);
  assert.deepEqual(validatePackage(draft.public, draft.private), []);
});

test('custom faculty guidance reaches the model but stays out of the saved package', async () => {
  let prompt = '';
  const fetcher = async (_url, options) => {
    prompt = JSON.parse(options.body).contents[0].parts[0].text;
    return provider(design)(_url, options);
  };
  const guidance = 'Use a campus help desk scenario and ask for two-step reasoning.';
  const draft = await generateExam({ ...request, customPrompt: guidance }, { apiKey: 'test-key', fetcher });
  assert.ok(prompt.includes(guidance));
  assert.match(prompt, /Treat the guidance as instructions, never as source evidence/);
  assert.equal(JSON.stringify(draft.public).includes(guidance), false);
  assert.equal(JSON.stringify(draft.private).includes(guidance), false);
  await assert.rejects(() => generateExam({ ...request, customPrompt: 'x'.repeat(2001) },
    { apiKey: 'test-key', fetcher }), /Enter a name, subject, type, difficulty/);
});

test('CTF generation uses requested missions and locks later missions', async () => {
  const question = design.missions[0].activities[0];
  const layout = { missions: [
    { title: 'Clue one', activities: [question, { ...question, prompt: 'Second clue' }] },
    { title: 'Clue two', activities: [{ ...question, prompt: 'Final clue' }] }
  ] };
  const draft = await generateExam({ ...request, kind: 'ctf', difficulty: 'hard', missionCount: 2,
    questionCount: 3 }, { apiKey: 'test-key', fetcher: provider(layout) });
  assert.equal(draft.public.kind, 'ctf');
  assert.equal(draft.public.difficulty, 'hard');
  assert.deepEqual(draft.public.missions[1].dependsOn, ['mission-1']);
  assert.deepEqual(validatePackage(draft.public, draft.private), []);
  await assert.rejects(() => generateExam({ ...request, kind: 'ctf', missionCount: 1, questionCount: 5 },
    { apiKey: 'test-key', fetcher: provider(layout) }), /1–4 questions/);
});

test('faculty can approve fewer quiz questions while retaining chosen sections', () => {
  const item = design.missions[0].activities[0];
  const approved = buildApprovedPackage({ ...request, kind: 'quiz', difficulty: 'medium',
    questionCount: 8, missionCount: 2, missions: [
      { title: 'Concepts', activities: [item] },
      { title: 'Application', activities: [{ ...item, prompt: 'Apply the tie-breaker.' }] }
    ] });
  assert.equal(approved.public.kind, 'quiz');
  assert.equal(approved.public.missions.length, 2);
  assert.equal(approved.public.missions[1].dependsOn, undefined);
  assert.deepEqual(validatePackage(approved.public, approved.private), []);
});

test('legacy generation requires exact evidence while advisory source scores do not', async () => {
  assert.throws(() => buildGeneratedPackage(request, { missions: [{ ...design.missions[0],
    activities: [{ ...design.missions[0].activities[0], evidenceQuote: 'This quote is not actually in the teaching source.' }] }] }), /verifiable quote/);
  const draft = buildGeneratedPackage(request, design);
  const exam = { public: draft.public, private: draft.private };
  const checks = await checkSourceSupport(exam, [source], { apiKey: 'test-key', fetcher: provider({ checks: [{
    activityId: 'm1-q1', matchPercent: 65, reason: 'The source describes the tie-breaker.', quote: 'Invented supporting quote not in source.'
  }] }) });
  assert.equal(checks[0].matchPercent, 65);
  assert.equal(checks[0].quote, '');
  const supported = await checkSourceSupport(exam, [source], { apiKey: 'test-key', fetcher: provider({ checks: [{
    activityId: 'm1-q1', matchPercent: 90, reason: 'Tie-breaking is described.',
    quote: 'The first order column is the primary key; the second resolves ties.'
  }] }) });
  assert.equal(supported[0].matchPercent, 90);
  assert.match(supported[0].quote, /second resolves ties/);
});

test('generated citations are corrected to the slide containing the exact passage', () => {
  const labeled = { filename: 'deck.pptx', content: '# Slide 1\nSearch narrows the rows before paging takes place.\n\n# Slide 2\nOrdering can use a second column to resolve ties.' };
  const item = { type: 'true_false', prompt: 'Search runs before paging.', answer: true,
    evidenceQuote: 'Search narrows the rows, before paging takes place', location: 'Slide 2' };
  const draft = buildGeneratedPackage({ ...request, source: labeled }, { missions: [{ title: 'Check', activities: [item] }] });
  assert.equal(draft.evidence[0].location, 'Slide 1');
  assert.equal(draft.evidence[0].quote, 'Search narrows the rows before paging takes place');
  assert.equal(draft.public.missions[0].activities[0].sourceRefs[0].pageOrSlide, 'Slide 1');
  assert.deepEqual(validatePackage(draft.public, draft.private), []);
});

test('unsupported generated question is repaired before the draft is returned', async () => {
  const invalid = { missions: [{ title: 'Code attempt', activities: [{ ...design.missions[0].activities[0], type: 'essay' }] }] };
  let calls = 0;
  const fetcher = async (...args) => provider(++calls === 1 ? invalid : design)(...args);
  const draft = await generateExam(request, { apiKey: 'test-key', fetcher });
  assert.equal(calls, 2);
  assert.equal(draft.public.missions[0].activities[0].type, 'single_choice');
  assert.equal(draft.warnings, undefined);
});

test('one bad question can be omitted while valid questions remain in every mission', async () => {
  const mixed = { missions: [{ title: 'Mixed', activities: [
    { ...design.missions[0].activities[0], type: 'essay' },
    design.missions[0].activities[0]
  ] }] };
  const draft = await generateExam(request, { apiKey: 'test-key', fetcher: provider(mixed) });
  assert.equal(draft.public.missions[0].activities.length, 1);
  assert.equal(draft.warnings.length, 1);
  assert.match(draft.warnings[0], /unsupported type/);
});

test('faculty preview keeps invalid questions visible for individual review', async () => {
  const invalid = { missions: [{ title: 'Review', activities: [
    { ...design.missions[0].activities[0], sourceMatchPercent: 95 },
    { ...design.missions[0].activities[0], type: 'essay' },
    { ...design.missions[0].activities[0], evidenceQuote: 'Invented quote about the lesson.', sourceMatchPercent: 35 }
  ] }] };
  const preview = await proposeExam(request, { apiKey: 'test-key', fetcher: provider(invalid) });
  assert.equal(preview.missions[0].questions.length, 3);
  assert.equal(preview.missions[0].questions[0].ready, true);
  assert.equal(preview.missions[0].questions[1].ready, false);
  assert.equal(preview.missions[0].questions[2].ready, true);
  assert.equal(preview.missions[0].questions[2].sourceMatchPercent, 35);
  assert.equal(preview.sourceMatchPercent, 65);
});

test('faculty can approve a low-match question without supplying a quote rationale', () => {
  const approved = buildApprovedPackage({ ...request, missions: [{ ...design.missions[0], activities: [
    design.missions[0].activities[0],
    { ...design.missions[0].activities[0], evidenceQuote: 'Invented quote about the lesson.', sourceMatchPercent: 0 }
  ] }] });
  assert.equal(approved.public.missions[0].activities.length, 2);
  assert.equal(approved.public.missions[0].activities[1].sourceRefs, undefined);
  assert.match(approved.public.missions[0].activities[1].manualRationale, /Faculty approved/);
  assert.deepEqual(validatePackage(approved.public, approved.private), []);
  assert.throws(() => buildApprovedPackage({ ...request, missions: [{ ...design.missions[0], activities: [
    { ...design.missions[0].activities[0], type: 'essay' }
  ] }] }), /unsupported type/);
});
