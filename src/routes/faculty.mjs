import {
  aiProviderCatalog,
  resolveAiSelection,
  aiUsageSnapshot,
  aiAttemptSnapshot,
  createAiActionBudget,
  withAiActionBudget,
} from '../ai-provider.mjs';
import { assessmentLimits } from '../../public/assessment-limits.js';
import { suggestGrade } from '../ai-grading.mjs';
import {
  aiAvailable,
  generateExam,
  proposeExam,
  regenerateInvalidQuestions,
  inspectProposal,
  buildApprovedPackage,
  checkSourceSupport,
  validateGeneratedDraft,
} from '../ai.mjs';
import { extractMaterialBounded } from '../material-extraction.mjs';
import { accessToken, clearBrowserSession } from '../http-session.mjs';
import { previewCode } from '../code-runner.mjs';
import { asFaculty, assertOwner } from '../faculty-access.mjs';
import { hash } from '../engine.mjs';
import { referenceGuides } from '../reference-guides.mts';
import { referenceTopics } from '../../public/reference-topics.js';

export async function facultyApi({
  req,
  res,
  url,
  requestId,
  store,
  publicOrigin,
  send,
  csv,
  gradebook,
  body,
  limit,
  metricsSnapshot,
  webPreviews,
  settlement,
  runtimeStatus,
}) {
  const method = req.method,
    path = url.pathname;
  const instructorToken = accessToken(req, 'instructor');
  const owner = store.requireInstructor(instructorToken);
  return asFaculty(owner, async () => {
    const savedAI = store.db
      .prepare('SELECT settings_json FROM faculty_ai_settings WHERE faculty_id=?')
      .get(owner);
    const storedSelection = savedAI ? JSON.parse(savedAI.settings_json) : {};
    const selection = {
      provider: storedSelection.aiProvider || 'gemini',
      model: storedSelection.aiModel || resolveAiSelection({}).model,
    };
    const selectedInput = async () => ({
      ...(await body(req)),
      aiProvider: selection.provider,
      aiModel: selection.model,
    });
    const runAi = async (work) => {
      const controller = new AbortController();
      const abort = () => {
        if (!res.writableEnded) controller.abort();
      };
      req.once?.('aborted', abort);
      res.once?.('close', abort);
      const budget = createAiActionBudget({ signal: controller.signal });
      try {
        return await withAiActionBudget(budget, () => work({ budget, signal: controller.signal }));
      } finally {
        req.off?.('aborted', abort);
        res.off?.('close', abort);
      }
    };
    if (path === '/api/instructor/ai/jobs') {
      if (method === 'GET') {
        const saved = store.db
          .prepare('SELECT updated_at FROM faculty_ai_proposals WHERE owner_id=?')
          .get(owner);
        return send(res, requestId, {
          jobs: store.aiJobs.list(owner),
          reviewUpdatedAt: saved?.updated_at ?? null,
        });
      }
      if (method === 'POST') {
        limit(`ai-generation:${owner}`, 5, 60_000);
        return send(res, requestId, store.aiJobs.start(owner, await selectedInput()), 202);
      }
    }
    const aiJobPath = /^\/api\/instructor\/ai\/jobs\/([a-f0-9-]{36})(?:\/(resume|pause|cancel))?$/.exec(path);
    if (aiJobPath) {
      const [, id, action] = aiJobPath;
      if (method === 'GET' && !action) return send(res, requestId, store.aiJobs.view(owner, id));
      if (method === 'POST' && action === 'resume') {
        limit(`ai-resume:${owner}`, 10, 60_000);
        return send(res, requestId, store.aiJobs.resume(owner, id), 202);
      }
      if (method === 'POST' && ['pause', 'cancel'].includes(action))
        return send(res, requestId, store.aiJobs.pause(owner, id, action === 'cancel'));
    }
    if (path === '/api/instructor/ai/settings') {
      if (method === 'GET')
        return send(res, requestId, {
          aiProvider: selection.provider,
          aiModel: selection.model,
          providers: aiProviderCatalog(),
        });
      if (method === 'PUT') {
        const chosen = resolveAiSelection(await body(req));
        const settings = { aiProvider: chosen.provider, aiModel: chosen.model };
        store.db
          .prepare(
            'INSERT INTO faculty_ai_settings(faculty_id,settings_json) VALUES (?,?) ON CONFLICT(faculty_id) DO UPDATE SET settings_json=excluded.settings_json',
          )
          .run(owner, JSON.stringify(settings));
        return send(res, requestId, settings);
      }
    }

    if (method === 'GET' && path === '/api/instructor/reference-guides')
      return send(res, requestId, { guides: referenceGuides(referenceTopics.map((topic) => topic.id)) });
    if (method === 'POST' && path.startsWith('/api/instructor/ai/')) {
      // Initial generation and one repair may each use two 90-second provider attempts.
      res.setTimeout(
        path.endsWith('/generate') || path.endsWith('/propose') || path.endsWith('/regenerate')
          ? 370000
          : 190000,
      );
    }
    const runId = /^\/api\/instructor\/runs\/([a-f0-9-]+)/.exec(path)?.[1];
    if (runId) {
      const run = store.db.prepare('SELECT owner_id FROM runs WHERE id=?').get(runId);
      if (!run) throw Object.assign(new Error('Run not found.'), { code: 'NOT_FOUND', status: 404 });
      assertOwner(run.owner_id);
    }
    if (method === 'GET' && path === '/api/instructor/session')
      return send(res, requestId, { authenticated: true });
    if (method === 'GET' && path === '/api/instructor/system')
      return send(res, requestId, {
        uptimeSeconds: Math.round(process.uptime()),
        memory: process.memoryUsage(),
        coding: store.codingQueue.stats(),
        metrics: metricsSnapshot(),
        aiUsage: aiUsageSnapshot(),
        aiAttempts: aiAttemptSnapshot(),
        previews: webPreviews?.stats(),
        settlement: settlement.stats(),
      });
    if (method === 'POST' && path === '/api/instructor/logout') {
      const result = store.logoutInstructor(instructorToken);
      clearBrowserSession(req, res, 'instructor', publicOrigin);
      return send(res, requestId, result);
    }
    if (method === 'POST' && path === '/api/instructor/materials/extract') {
      const input = await body(req, 15_000_000);
      if (
        typeof input.base64 !== 'string' ||
        input.base64.length > 13_400_000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)
      )
        throw Object.assign(new Error('Invalid material upload.'), { code: 'INVALID_MATERIAL', status: 400 });
      return send(
        res,
        requestId,
        await extractMaterialBounded({
          filename: input.filename,
          bytes: new Uint8Array(Buffer.from(input.base64, 'base64')),
        }),
      );
    }
    if (method === 'GET' && path === '/api/instructor/ai/status')
      return send(res, requestId, {
        available: aiAvailable(),
        model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
        providers: aiProviderCatalog(),
      });
    if (method === 'GET' && path === '/api/instructor/code/status')
      return send(res, requestId, await runtimeStatus());
    if (method === 'POST' && path === '/api/instructor/code/preview') {
      limit(`code-preview:instructor:${instructorToken}`, 12);
      const input = await body(req, 500_000);
      return send(
        res,
        requestId,
        await previewCode(input.config, input.value, store.codeRunner, input.input),
      );
    }
    if (path === '/api/instructor/ai/proposal') {
      if (method === 'GET') return send(res, requestId, store.getAiProposal(instructorToken));
      if (method === 'PUT')
        return send(
          res,
          requestId,
          store.saveAiProposal(instructorToken, await body(req, assessmentLimits.proposalBytes)),
        );
      if (method === 'DELETE')
        return send(
          res,
          requestId,
          store.tx(() =>
            store.deleteAiProposal(instructorToken, url.searchParams?.get('jobId') ?? undefined),
          ),
        );
    }
    if (method === 'POST' && path === '/api/instructor/ai/inspect')
      return send(res, requestId, inspectProposal(await body(req, assessmentLimits.proposalBytes)));
    if (method === 'POST' && path === '/api/instructor/ai/generate') {
      limit(`ai-generation:${owner}`, 5, 60_000);
      const input = await selectedInput();
      if (input.questionCount > assessmentLimits.generationBatchQuestions || input.missionCount > 5)
        return send(res, requestId, store.aiJobs.start(owner, input, 'generate'), 202);
      return send(res, requestId, await runAi((options) => generateExam(input, options)));
    }
    if (method === 'POST' && path === '/api/instructor/ai/regenerate') {
      limit(`ai-regenerate:${req.socket.remoteAddress}`, 40, 3600_000);
      const input = {
        ...(await body(req, assessmentLimits.proposalBytes)),
        aiProvider: selection.provider,
        aiModel: selection.model,
      };
      return send(res, requestId, await runAi((options) => regenerateInvalidQuestions(input, options)));
    }
    if (method === 'POST' && path === '/api/instructor/ai/propose') {
      limit(`ai-generation:${owner}`, 5, 60_000);
      const input = await selectedInput();
      if (input.questionCount > assessmentLimits.generationBatchQuestions || input.missionCount > 5)
        return send(res, requestId, store.aiJobs.start(owner, input), 202);
      return send(res, requestId, await runAi((options) => proposeExam(input, options)));
    }
    if (method === 'POST' && path === '/api/instructor/ai/approved-draft') {
      const input = await body(req, assessmentLimits.proposalBytes);
      const packageResult = buildApprovedPackage(input);
      const created = store.tx(() => {
        if (input.reviewJobId !== undefined)
          store.deleteAiProposal(instructorToken, input.reviewJobId, { approving: true });
        const draft = store.importDraft(
          packageResult.public,
          { ...packageResult.private, evidence: packageResult.evidence },
          'ai-faculty',
        );
        store.addSource(draft.examId, draft.version, input.source, 'ai-faculty');
        return draft;
      });
      return send(res, requestId, created, 201);
    }
    if (method === 'POST' && path === '/api/instructor/ai/draft') {
      const input = await body(req);
      const source = validateGeneratedDraft(input);
      const created = store.tx(() => {
        const draft = store.importDraft(input.public, input.private, 'ai-faculty');
        store.addSource(draft.examId, draft.version, source, 'ai-faculty');
        return draft;
      });
      return send(res, requestId, created, 201);
    }
    const aiCheckPath = /^\/api\/instructor\/ai\/check\/([a-z0-9-]+)\/(\d+)$/.exec(path);
    if (method === 'POST' && aiCheckPath) {
      limit(`ai-check:${req.socket.remoteAddress}`, 10, 3600_000);
      const exam = store.getExam(aiCheckPath[1], Number(aiCheckPath[2]));
      const sources = store.listSources(aiCheckPath[1], Number(aiCheckPath[2]));
      const input = await body(req);
      return send(
        res,
        requestId,
        await runAi((options) =>
          checkSourceSupport(exam, sources, { ...selection, ...options, activityIds: input?.activityIds }),
        ),
      );
    }
    if (method === 'GET' && /^\/api\/instructor\/(assessments|exams)$/.test(path))
      return send(res, requestId, store.listExams());
    if (method === 'POST' && /^\/api\/instructor\/(assessments|exams)$/.test(path)) {
      const input = await body(req);
      return send(res, requestId, store.importDraft(input.public, input.private), 201);
    }
    const questionPath =
      /^\/api\/instructor\/assessments\/([a-z0-9-]+)\/(\d+)\/questions\/([A-Za-z0-9-]+)$/.exec(path);
    if (method === 'PUT' && questionPath)
      return send(
        res,
        requestId,
        store.editDraftQuestion(questionPath[1], Number(questionPath[2]), questionPath[3], await body(req)),
      );
    const examPath =
      /^\/api\/instructor\/(?:assessments|exams)\/([a-z0-9-]+)\/(\d+)(?:\/(validate|publish|clone|archive|restore))?$/.exec(
        path,
      );
    const sourcePath =
      /^\/api\/instructor\/(?:assessments|exams)\/([a-z0-9-]+)\/(\d+)\/sources(?:\/([a-f0-9-]+))?$/.exec(
        path,
      );
    if (sourcePath) {
      const [, id, rawVersion, sourceId] = sourcePath,
        version = Number(rawVersion);
      if (method === 'GET' && !sourceId) return send(res, requestId, store.listSources(id, version));
      if (method === 'POST' && !sourceId)
        return send(res, requestId, store.addSource(id, version, await body(req)), 201);
      if (method === 'PUT' && sourceId)
        return send(res, requestId, store.reviewSource(id, version, sourceId, await body(req)));
    }
    if (examPath) {
      const [, id, rawVersion, action] = examPath,
        version = Number(rawVersion);
      if (method === 'GET' && !action) {
        const exam = store.getExam(id, version);
        return send(res, requestId, {
          status: exam.status,
          public: exam.public,
          private: exam.private,
          contentHash: exam.content_hash,
          revision: hash(exam.public_json + '\n' + exam.private_json),
        });
      }
      if (method === 'DELETE' && !action) return send(res, requestId, store.deleteActivity(id, version));
      if (method === 'PUT' && !action) {
        const input = await body(req);
        return send(res, requestId, store.updateDraft(id, version, input.public, input.private));
      }
      if (method === 'POST' && action === 'validate')
        return send(res, requestId, { errors: store.validate(id, version) });
      if (method === 'POST' && action === 'clone')
        return send(res, requestId, store.cloneExam(id, version), 201);
      if (method === 'POST' && action === 'archive')
        return send(res, requestId, store.archiveExam(id, version));
      if (method === 'POST' && action === 'restore')
        return send(res, requestId, store.restoreExam(id, version));
      if (method === 'POST' && action === 'publish') {
        const input = await body(req);
        if (input.approved !== true)
          throw Object.assign(new Error('Explicit instructor approval is required.'), {
            code: 'APPROVAL_REQUIRED',
            status: 400,
          });
        return send(res, requestId, store.publish(id, version));
      }
    }
    if (path === '/api/instructor/classes') {
      if (method === 'GET') return send(res, requestId, store.listClasses());
      if (method === 'POST') return send(res, requestId, store.createClass(await body(req)), 201);
    }
    const classStudentPath =
      /^\/api\/instructor\/classes\/([a-f0-9-]+)\/students(?:\/([A-Za-z0-9-]{1,40}))?$/.exec(path);
    if (classStudentPath) {
      const [, classId, candidateId] = classStudentPath;
      if (method === 'POST' && !candidateId)
        return send(res, requestId, store.createStudent(classId, await body(req)), 201);
      if (method === 'PUT' && candidateId)
        return send(res, requestId, store.updateStudent(classId, candidateId, await body(req)));
      if (method === 'DELETE' && candidateId)
        return send(res, requestId, store.deleteStudent(classId, candidateId));
    }
    const classPath = /^\/api\/instructor\/classes\/([a-f0-9-]+)$/.exec(path);
    if (classPath) {
      if (method === 'GET') return send(res, requestId, store.getClass(classPath[1]));
      if (method === 'PUT') return send(res, requestId, store.updateClass(classPath[1], await body(req)));
      if (method === 'DELETE') return send(res, requestId, store.deleteClass(classPath[1]));
    }
    if (method === 'GET' && path === '/api/instructor/runs') return send(res, requestId, store.listRuns());
    if (method === 'POST' && path === '/api/instructor/runs')
      return send(res, requestId, store.createRun(await body(req)), 201);
    const retryGradingPath = /^\/api\/instructor\/runs\/([a-f0-9-]+)\/retry-grading$/.exec(path);
    if (method === 'POST' && retryGradingPath)
      return send(res, requestId, store.retryGrading(retryGradingPath[1]));
    const runPinPath = /^\/api\/instructor\/runs\/([a-f0-9-]+)\/pin$/.exec(path);
    if (method === 'PUT' && runPinPath)
      return send(res, requestId, store.resetRunPin(runPinPath[1], (await body(req)).pin));
    const recoveryPath =
      /^\/api\/instructor\/runs\/([a-f0-9-]+)\/students\/([A-Za-z0-9-]{1,40})\/(extend|reopen)$/.exec(path);
    if (method === 'POST' && recoveryPath)
      return send(
        res,
        requestId,
        store.recoverStudent(recoveryPath[1], recoveryPath[2], await body(req), recoveryPath[3]),
      );
    const publishAllResultsPath = /^\/api\/instructor\/runs\/([a-f0-9-]+)\/publish-scores$/.exec(path);
    if (method === 'POST' && publishAllResultsPath) {
      await settlement.settleExpired(publishAllResultsPath[1]);
      return send(res, requestId, store.publishCompletedResults(publishAllResultsPath[1]));
    }
    const publishStudentResultsPath =
      /^\/api\/instructor\/runs\/([a-f0-9-]+)\/students\/([A-Za-z0-9-]{1,40})\/publish-scores$/.exec(path);
    if (method === 'POST' && publishStudentResultsPath) {
      const { sessionId } = store.reviewStudent(publishStudentResultsPath[1], publishStudentResultsPath[2]);
      if (sessionId) await settlement.settle(sessionId);
      return send(
        res,
        requestId,
        store.publishStudentResults(publishStudentResultsPath[1], publishStudentResultsPath[2]),
      );
    }
    const aiGradePath =
      /^\/api\/instructor\/runs\/([a-f0-9-]+)\/students\/([A-Za-z0-9-]{1,40})\/scores\/([A-Za-z0-9-]+)\/ai-check$/.exec(
        path,
      );
    if (method === 'POST' && aiGradePath) {
      limit(`ai-grading:${owner}`, 10);
      const [, gradeRun, candidate, questionId] = aiGradePath;
      const review = store.reviewStudent(gradeRun, candidate, { includeNumericGradingReference: true });
      if (!review.canOverride)
        throw Object.assign(new Error('Wait until the attempt is finished and ready for faculty grading.'), {
          code: 'ATTEMPT_IN_PROGRESS',
          status: 409,
        });
      const question = review.questions.find((item) => item.id === questionId);
      if (!question)
        throw Object.assign(new Error('Question not found.'), { code: 'NOT_FOUND', status: 404 });
      const signature = JSON.stringify(question.attempts);
      res.setTimeout(190000);
      const suggestion = await runAi(() => suggestGrade(question, { selection }));
      const current = store.reviewStudent(gradeRun, candidate);
      if (
        !current.canOverride ||
        signature !== JSON.stringify(current.questions.find((item) => item.id === questionId)?.attempts)
      )
        throw Object.assign(new Error('The attempt changed. Refresh and request a new suggestion.'), {
          code: 'STALE_REVIEW',
          status: 409,
        });
      return send(res, requestId, suggestion);
    }
    const studentReviewPath =
      /^\/api\/instructor\/runs\/([a-f0-9-]+)\/students\/([A-Za-z0-9-]{1,40})(?:\/scores\/([A-Za-z0-9-]+))?$/.exec(
        path,
      );
    if (studentReviewPath) {
      const [, runId, candidateId, activityId] = studentReviewPath;
      const { sessionId } = store.reviewStudent(runId, candidateId);
      if (sessionId) await settlement.settle(sessionId);
      if (method === 'GET' && !activityId)
        return send(res, requestId, store.reviewStudent(runId, candidateId));
      if (method === 'PUT' && activityId)
        return send(
          res,
          requestId,
          store.overrideQuestionScore(runId, candidateId, activityId, await body(req)),
        );
      if (method === 'DELETE' && activityId)
        return send(res, requestId, store.clearQuestionScoreOverride(runId, candidateId, activityId));
    }
    const proctorAccessPath = /^\/api\/instructor\/runs\/([a-f0-9-]+)\/proctor-access$/.exec(path);
    if (proctorAccessPath) {
      const runId = proctorAccessPath[1];
      if (method === 'GET') return send(res, requestId, store.proctorAccess(runId));
      if (method === 'POST')
        return send(res, requestId, store.issueProctorAccess(runId, (await body(req)).code));
      if (method === 'DELETE') return send(res, requestId, store.revokeProctorAccess(runId));
    }
    const manageRun = /^\/api\/instructor\/runs\/([a-f0-9-]+)$/.exec(path);
    if (manageRun && method === 'PUT')
      return send(res, requestId, store.updateRun(manageRun[1], await body(req)));
    if (manageRun && method === 'DELETE') return send(res, requestId, store.deleteRun(manageRun[1]));
    const runPath = /^\/api\/instructor\/runs\/([a-f0-9-]+)\/(name|results|export.csv)$/.exec(path);
    if (method === 'PUT' && runPath?.[2] === 'name')
      return send(res, requestId, store.renameRun(runPath[1], (await body(req)).name));
    if (method === 'GET' && runPath) {
      await settlement.settleExpired(runPath[1]);
      const result = store.results(runPath[1]);
      if (runPath[2] === 'export.csv') return csv(res, gradebook(result));
      return send(res, requestId, result);
    }
    if (method === 'GET' && path === '/api/instructor/audit') return send(res, requestId, store.auditLog());
    throw Object.assign(new Error('Route not found.'), { code: 'NOT_FOUND', status: 404 });
  });
}
