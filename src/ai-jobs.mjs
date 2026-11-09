import { randomUUID } from 'node:crypto';
import { assessmentLimits } from '../public/assessment-limits.js';
import { positiveTypeCounts, validateQuestionMix } from '../public/question-types.js';
import { buildGeneratedPackage, generationLanguagePlan, inspectProposal, proposeExam } from './ai.mjs';
import { createAiActionBudget, resolveAiSelection, withAiActionBudget } from './ai-provider.mjs';

const fail = (code, message, status = 400) => {
  throw Object.assign(new Error(message), { code, status });
};
const signature = (question) =>
  String(question?.prompt ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

export function planGeneration(input) {
  const total = input?.questionCount;
  const groups =
    input?.kind === 'ctf' ? input.missionCount : Math.ceil(total / assessmentLimits.questionsPerGroup);
  if (
    !Number.isInteger(total) ||
    total < 1 ||
    total > assessmentLimits.questions ||
    !Number.isInteger(groups) ||
    groups < 1 ||
    groups > assessmentLimits.groups ||
    total < groups ||
    total > groups * 4
  )
    fail(
      'INVALID_AI_REQUEST',
      `Choose 1–${assessmentLimits.questions} questions, with 1–4 questions per group.`,
    );
  if (
    typeof input.title !== 'string' ||
    !input.title.trim() ||
    input.title.length > 120 ||
    typeof input.subject !== 'string' ||
    !input.subject.trim() ||
    input.subject.length > 120 ||
    !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes < 5 ||
    input.durationMinutes > 180 ||
    !['activity', 'quiz', 'test', 'exam', 'ctf'].includes(input.kind) ||
    !['auto', 'objective', 'mixed', 'coding'].includes(input.questionMode ?? 'auto') ||
    typeof (input.programmingLanguage ?? 'auto') !== 'string' ||
    !(input.programmingLanguage ?? 'auto')
      .split(',')
      .every((value) =>
        ['auto', 'python', 'javascript', 'php', 'sql', 'frontend', 'php-web'].includes(value),
      ) ||
    !['easy', 'medium', 'hard'].includes(input.difficulty ?? 'medium') ||
    (input.customPrompt !== undefined &&
      (typeof input.customPrompt !== 'string' || input.customPrompt.length > 2000))
  )
    fail('INVALID_AI_REQUEST', 'Enter valid activity details before generating.');
  inspectProposal({ ...input, design: { missions: [] } });
  resolveAiSelection(input);
  const languagePlan = generationLanguagePlan(input);
  const mix = input.questionMode === 'mixed' ? { ...positiveTypeCounts(input.questionTypeCounts) } : null;
  if (mix && validateQuestionMix(input.questionTypeCounts, total).length)
    fail('INVALID_AI_REQUEST', validateQuestionMix(input.questionTypeCounts, total).join(' '));
  let remaining = total;
  const sizes = Array.from({ length: groups }, (_, i) => {
    const size = Math.min(4, remaining - (groups - i - 1));
    remaining -= size;
    return size;
  });
  const plan = [];
  const types = mix ? Object.keys(mix) : [];
  let typeCursor = 0;
  const languageCursor = {};
  let codingLanguageCursor = 0;
  for (let offset = 0; offset < sizes.length; offset += 5) {
    const groupSizes = sizes.slice(offset, offset + 5),
      count = groupSizes.reduce((a, b) => a + b, 0);
    const counts = {};
    for (let slot = 0; mix && slot < count; slot++) {
      while (!mix[types[typeCursor % types.length]]) typeCursor++;
      const type = types[typeCursor++ % types.length];
      mix[type]--;
      counts[type] = (counts[type] ?? 0) + 1;
    }
    let languages = input.programmingLanguage ?? 'auto';
    if (mix && languagePlan.length) {
      const selected = [];
      for (const type of ['code_writing', 'web_project']) {
        const available = languagePlan.filter((item) => item.type === type).map((item) => item.language);
        for (let i = 0; i < Math.min(counts[type] ?? 0, available.length); i++) {
          const cursor = languageCursor[type] ?? 0;
          selected.push(available[cursor % available.length]);
          languageCursor[type] = cursor + 1;
        }
      }
      languages = selected.join(',') || 'auto';
    } else if (input.questionMode === 'coding' && languagePlan.length) {
      languages = Array.from(
        { length: Math.min(count, languagePlan.length) },
        () => languagePlan[codingLanguageCursor++ % languagePlan.length].language,
      ).join(',');
    }
    plan.push({
      questionCount: count,
      missionCount: groupSizes.length,
      groupSizes,
      programmingLanguage: languages,
      ...(mix ? { questionTypeCounts: counts } : {}),
    });
  }
  return plan;
}

export class AiGenerationJobs {
  constructor(db, { proposer = proposeExam, budgetOptions = {}, concurrency = 2 } = {}) {
    this.db = db;
    this.proposer = proposer;
    this.budgetOptions = budgetOptions;
    this.concurrency = concurrency;
    this.running = new Map();
    this.closed = false;
    db.exec(`CREATE TABLE IF NOT EXISTS ai_generation_jobs (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, mode TEXT NOT NULL,
      input_json TEXT NOT NULL, plan_json TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0,
      design_json TEXT NOT NULL, status TEXT NOT NULL, error_json TEXT, budget_json TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ai_jobs_owner ON ai_generation_jobs(owner_id,status);`);
    db.prepare("UPDATE ai_generation_jobs SET status='paused',error_json=? WHERE status='running'").run(
      JSON.stringify({
        code: 'AI_INTERRUPTED',
        message: 'Generation stopped during restart. Resume to continue.',
      }),
    );
  }
  row(owner, id) {
    const row = this.db.prepare('SELECT * FROM ai_generation_jobs WHERE id=? AND owner_id=?').get(id, owner);
    if (!row) fail('NOT_FOUND', 'Generation job not found.', 404);
    return row;
  }
  view(owner, id) {
    const row = this.row(owner, id),
      input = JSON.parse(row.input_json),
      design = JSON.parse(row.design_json);
    const completedQuestions = design.missions.reduce((sum, group) => sum + group.activities.length, 0);
    const proposal = inspectProposal({ ...input, design });
    return {
      jobId: id,
      status: row.status,
      input,
      completedQuestions,
      totalQuestions: input.questionCount,
      completedBatches: row.cursor,
      totalBatches: JSON.parse(row.plan_json).length,
      proposal,
      ...(row.error_json ? { error: JSON.parse(row.error_json) } : {}),
      ...(row.budget_json ? { budget: JSON.parse(row.budget_json) } : {}),
      ...(row.status === 'done' && row.mode === 'generate'
        ? { result: buildGeneratedPackage(input, design, { identifier: id }) }
        : {}),
    };
  }
  list(owner) {
    return this.db
      .prepare(
        "SELECT id,status,updated_at FROM ai_generation_jobs WHERE owner_id=? AND status IN ('running','paused') ORDER BY updated_at DESC LIMIT 10",
      )
      .all(owner);
  }
  start(owner, input, mode = 'propose') {
    if (this.closed) fail('AI_BUSY', 'Generation is shutting down.', 503);
    if (!['propose', 'generate'].includes(mode)) fail('INVALID_AI_REQUEST', 'Unsupported generation mode.');
    if (this.db.prepare("SELECT 1 FROM ai_generation_jobs WHERE owner_id=? AND status='running'").get(owner))
      fail('AI_BUSY', 'Finish or pause your current generation first.', 409);
    if (this.running.size >= this.concurrency) fail('AI_BUSY', 'Generation is busy. Try again shortly.', 429);
    const selection = resolveAiSelection(input);
    const stored = { ...input, aiProvider: selection.provider, aiModel: selection.model };
    const plan = planGeneration(stored),
      id = randomUUID(),
      now = new Date().toISOString();
    this.db
      .prepare('INSERT INTO ai_generation_jobs VALUES (?,?,?,?,?,?,?, ?,NULL,NULL,?,?)')
      .run(
        id,
        owner,
        mode,
        JSON.stringify(stored),
        JSON.stringify(plan),
        0,
        JSON.stringify({ missions: [] }),
        'paused',
        now,
        now,
      );
    this.resume(owner, id);
    return this.view(owner, id);
  }
  resume(owner, id) {
    if (this.closed) fail('AI_BUSY', 'Generation is shutting down.', 503);
    const row = this.row(owner, id);
    if (row.status === 'done' || row.status === 'running') return this.view(owner, id);
    if (this.running.has(id)) fail('AI_BUSY', 'The current batch is stopping. Retry Resume shortly.', 409);
    if (row.status === 'cancelled')
      fail('AI_CANCELLED', 'This generation was cancelled. Start a new job.', 409);
    if (
      this.running.size >= this.concurrency ||
      this.db.prepare("SELECT 1 FROM ai_generation_jobs WHERE owner_id=? AND status='running'").get(owner)
    )
      fail('AI_BUSY', 'Generation is busy. Retry shortly.', 429);
    const controller = new AbortController();
    const budget = createAiActionBudget({
      maxCalls: 12,
      maxDurationMs: 240000,
      maxTokens: 180000,
      ...this.budgetOptions,
      signal: controller.signal,
    });
    this.db
      .prepare("UPDATE ai_generation_jobs SET status='running',error_json=NULL,updated_at=? WHERE id=?")
      .run(new Date().toISOString(), id);
    const work = Promise.resolve()
      .then(() => withAiActionBudget(budget, () => this.run(id, budget, controller.signal)))
      .catch((error) => {
        if (this.closed) return;
        this.db
          .prepare(
            "UPDATE ai_generation_jobs SET status=CASE WHEN status='cancelled' THEN status ELSE 'paused' END,error_json=?,budget_json=?,updated_at=? WHERE id=?",
          )
          .run(
            JSON.stringify({
              code: error.code || 'AI_PROVIDER_ERROR',
              message: error.status ? error.message : 'Generation interrupted. Resume to continue.',
            }),
            JSON.stringify(budget.snapshot()),
            new Date().toISOString(),
            id,
          );
      })
      .finally(() => this.running.delete(id));
    this.running.set(id, { controller, work });
    return this.view(owner, id);
  }
  async run(id, budget, signal) {
    const initial = this.db.prepare('SELECT * FROM ai_generation_jobs WHERE id=?').get(id);
    const input = JSON.parse(initial.input_json),
      plan = JSON.parse(initial.plan_json);
    const design = JSON.parse(initial.design_json);
    const seen = new Set(design.missions.flatMap((group) => group.activities).map(signature));
    for (let cursor = initial.cursor; cursor < plan.length; cursor++) {
      if (signal.aborted || this.closed) return;
      const batch = plan[cursor];
      const prior = [...seen].slice(-40).map((value) => value.slice(0, 140));
      const customPrompt =
        `${String(input.customPrompt ?? '').slice(0, 800)}\nBatch ${cursor + 1} of ${plan.length}. Avoid duplicating these earlier question prompts: ${JSON.stringify(prior).slice(0, 1050)}.`.slice(
          0,
          2000,
        );
      const preview = await this.proposer({ ...input, ...batch, customPrompt }, { budget, signal });
      if (signal.aborted || this.closed) return;
      const questions = preview.design?.missions?.flatMap((group) => group.activities) ?? [];
      if (
        questions.length !== batch.questionCount ||
        preview.missions.some((group) => group.questions.some((question) => !question.ready))
      )
        fail(
          'AI_INVALID_DRAFT',
          'A batch needs correction. Earlier questions are saved; resume to retry this batch.',
          422,
        );
      buildGeneratedPackage({ ...input, ...batch }, preview.design);
      const batchSeen = new Set();
      for (const question of questions) {
        const key = signature(question);
        if (!key || seen.has(key) || batchSeen.has(key))
          fail(
            'AI_DUPLICATE_QUESTION',
            'A batch repeated a question. Earlier questions are saved; resume to retry.',
            422,
          );
        batchSeen.add(key);
      }
      design.missions.push(...preview.design.missions);
      for (const key of batchSeen) seen.add(key);
      this.db
        .prepare(
          "UPDATE ai_generation_jobs SET cursor=?,design_json=?,budget_json=?,updated_at=? WHERE id=? AND status='running'",
        )
        .run(
          cursor + 1,
          JSON.stringify(design),
          JSON.stringify(budget.snapshot()),
          new Date().toISOString(),
          id,
        );
    }
    buildGeneratedPackage(
      { ...input, approvedSelection: true, missionCount: design.missions.length },
      design,
    );
    this.db
      .prepare(
        "UPDATE ai_generation_jobs SET status='done',budget_json=?,updated_at=? WHERE id=? AND status='running'",
      )
      .run(JSON.stringify(budget.snapshot()), new Date().toISOString(), id);
  }
  pause(owner, id, cancelled = false) {
    const row = this.row(owner, id);
    if (['cancelled', 'done'].includes(row.status)) return this.view(owner, id);
    this.running.get(id)?.controller.abort();
    this.db
      .prepare("UPDATE ai_generation_jobs SET status=?,updated_at=? WHERE id=? AND status<>'done'")
      .run(cancelled ? 'cancelled' : 'paused', new Date().toISOString(), id);
    return this.view(owner, id);
  }
  async drain() {
    await Promise.allSettled([...this.running.values()].map((entry) => entry.work));
  }
  close() {
    this.closed = true;
    for (const entry of this.running.values()) entry.controller.abort();
  }
}
