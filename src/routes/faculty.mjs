import {
  aiAvailable,
  generateExam,
  proposeExam,
  inspectProposal,
  buildApprovedPackage,
  checkSourceSupport,
  validateGeneratedDraft,
} from '../ai.mjs';
import { extractMaterialBounded } from '../material-extraction.mjs';
import { accessToken, clearBrowserSession } from '../http-session.mjs';
import { codingStatus, previewCode } from '../code-runner.mjs';
import { asFaculty, assertOwner } from '../faculty-access.mjs';
import { webTemplate } from '../web-template.mjs';
import { randomUUID } from 'node:crypto';

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
}) {
  const method = req.method,
    path = url.pathname;

  const instructorToken = accessToken(req, 'instructor');
  const owner = store.requireInstructor(instructorToken);
  return asFaculty(owner, async () => {
    if (method === 'POST' && path === '/api/instructor/web-template') {
      const value = webTemplate(`php-${randomUUID()}`);
      return send(res, requestId, store.importDraft(value.public, value.private), 201);
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
      });
    if (method === 'GET' && path === '/api/instructor/code/status')
      return send(res, requestId, await codingStatus());
    if (method === 'POST' && path === '/api/instructor/code/preview') {
      limit(`code-preview:instructor:${instructorToken}`, 12);
      const input = await body(req, 500_000);
      return send(res, requestId, await previewCode(input.config, input.value, store.codeRunner));
    }
    if (path === '/api/instructor/ai/proposal') {
      if (method === 'GET') return send(res, requestId, store.getAiProposal(instructorToken));
      if (method === 'PUT')
        return send(res, requestId, store.saveAiProposal(instructorToken, await body(req)));
      if (method === 'DELETE') return send(res, requestId, store.deleteAiProposal(instructorToken));
    }
    if (method === 'POST' && path === '/api/instructor/ai/inspect')
      return send(res, requestId, inspectProposal(await body(req)));
    if (method === 'POST' && path === '/api/instructor/ai/generate') {
      limit(`ai-generate:${req.socket.remoteAddress}`, 5, 3600_000);
      return send(res, requestId, await generateExam(await body(req)));
    }
    if (method === 'POST' && path === '/api/instructor/ai/propose') {
      limit(`ai-propose:${req.socket.remoteAddress}`, 5, 3600_000);
      return send(res, requestId, await proposeExam(await body(req)));
    }
    if (method === 'POST' && path === '/api/instructor/ai/approved-draft') {
      const input = await body(req);
      const packageResult = buildApprovedPackage(input);
      const created = store.tx(() => {
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
      return send(res, requestId, await checkSourceSupport(exam, sources));
    }
    if (method === 'GET' && /^\/api\/instructor\/(assessments|exams)$/.test(path))
      return send(res, requestId, store.listExams());
    if (method === 'POST' && /^\/api\/instructor\/(assessments|exams)$/.test(path)) {
      const input = await body(req);
      return send(res, requestId, store.importDraft(input.public, input.private), 201);
    }
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
        });
      }
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
    if (method === 'POST' && publishAllResultsPath)
      return send(res, requestId, store.publishCompletedResults(publishAllResultsPath[1]));
    const publishStudentResultsPath =
      /^\/api\/instructor\/runs\/([a-f0-9-]+)\/students\/([A-Za-z0-9-]{1,40})\/publish-scores$/.exec(path);
    if (method === 'POST' && publishStudentResultsPath)
      return send(
        res,
        requestId,
        store.publishStudentResults(publishStudentResultsPath[1], publishStudentResultsPath[2]),
      );
    const studentReviewPath =
      /^\/api\/instructor\/runs\/([a-f0-9-]+)\/students\/([A-Za-z0-9-]{1,40})(?:\/scores\/([A-Za-z0-9-]+))?$/.exec(
        path,
      );
    if (studentReviewPath) {
      const [, runId, candidateId, activityId] = studentReviewPath;
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
    const runPath = /^\/api\/instructor\/runs\/([a-f0-9-]+)\/(name|results|export.csv)$/.exec(path);
    if (method === 'PUT' && runPath?.[2] === 'name')
      return send(res, requestId, store.renameRun(runPath[1], (await body(req)).name));
    if (method === 'GET' && runPath) {
      const result = store.results(runPath[1]);
      if (runPath[2] === 'export.csv') return csv(res, gradebook(result));
      return send(res, requestId, result);
    }
    if (method === 'GET' && path === '/api/instructor/audit') return send(res, requestId, store.auditLog());
    throw Object.assign(new Error('Route not found.'), { code: 'NOT_FOUND', status: 404 });
  });
}
