import { suggestGrade } from '../src/ai-grading.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { aiProviderCatalog, resolveAiSelection, generateJson, groq, draftSchema } from '../src/ai-provider.mjs';
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
