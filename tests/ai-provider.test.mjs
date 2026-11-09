import { suggestGrade } from '../src/ai-grading.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { aiProviderCatalog, resolveAiSelection, generateJson, groq, draftSchema, createAiActionBudget, withAiActionBudget, aiUsageSnapshot, aiAttemptSnapshot } from '../src/ai-provider.mjs';
import { proposeExam, regenerateInvalidQuestions } from '../src/ai.mjs';

const answer = { type: 'single_choice', prompt: 'Which operation narrows the matching rows?', options: ['Search', 'Ordering'], answer: 'Search', evidenceQuote: 'Search filters matching rows before pagination.', location: 'Source' };
const design = activities => ({ missions: [{ title: 'Table concepts', activities }] });
const source = { filename: 'lesson.md', content: 'Search filters matching rows before pagination. Ordering sorts rows by column values. A program can calculate a result from input values and display it to the user.' };
const request = { title: 'Tables', subject: 'Programming', kind: 'activity', durationMinutes: 40, questionCount: 1, missionCount: 1, source, aiProvider: 'groq', aiModel: 'openai/gpt-oss-20b' };
const reply = (value, finish = 'stop') => ({ ok: true, json: async () => ({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(value) } }] }) });

test('Groq sends only its selected model, credentials and schema to its fixed endpoint', async () => {
  let payload;
  const result = await generateJson('Draft questions as JSON', { provider: 'groq', model: request.aiModel, apiKey: 'groq-test-secret', responseSchema: draftSchema, fetcher: async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer groq-test-secret');
    assert.equal(options.headers['x-goog-api-key'], undefined);
    payload = JSON.parse(options.body);
    return reply(design([answer]));
  } });
  assert.deepEqual(result, design([answer]));
  assert.equal(payload.model, request.aiModel);
  assert.equal(payload.response_format.type, 'json_schema');
  assert.equal(payload.response_format.json_schema.strict, false);
  assert.deepEqual(payload.response_format.json_schema.schema, draftSchema);
  assert.ok(payload.messages[0].content.includes('untrusted evidence'));
  assert.ok(!JSON.stringify(payload).includes('groq-test-secret'));
});

test('generation repair stays on the manually selected Groq model', async () => {
  let calls = 0;
  const input = { ...request, questionMode: 'mixed', questionTypeCounts: { single_choice: 1 } };
  const preview = await proposeExam(input, { apiKey: 'test-key', fetcher: async (url, options) => {
    assert.ok(url.startsWith('https://api.groq.com/'));
    assert.equal(JSON.parse(options.body).model, request.aiModel);
    return reply(design([{ ...answer, answer: ++calls === 1 ? 'Missing option' : 'Search' }]));
  } });
  assert.equal(calls, 2);
  assert.equal(preview.missions[0].questions[0].ready, true);
});

test('targeted regeneration inherits the chosen Groq model', async () => {
  const broken = { ...answer, answer: 'Invalid option' };
  const original = design([answer, broken]);
  let calls = 0;
  const preview = await regenerateInvalidQuestions({ ...request, design: original, targets: [{ missionIndex: 0, questionIndex: 1 }] }, {
    apiKey: 'test-key', fetcher: async (url, options) => {
      calls++;
      assert.ok(url.startsWith('https://api.groq.com/'));
      assert.equal(JSON.parse(options.body).model, request.aiModel);
      return reply(design([answer]));
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(preview.design.missions[0].activities[0], answer);
  assert.equal(preview.regeneration[0].replaced, true);
});

test('Groq quota and credential failures never trigger provider fallback', async () => {
  for (const [status, code] of [[429, 'AI_RATE_LIMITED'], [401, 'AI_NOT_CONFIGURED']]) {
    let calls = 0;
    await assert.rejects(() => generateJson('JSON draft', { provider: 'groq', apiKey: 'test-key', fetcher: async url => {
      calls++; assert.ok(url.startsWith('https://api.groq.com/')); return { ok: false, status };
    } }), error => error.code === code);
    assert.equal(calls, 1);
  }
  await assert.rejects(() => groq('JSON draft', { apiKey: '' }), error => error.code === 'AI_NOT_CONFIGURED');
});

test('invalid provider/model combinations are rejected before any inference', async () => {
  assert.throws(() => resolveAiSelection({ aiProvider: 'unknown' }), error => error.code === 'INVALID_AI_REQUEST');
  assert.throws(() => resolveAiSelection({ aiProvider: 'groq', aiModel: 'gemini-3.5-flash' }), error => error.code === 'INVALID_AI_REQUEST');
  assert.deepEqual(resolveAiSelection({ aiProvider: 'groq', aiModel: request.aiModel }), { provider: 'groq', model: request.aiModel });
  await assert.rejects(() => proposeExam({ ...request, aiModel: 'invalid' }, { fetcher: () => assert.fail('must not call provider') }), error => error.code === 'INVALID_AI_REQUEST');
  for (const entry of aiProviderCatalog()) assert.deepEqual(Object.keys(entry).sort(), ['available', 'id', 'label', 'models']);
});

test('truncated Groq output retries the same model with a fresh timeout and larger budget', async () => {
  const payloads = [], signals = [];
  const result = await groq('Return JSON', { apiKey: 'test-key', model: request.aiModel, fetcher: async (_url, options) => {
    payloads.push(JSON.parse(options.body)); signals.push(options.signal);
    return reply({ result: true }, payloads.length === 1 ? 'length' : 'stop');
  } });
  assert.deepEqual(result, { result: true });
  assert.equal(payloads.length, 2);
  assert.ok(payloads[1].max_completion_tokens > payloads[0].max_completion_tokens);
  assert.notEqual(signals[0], signals[1]);
  assert.ok(payloads.every(payload => payload.model === request.aiModel));
});


test('Groq retries schema-validation failures without returning raw generated text', async () => {
  let calls = 0;
  const result = await groq('JSON questions', { apiKey: 'test-key', fetcher: async () => {
    if (++calls === 1) return { ok: false, status: 400, json: async () => ({ error: { code: 'json_validate_failed', failed_generation: 'private question data' } }) };
    return reply({ questions: [] });
  } });
  assert.equal(calls, 2);
  assert.deepEqual(result, { questions: [] });
});


test('grade suggestions use the same explicit provider and model as other AI features', async () => {
  const question = { attempts: [{ response: { value: 'answer' } }], prompt: 'Question', type: 'text_entry', publicConfig: {}, expectedAnswer: 'answer', maxPoints: 10 };
  const result = await suggestGrade(question, { selection: { provider: 'groq', model: 'openai/gpt-oss-20b' }, provider: async (_prompt, options) => {
    assert.equal(options.provider, 'groq'); assert.equal(options.model, 'openai/gpt-oss-20b');
    return { points: 8, feedback: 'Mostly correct.' };
  } });
  assert.equal(result.points, 8); assert.equal(result.model, 'openai/gpt-oss-20b');
});


test('payment failures are actionable and never retried or switched', async () => {
  for (const provider of ['gemini', 'groq']) {
    let calls = 0;
    await assert.rejects(() => generateJson('Return JSON', {
      provider, apiKey: 'synthetic-key', fetcher: async () => {
        calls++; return { ok: false, status: 402 };
      },
    }), error => error.code === 'AI_PAYMENT_REQUIRED' && error.status === 402);
    assert.equal(calls, 1);
  }
});


test('Gemini rejection diagnostics retain field paths without provider text', async () => {
  await assert.rejects(() => generateJson('private teaching material', {provider:'gemini',apiKey:'synthetic',fetcher:async()=>({ok:false,status:400,json:async()=>({error:{status:'INVALID_ARGUMENT',message:'private teaching material',details:[{fieldViolations:[{field:'generation_config.response_json_schema',description:'private teaching material'}]}]}})})}), error => {
    assert.deepEqual(error.provider.fields, ['generation_config.response_json_schema']);
    assert.doesNotMatch(JSON.stringify(error.provider), /private teaching/);
    return error.code === 'AI_REQUEST_REJECTED';
  });
});


test('explicit Gemini schema rejection retries JSON mode on the same model', async () => {
  const requests = [];
  const result = await generateJson('Draft JSON', {provider:'gemini',apiKey:'synthetic',responseSchema:draftSchema,fetcher:async(url, options)=>{
    requests.push({url, body:JSON.parse(options.body)});
    if(requests.length===1) return {ok:false,status:400,json:async()=>({error:{status:'INVALID_ARGUMENT',message:'Request contains an invalid argument.'}})};
    return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"missions":[]}'}]}}]})};
  }});
  assert.deepEqual(result,{missions:[]});
  assert.equal(requests.length,2);
  assert.equal(requests[0].url,requests[1].url);
  assert.ok(requests[0].body.generationConfig.responseJsonSchema);
  assert.equal(requests[1].body.generationConfig.responseJsonSchema,undefined);
  assert.equal(requests[1].body.generationConfig.responseMimeType,'application/json');
  assert.match(requests[1].body.contents[0].parts[0].text,/Required JSON structure/);
});


test('AI action budget counts every retry and records metadata for unsuccessful responses', async () => {
  for (const provider of ['gemini', 'groq']) {
    const budget = createAiActionBudget();
    let calls = 0;
    const before = aiUsageSnapshot().filter(row => row.provider === provider).reduce((sum, row) => sum + row.requests, 0);
    await generateJson('Return JSON', { provider, apiKey: 'synthetic', budget, fetcher: async () => {
      calls++;
      return { ok: true, json: async () => provider === 'gemini'
        ? { modelVersion: 'reported-gemini', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 5, totalTokenCount: 35 }, candidates: [{ finishReason: calls === 1 ? 'MAX_TOKENS' : 'STOP', content: { parts: [{ text: '{"ok":true}' }] } }] }
        : { model: 'reported-groq', usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, completion_tokens_details: { reasoning_tokens: 5 } }, choices: [{ finish_reason: calls === 1 ? 'length' : 'stop', message: { content: '{"ok":true}' } }] } };
    } });
    const snapshot = budget.snapshot();
    assert.equal(snapshot.calls, 2);
    assert.equal(snapshot.inputTokens, 20);
    assert.equal(snapshot.outputTokens, 40);
    assert.equal(snapshot.reasoningTokens, 10);
    assert.equal(snapshot.totalTokens, provider === 'gemini' ? 70 : 60);
    assert.equal(snapshot.unknownTokenRequests, 0);
    assert.deepEqual(snapshot.attempts.map(attempt => attempt.outcome), ['truncated', 'success']);
    assert.ok(snapshot.attempts.every(attempt => attempt.operationId === snapshot.operationId && attempt.latencyMs >= 0));
    const after = aiUsageSnapshot().filter(row => row.provider === provider).reduce((sum, row) => sum + row.requests, 0);
    assert.equal(after - before, 2);
  }
});

test('AI attempt observations include invalid JSON, blocking and HTTP failures with unknown tokens', async () => {
  const budget = createAiActionBudget();
  let calls = 0;
  await assert.rejects(() => groq('Return JSON', { apiKey: 'synthetic', budget, fetcher: async () => ({ ok: true, json: async () => ({ model: 'reported', usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }, choices: [{ finish_reason: ++calls === 1 ? 'stop' : 'content_filter', message: { content: 'invalid JSON' } }] }) }) }), error => error.code === 'AI_BLOCKED');
  await assert.rejects(() => groq('Return JSON', { apiKey: 'synthetic', budget, fetcher: async () => ({ ok: false, status: 429 }) }), error => error.code === 'AI_RATE_LIMITED');
  const snapshot = budget.snapshot();
  assert.deepEqual(snapshot.attempts.map(attempt => attempt.outcome), ['invalid_json', 'blocked', 'http_error']);
  assert.equal(snapshot.totalTokens, 10);
  assert.equal(snapshot.unknownTokenRequests, 1);
  assert.equal(snapshot.attempts[2].totalTokens, null);
  assert.equal(snapshot.attempts[2].returnedModel, null);
  assert.equal(aiAttemptSnapshot().filter(attempt => attempt.operationId === snapshot.operationId).length, 3);
});

test('one shared action budget stops provider retries before another actual fetch', async () => {
  for (const provider of ['gemini', 'groq']) {
    let calls = 0;
    const budget = createAiActionBudget({ maxCalls: 1 });
    await assert.rejects(() => withAiActionBudget(budget, () => generateJson('Return JSON', {
      provider, apiKey: 'synthetic', fetcher: async () => {
        calls++;
        return { ok: true, json: async () => provider === 'gemini'
          ? { candidates: [{ finishReason: 'MAX_TOKENS' }] }
          : { choices: [{ finish_reason: 'length' }] } };
      },
    })), error => error.code === 'AI_BUDGET_EXHAUSTED' && error.status === 429 && error.budget.exhaustedReason === 'calls');
    assert.equal(calls, 1);
    assert.equal(budget.snapshot().calls, 1);
  }
});

test('shared action budgets span provider invocations and stop at known actual token usage', async () => {
  const budget = createAiActionBudget({ maxTokens: 5 });
  let calls = 0;
  const options = { apiKey: 'synthetic', fetcher: async () => {
    calls++;
    return { ok: true, json: async () => ({ usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }, choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }) };
  } };
  await withAiActionBudget(budget, async () => {
    assert.deepEqual(await groq('Return JSON', options), { ok: true });
    await assert.rejects(() => groq('Return JSON', options), error => error.code === 'AI_BUDGET_EXHAUSTED' && error.budget.exhaustedReason === 'tokens');
  });
  assert.equal(calls, 1);
  assert.equal(budget.snapshot().totalTokens, 5);
});

test('external cancellation aborts an active provider request and prevents further calls', async () => {
  const controller = new AbortController();
  const budget = createAiActionBudget();
  let calls = 0;
  await assert.rejects(() => groq('Return JSON', { apiKey: 'synthetic', budget, signal: controller.signal,
    fetcher: async (_url, options) => {
      calls++;
      controller.abort();
      assert.equal(options.signal.aborted, true);
      return new Promise(() => {});
    },
  }), error => error.code === 'AI_ABORTED');
  assert.equal(calls, 1);
  assert.equal(budget.snapshot().attempts[0].outcome, 'aborted');
  await assert.rejects(() => groq('Return JSON', { apiKey: 'synthetic', budget, signal: controller.signal, fetcher: () => assert.fail('must not fetch') }), error => error.code === 'AI_ABORTED');
  assert.equal(budget.snapshot().calls, 1);
});

test('action deadline aborts a request and returns an actionable budget error', async () => {
  const budget = createAiActionBudget({ maxDurationMs: 20 });
  let requestSignal;
  await assert.rejects(() => groq('Return JSON', { apiKey: 'synthetic', budget, fetcher: async (_url, options) => {
    requestSignal = options.signal;
    return new Promise(() => {});
  } }), error => error.code === 'AI_BUDGET_EXHAUSTED' && error.status === 429 && error.budget.exhaustedReason === 'duration');
  assert.equal(requestSignal.aborted, true);
  assert.equal(budget.snapshot().calls, 1);
  assert.equal(budget.snapshot().attempts[0].outcome, 'budget_exhausted');
});


test('known partial metadata consumes the token budget while absent totals remain unknown', async () => {
  const budget = createAiActionBudget({ maxTokens: 5 });
  await generateJson('Return JSON', { provider: 'gemini', apiKey: 'synthetic', budget, fetcher: async () => ({ ok: true, json: async () => ({ usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 }, candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":true}' }] } }] }) }) });
  const snapshot = budget.snapshot();
  assert.equal(snapshot.totalTokens, 5);
  assert.equal(snapshot.unknownTokenRequests, 1);
  assert.equal(snapshot.attempts[0].totalTokens, null);
  assert.equal(snapshot.attempts[0].reasoningTokens, null);
  assert.equal(snapshot.attempts[0].knownTokens, 5);
  await assert.rejects(() => generateJson('Return JSON', { apiKey: 'synthetic', budget, fetcher: () => assert.fail('must not fetch') }), error => error.code === 'AI_BUDGET_EXHAUSTED');
});

test('action deadline also bounds provider retry backoff and response body reads', async () => {
  for (const phase of ['backoff', 'body']) {
    const budget = createAiActionBudget({ maxDurationMs: 20 });
    let calls = 0;
    await assert.rejects(() => groq('Return JSON', { apiKey: 'synthetic', budget, retryDelayMs: 10000, fetcher: async () => {
      calls++;
      return phase === 'backoff' ? { ok: false, status: 503 } : { ok: false, status: 400, json: async () => new Promise(() => {}) };
    } }), error => error.code === 'AI_BUDGET_EXHAUSTED' && error.status === 429);
    assert.equal(calls, 1);
    assert.equal(budget.snapshot().attempts.length, 1);
  }
});
