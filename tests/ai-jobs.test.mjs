import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { AiGenerationJobs, planGeneration } from '../src/ai-jobs.mjs';
import { generationLanguagePlan, inspectProposal, proposeExam } from '../src/ai.mjs';

const source = {
  filename: 'lesson.md',
  content:
    'Search filters matching rows before pagination. Ordering sorts rows by column values. A program can calculate a result from input values and display it to the user. Every displayed result depends on the supplied input values.',
};
const base = {
  title: 'Table concepts',
  subject: 'Programming',
  kind: 'quiz',
  durationMinutes: 40,
  questionCount: 45,
  questionMode: 'objective',
  source,
  aiProvider: 'groq',
  aiModel: 'openai/gpt-oss-20b',
};
const question = (index, type = 'single_choice') => ({
  type,
  prompt: `Question ${index}: Which operation filters matching rows before pagination?`,
  evidenceQuote: 'Search filters matching rows before pagination.',
  location: 'Source',
  ...(type === 'single_choice'
    ? { options: ['Search', 'Ordering'], answer: 'Search' }
    : type === 'true_false'
      ? { answer: true }
      : { answer: { value: 2, tolerance: 0, unit: '' } }),
});
function preview(input, offset = 0) {
  const types = input.questionTypeCounts
    ? Object.entries(input.questionTypeCounts).flatMap(([type, count]) => Array(count).fill(type))
    : Array(input.questionCount).fill('single_choice');
  const questions = types.map((type, index) => question(offset + index + 1, type));
  const missions = Array.from({ length: Math.ceil(questions.length / 4) }, (_, index) => ({
    title: `Group ${offset + index + 1}`,
    activities: questions.slice(index * 4, index * 4 + 4),
  }));
  return inspectProposal({ ...input, design: { missions } });
}
function charge(budget) {
  budget.claim();
  budget.record({
    inputTokens: 1,
    outputTokens: 1,
    reasoningTokens: 0,
    totalTokens: 2,
    knownTokens: 2,
    operationId: budget.snapshot().operationId,
    outcome: 'success',
  });
}
function setup(t, options = {}) {
  const db = new DatabaseSync(':memory:');
  const jobs = new AiGenerationJobs(db, options);
  t.after(async () => {
    jobs.close();
    await jobs.drain();
    db.close();
  });
  return { db, jobs };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('a Gemini draft starts in JSON mode and can finish after a malformed response', async (t) => {
  const requests = [];
  const { jobs } = setup(t, {
    proposer: (input, options) =>
      proposeExam(input, {
        ...options,
        apiKey: 'synthetic',
        fetcher: async (url, request) => {
          requests.push({ url, body: JSON.parse(request.body) });
          const value = requests.length === 1 ? '{"missions":[}' : JSON.stringify(preview(input).design);
          return Response.json({
            candidates: [{ finishReason: 'STOP', content: { parts: [{ text: value }] } }],
          });
        },
      }),
  });
  const started = jobs.start('faculty-a', {
    ...base,
    questionCount: 12,
    customPrompt: 'x'.repeat(1980) + 'Keep this final note',
    questionMode: 'mixed',
    questionTypeCounts: { single_choice: 4, true_false: 4, numeric_entry: 4 },
    aiProvider: 'gemini',
    aiModel: 'gemini-3.5-flash',
  });
  await jobs.drain();
  const done = jobs.view('faculty-a', started.jobId);
  assert.equal(done.status, 'done', done.error?.message);
  assert.equal(done.completedQuestions, 12);
  assert.equal(done.budget.calls, 2);
  const [first, retry] = requests;
  assert.equal(first.body.generationConfig.responseJsonSchema, undefined);
  assert.equal(first.body.generationConfig.responseMimeType, 'application/json');
  assert.match(first.body.contents[0].parts[0].text, /Keep this final note/);
  assert.equal(retry.body.generationConfig.responseJsonSchema, undefined);
  assert.equal(retry.body.generationConfig.responseMimeType, 'application/json');
  assert.match(retry.body.contents[0].parts[0].text, /previous response was incomplete or invalid JSON/);
  assert.ok(requests.every(({ url }) => url === first.url));
});

test('generation preserves provider errors when validation repair fails', async (t) => {
  let calls = 0;
  const { jobs } = setup(t, {
    proposer: (input, options) =>
      proposeExam(input, {
        ...options,
        apiKey: 'synthetic',
        fetcher: async () => {
          if (++calls === 2) return Response.json({}, { status: 429 });
          const design = preview(input).design;
          design.missions[0].activities[0].answer = 'Missing option';
          return Response.json({
            candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(design) }] } }],
          });
        },
      }),
  });
  const started = jobs.start('faculty-a', {
    ...base,
    questionCount: 1,
    aiProvider: 'gemini',
    aiModel: 'gemini-3.5-flash',
  });
  await jobs.drain();
  const paused = jobs.view('faculty-a', started.jobId);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.error.code, 'AI_RATE_LIMITED');
  assert.equal(paused.completedQuestions, 1);
  assert.equal(paused.proposal.design.missions[0].activities[0].answer, 'Missing option');
});

test('200 questions finish in ten bounded batches and retain every completed question', async (t) => {
  const requests = [];
  let offset = 0;
  const { jobs } = setup(t, {
    proposer: async (input, { budget, batchInstruction }) => {
      charge(budget);
      requests.push({ ...input, batchInstruction });
      const result = preview(input, offset);
      offset += input.questionCount;
      return result;
    },
  });
  const started = jobs.start('faculty-a', { ...base, questionCount: 200 }, 'generate');
  assert.equal(started.status, 'running');
  assert.equal(started.totalBatches, 10);
  await jobs.drain();
  const done = jobs.view('faculty-a', started.jobId);
  assert.equal(jobs.view('faculty-a', started.jobId).result.public.examId, done.result.public.examId);
  assert.equal(done.status, 'done');
  assert.equal(done.completedQuestions, 200);
  assert.equal(done.completedBatches, 10);
  assert.equal(requests.length, 10);
  assert.ok(requests.every((input) => input.questionCount === 20 && input.missionCount === 5));
  const questions = done.result.public.missions.flatMap((group) => group.activities);
  assert.equal(questions.length, 200);
  assert.equal(done.result.public.missions.length, 50);
  assert.equal(new Set(questions.map((item) => item.prompt)).size, 200);
  assert.match(requests[1].batchInstruction, /Question 1:/i);
  assert.equal(done.budget.calls, 10);
});

test('custom type counts remain exact across batch boundaries', async (t) => {
  const counts = { single_choice: 23, true_false: 17, numeric_entry: 5 };
  let offset = 0;
  const seenCounts = {};
  const { jobs } = setup(t, {
    proposer: async (input, { budget }) => {
      charge(budget);
      for (const [type, count] of Object.entries(input.questionTypeCounts))
        seenCounts[type] = (seenCounts[type] ?? 0) + count;
      const result = preview(input, offset);
      offset += input.questionCount;
      return result;
    },
  });
  const started = jobs.start(
    'faculty-a',
    { ...base, questionMode: 'mixed', questionTypeCounts: counts },
    'generate',
  );
  await jobs.drain();
  const done = jobs.view('faculty-a', started.jobId);
  assert.equal(done.status, 'done');
  assert.deepEqual(seenCounts, counts);
  const actual = {};
  for (const question of done.proposal.design.missions.flatMap((group) => group.activities))
    actual[question.type] = (actual[question.type] ?? 0) + 1;
  assert.deepEqual(actual, counts);
});

test('language allocation covers every selected console and web language within each batch capacity', () => {
  const input = {
    ...base,
    questionCount: 42,
    questionMode: 'mixed',
    questionTypeCounts: { true_false: 38, code_writing: 3, web_project: 1 },
    programmingLanguage: 'python,javascript,php,frontend',
  };
  const plan = planGeneration(input);
  const covered = new Set();
  for (const batch of plan) {
    for (const allocation of generationLanguagePlan({ ...input, ...batch })) covered.add(allocation.language);
    assert.equal(
      Object.values(batch.questionTypeCounts).reduce((sum, count) => sum + count, 0),
      batch.questionCount,
    );
  }
  assert.deepEqual([...covered].sort(), ['frontend', 'javascript', 'php', 'python']);
});

test('coding-only tail batches do not require more selected languages than available questions', () => {
  const input = {
    ...base,
    questionCount: 21,
    questionMode: 'coding',
    programmingLanguage: 'python,javascript,php,sql',
  };
  const plan = planGeneration(input),
    covered = new Set();
  for (const batch of plan) {
    const allocation = generationLanguagePlan({ ...input, ...batch });
    assert.ok(allocation.length <= batch.questionCount);
    for (const item of allocation) covered.add(item.language);
  }
  assert.deepEqual([...covered].sort(), ['javascript', 'php', 'python', 'sql']);
});

test('budget exhaustion pauses after saved batches and each resume receives a fresh action budget', async (t) => {
  let offset = 0;
  const operations = new Set();
  const { jobs } = setup(t, {
    budgetOptions: { maxCalls: 1 },
    proposer: async (input, { budget }) => {
      charge(budget);
      operations.add(budget.snapshot().operationId);
      const result = preview(input, offset);
      offset += input.questionCount;
      return result;
    },
  });
  const started = jobs.start('faculty-a', base);
  await jobs.drain();
  let current = jobs.view('faculty-a', started.jobId);
  assert.equal(current.status, 'paused');
  assert.equal(current.error.code, 'AI_BUDGET_EXHAUSTED');
  assert.equal(current.completedQuestions, 20);
  assert.equal(current.completedBatches, 1);
  const saved = structuredClone(current.proposal.design.missions);
  jobs.resume('faculty-a', started.jobId);
  await jobs.drain();
  current = jobs.view('faculty-a', started.jobId);
  assert.equal(current.status, 'paused');
  assert.equal(current.completedQuestions, 40);
  jobs.resume('faculty-a', started.jobId);
  await jobs.drain();
  current = jobs.view('faculty-a', started.jobId);
  assert.equal(current.status, 'done');
  assert.equal(current.completedQuestions, 45);
  assert.deepEqual(current.proposal.design.missions.slice(0, saved.length), saved);
  assert.equal(operations.size, 3);
});

test('restart keeps committed batches and resumes from the next unfinished batch', async (t) => {
  const entered = deferred(),
    release = deferred();
  let calls = 0;
  const { db, jobs } = setup(t, {
    proposer: async (input, { budget }) => {
      charge(budget);
      if (++calls === 2) {
        entered.resolve();
        await release.promise;
      }
      return preview(input, (calls - 1) * 20);
    },
  });
  const started = jobs.start('faculty-a', base);
  await entered.promise;
  assert.equal(jobs.view('faculty-a', started.jobId).completedQuestions, 20);
  jobs.close();
  release.resolve();
  await jobs.drain();
  let resumedOffset = 20;
  const resumedRequests = [];
  const restored = new AiGenerationJobs(db, {
    proposer: async (input, { budget }) => {
      charge(budget);
      resumedRequests.push(input);
      const result = preview(input, resumedOffset);
      resumedOffset += input.questionCount;
      return result;
    },
  });
  t.after(async () => {
    restored.close();
    await restored.drain();
  });
  const interrupted = restored.view('faculty-a', started.jobId);
  assert.equal(interrupted.status, 'paused');
  assert.equal(interrupted.error.code, 'AI_INTERRUPTED');
  const saved = structuredClone(interrupted.proposal.design.missions);
  restored.resume('faculty-a', started.jobId);
  await restored.drain();
  const done = restored.view('faculty-a', started.jobId);
  assert.equal(done.status, 'done');
  assert.deepEqual(
    resumedRequests.map((input) => input.questionCount),
    [20, 5],
  );
  assert.deepEqual(done.proposal.design.missions.slice(0, saved.length), saved);
});

test('cancellation prevents a late provider response from committing questions', async (t) => {
  const entered = deferred(),
    release = deferred();
  const { jobs } = setup(t, {
    proposer: async (input, { budget }) => {
      charge(budget);
      entered.resolve();
      await release.promise;
      return preview(input);
    },
  });
  const started = jobs.start('faculty-a', { ...base, questionCount: 20 });
  await entered.promise;
  const cancelled = jobs.pause('faculty-a', started.jobId, true);
  assert.equal(cancelled.status, 'cancelled');
  release.resolve();
  await jobs.drain();
  const final = jobs.view('faculty-a', started.jobId);
  assert.equal(final.status, 'cancelled');
  assert.equal(final.completedBatches, 0);
  assert.equal(final.completedQuestions, 0);
  assert.throws(
    () => jobs.resume('faculty-a', started.jobId),
    (error) => error.code === 'AI_CANCELLED',
  );
});

test('jobs are owner-scoped for viewing, resuming, pausing and listing', async (t) => {
  const { jobs } = setup(t, {
    budgetOptions: { maxCalls: 0 },
    proposer: async (_input, { budget }) => {
      budget.claim();
    },
  });
  const started = jobs.start('faculty-a', base);
  await jobs.drain();
  for (const operation of ['view', 'resume', 'pause'])
    assert.throws(
      () => jobs[operation]('faculty-b', started.jobId),
      (error) => error.code === 'NOT_FOUND' && error.status === 404,
    );
  assert.deepEqual(jobs.list('faculty-b'), []);
  assert.equal(jobs.list('faculty-a')[0].id, started.jobId);
});

test('a duplicate batch is rejected without losing progress, then retried on resume', async (t) => {
  let calls = 0;
  const { jobs } = setup(t, {
    proposer: async (input, { budget }) => {
      charge(budget);
      calls++;
      return preview(input, calls === 2 ? 0 : calls === 1 ? 0 : 20);
    },
  });
  const started = jobs.start('faculty-a', { ...base, questionCount: 40 });
  await jobs.drain();
  const paused = jobs.view('faculty-a', started.jobId);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.error.code, 'AI_DUPLICATE_QUESTION');
  assert.equal(paused.completedQuestions, 20);
  assert.equal(paused.completedBatches, 1);
  const saved = structuredClone(paused.proposal.design.missions);
  jobs.resume('faculty-a', started.jobId);
  await jobs.drain();
  const done = jobs.view('faculty-a', started.jobId);
  assert.equal(done.status, 'done');
  assert.equal(done.completedQuestions, 40);
  assert.deepEqual(done.proposal.design.missions.slice(0, saved.length), saved);
});

test('resuming a paused job waits for its old active batch to stop', async (t) => {
  const entered = deferred(),
    release = deferred();
  let calls = 0;
  const { jobs } = setup(t, {
    proposer: async (input, { budget }) => {
      charge(budget);
      calls++;
      if (calls === 1) {
        entered.resolve();
        await release.promise;
      }
      return preview(input);
    },
  });
  const started = jobs.start('faculty-a', { ...base, questionCount: 20 });
  await entered.promise;
  jobs.pause('faculty-a', started.jobId);
  assert.throws(
    () => jobs.resume('faculty-a', started.jobId),
    (error) => error.code === 'AI_BUSY',
  );
  assert.equal(calls, 1);
  release.resolve();
  await jobs.drain();
  assert.equal(jobs.view('faculty-a', started.jobId).completedQuestions, 0);
  jobs.resume('faculty-a', started.jobId);
  await jobs.drain();
  assert.equal(jobs.view('faculty-a', started.jobId).status, 'done');
  assert.equal(calls, 2);
});

test('a ready batch with the wrong custom mix is retried before committing its questions', async (t) => {
  let calls = 0;
  const { jobs } = setup(t, {
    regenerator: async (input) => inspectProposal(input),
    proposer: async (input, { budget }) => {
      charge(budget);
      calls++;
      return preview(
        calls === 2 ? { ...input, questionTypeCounts: { true_false: input.questionCount } } : input,
        calls === 1 ? 0 : 20,
      );
    },
  });
  const started = jobs.start('faculty-a', {
    ...base,
    questionCount: 40,
    questionMode: 'mixed',
    questionTypeCounts: { single_choice: 30, true_false: 10 },
  });
  await jobs.drain();
  const paused = jobs.view('faculty-a', started.jobId);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.error.code, 'AI_INVALID_DRAFT');
  assert.equal(paused.completedQuestions, 40);
  assert.equal(paused.completedBatches, 1);
  assert.ok(
    paused.proposal.missions.some((mission) => mission.questions.some((question) => !question.ready)),
  );
  const saved = structuredClone(paused.proposal.design.missions.slice(0, 5));
  jobs.resume('faculty-a', started.jobId);
  await jobs.drain();
  const done = jobs.view('faculty-a', started.jobId);
  assert.equal(done.status, 'done');
  assert.equal(done.completedQuestions, 40);
  assert.deepEqual(done.proposal.design.missions.slice(0, saved.length), saved);
});

test('a mixed batch repairs only excess types during the same generation job', async (t) => {
  let repairedTargets;
  const { jobs } = setup(t, {
    proposer: async (input) => preview({ ...input, questionTypeCounts: { true_false: input.questionCount } }),
    regenerator: async (input) => {
      repairedTargets = input.targets;
      const design = structuredClone(input.design);
      for (const target of input.targets)
        design.missions[target.missionIndex].activities[target.questionIndex] = question(
          target.questionIndex + 100,
          'single_choice',
        );
      return inspectProposal({ ...input, design });
    },
  });
  const started = jobs.start('faculty-a', {
    ...base,
    questionCount: 4,
    questionMode: 'mixed',
    questionTypeCounts: { single_choice: 2, true_false: 2 },
  });
  await jobs.drain();
  const done = jobs.view('faculty-a', started.jobId);
  assert.equal(done.status, 'done', done.error?.message);
  assert.equal(done.completedQuestions, 4);
  assert.equal(repairedTargets.length, 2);
  assert.equal(done.proposal.design.missions[0].activities[0].type, 'true_false');
});
