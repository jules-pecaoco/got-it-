import { resultsReleased } from './assessment-policy.mts';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { assignedOrder, evaluate, hasSubmittableCode, hash, resolveRetryPolicy, validInspectionState, validatePackage } from './engine.mjs';
import { answerText } from '../public/answer-key.js';
import { hasAnswerValue } from '../public/answer-presence.js';
import { initializeStoreSchema } from './store-schema.mjs';
import { executeCode, previewCode, cleanupJobContainers } from './code-runner.mjs';
import { CodingQueue } from './coding-queue.mjs';
import { migrate } from './migrations.mjs';
import { facultyId, asFaculty, assertOwner, passwordHash, passwordMatches } from './faculty-access.mjs';
import { evaluateWeb } from './web-grading.mts';
import { validateProject } from '../public/web-project.js';
import { buildFacultyQuestion } from './ai.mjs';

const parse = value => JSON.parse(value);
const shuffled = values => {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
const presentationKind = pub => {
  if (pub.kind) return pub.kind;
  const title = String(pub.title ?? '').toLowerCase();
  if (/\bctf\b|capture.the.flag/.test(title)) return 'ctf';
  if (/\bquiz\b/.test(title)) return 'quiz';
  if (/\bexam\b/.test(title)) return 'exam';
  if (/\btest\b/.test(title)) return 'test';
  return 'activity';
};
const stamp = () => new Date().toISOString();
const invariant = (condition, code, message, status = 400) => { if (!condition) throw Object.assign(new Error(message), { code, status }); };
function gradableDraft(activity, response) {
  const value = response?.value;
  switch (activity.type) {
    case 'code_writing': return hasSubmittableCode(response);
    case 'data_inspection': return validInspectionState(activity.publicConfig, value);
    case 'true_false': return typeof value === 'boolean';
    case 'numeric_entry': return Number.isFinite(value);
    case 'single_choice':
    case 'text_entry':
    case 'datatable_code': return typeof value === 'string' && Boolean(value.trim());
    case 'sequencing': return Array.isArray(value) && value.length === activity.publicConfig.items.length && new Set(value).size === value.length && value.every(id => activity.publicConfig.items.some(item => item.id === id));
    case 'multiple_choice': return Array.isArray(value) && value.some(item => typeof item === 'string' && item.trim());
    case 'matching': return value && typeof value === 'object' && !Array.isArray(value) && hasAnswerValue(value);
    default: return hasAnswerValue(value);
  }
}

export class Store {
  constructor(filename = ':memory:', { codeRunner = executeCode, automaticSettlement = true } = {}) {
    this.codeRunner = codeRunner;
    this.automaticSettlement = automaticSettlement;
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    initializeStoreSchema(this.db);
    migrate(this.db);
    // Cache statements only after schema upgrades have completed.
    const prepare = this.db.prepare.bind(this.db), statements = new Map();
    this.db.prepare = sql => {
      if (!statements.has(sql)) statements.set(sql, prepare(sql));
      return statements.get(sql);
    };
    this.codingQueue = new CodingQueue(this.db, job => asFaculty(null, () => this.completeCodingJob(job)));
  }
  close() { this.codingQueue.close(); this.db.close(); }
  queueCode(sessionId, activityId, kind, submission, key = randomUUID(), expectedRevision) {
    invariant(typeof key === 'string' && /^[A-Za-z0-9-]{16,80}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'Submission retry key is invalid.');
    const existing = this.db.prepare('SELECT status,payload_json FROM coding_jobs WHERE session_id=? AND activity_id=? AND kind=? AND request_key=?').get(sessionId, activityId, kind, key);
    if (existing && submission?.value?.files) {
      const accepted = parse(existing.payload_json);
      invariant(JSON.stringify(accepted.value.files) === JSON.stringify(submission.value.files), 'IDEMPOTENCY_CONFLICT', 'Retry key belongs to a different project.', 409);
      submission = accepted;
    }
    if (existing && !['failed', 'superseded'].includes(existing.status)) return this.codingQueue.enqueue(sessionId, activityId, kind, key, submission);
    const { mission, activity } = this.codingContext(sessionId, activityId);
    invariant(['submit', 'preview'].includes(kind), 'INVALID_JOB', 'Invalid coding job.');
    if (activity.type === 'web_project') invariant(!validateProject(submission?.value).length, 'INVALID_PROJECT', validateProject(submission?.value).join(' '));
    else invariant(hasSubmittableCode(submission), 'INVALID_CODE', 'Enter 1–16,000 characters of code.');
    if (kind === 'submit') {
      this.checkDraftRevision(sessionId, activityId, expectedRevision);
      const policy = resolveRetryPolicy(mission, activity);
      const previous = this.db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE session_id=? AND activity_id=?').get(sessionId, activityId).n;
      invariant(policy.maxRetries === null || previous <= policy.maxRetries, 'ATTEMPT_LIMIT', 'No attempts remain for this question.', 403);
    }
    return this.codingQueue.enqueue(sessionId, activityId, kind, key, submission);
  }
  async completeCodingJob(job) {
    if (job.recovered && this.codeRunner === executeCode) await cleanupJobContainers(job.id);
    const { exam } = this.context(job.session_id);
    const activity = exam.public.missions.flatMap(m => m.activities).find(a => a.id === job.activity_id);
    invariant(['code_writing', 'web_project'].includes(activity?.type), 'INVALID_CODE_ACTIVITY', 'Coding question unavailable.');
    const submission = parse(job.payload_json);
    if (job.kind === 'preview') return previewCode(activity.publicConfig, submission.value, (...args) => this.codeRunner(...args, { jobId: job.id }), submission.input);
    // A persisted receipt is trusted server state: queue wait never consumes the
    // student's remaining time. Direct synchronous submissions retain their policy.
    const prior = this.db.prepare('SELECT 1 FROM submissions WHERE session_id=? AND activity_id=? AND idempotency_key=?')
      .get(job.session_id, job.activity_id, job.request_key);
    const evaluation = prior ? { awarded: [] } : activity.type === 'web_project'
      ? await evaluateWeb(activity.publicConfig, exam.private.rules[activity.gradingRuleId], submission)
      : evaluate(activity, exam.private.rules[activity.gradingRuleId], submission);
    return this.#submitEvaluated(job.session_id, job.activity_id, submission, job.request_key, evaluation, job.accepted_at);
  }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  audit(actor, action, target, detail = {}) {
    const targetOwner = this.db.prepare('SELECT r.owner_id FROM sessions s JOIN runs r ON r.id=s.run_id WHERE s.id=?').get(target)?.owner_id;
    this.db.prepare('INSERT INTO audit_events(id,actor,action,target,detail_json,at,owner_id) VALUES (?,?,?,?,?,?,?)')
      .run(randomUUID(), facultyId() || actor, action, target, JSON.stringify(detail), stamp(), facultyId() || targetOwner || 'faculty');
  }
  importDraft(pub, priv, actor = 'instructor') {
    invariant(pub?.examId && Number.isInteger(pub?.version), 'INVALID_PACKAGE', 'examId and version are required.');
    invariant(!this.db.prepare('SELECT 1 FROM exams WHERE exam_id=? AND version=?').get(pub.examId, pub.version), 'VERSION_EXISTS', 'This version already exists.', 409);
    this.db.prepare('INSERT INTO exams (exam_id,version,status,public_json,private_json) VALUES (?,?,?,?,?)')
      .run(pub.examId, pub.version, 'draft', JSON.stringify(pub), JSON.stringify(priv));
    this.db.prepare('UPDATE exams SET owner_id=? WHERE exam_id=? AND version=?').run(facultyId() || 'faculty', pub.examId, pub.version);
    this.audit(actor, 'import_draft', `${pub.examId}@${pub.version}`);
    return { examId: pub.examId, version: pub.version, status: 'draft' };
  }
  updateDraft(examId, version, pub, priv, actor = 'instructor') {
    const existing = this.getExam(examId, version);
    invariant(existing.status === 'draft', 'IMMUTABLE_VERSION', 'Published versions cannot be edited.', 409);
    invariant(pub?.examId === examId && pub?.version === version, 'INVALID_PACKAGE', 'Package identity and version cannot change.');
    this.db.prepare('UPDATE exams SET public_json=?,private_json=? WHERE exam_id=? AND version=?')
      .run(JSON.stringify(pub), JSON.stringify(priv), examId, version);
    this.audit(actor, 'update_draft', `${examId}@${version}`);
    return { examId, version, status: 'draft' };
  }
  editDraftQuestion(examId, version, activityId, input) {
    return this.tx(() => {
      const exam = this.getExam(examId, version);
      invariant(exam.status === 'draft' && !exam.archived_at, 'IMMUTABLE_VERSION', 'Only active drafts can be edited.', 409);
      invariant(input?.revision === hash(exam.public_json + '\n' + exam.private_json), 'DRAFT_CHANGED', 'This draft changed. Refresh it before saving your edits.', 409);
      const pub = structuredClone(exam.public), priv = structuredClone(exam.private);
      const mission = pub.missions.find(m => m.activities.some(a => a.id === activityId));
      const index = mission?.activities.findIndex(a => a.id === activityId);
      invariant(mission && index >= 0, 'ACTIVITY_NOT_FOUND', 'Question not found.', 404);
      const previous = mission.activities[index], oldRule = priv.rules[previous.gradingRuleId];
      const points = input.question?.points;
      invariant(Number.isInteger(points) && points >= 1 && points <= 10000, 'INVALID_POINTS', 'Use a whole-number question score from 1 to 10,000.');
      const built = buildFacultyQuestion(input.question);
      // Retain existing HTTP checks when editing older web projects.
      if (previous.type === 'web_project' && built.activity.type === 'web_project') {
        built.rule.criteria = [...oldRule.criteria.filter(c => c.answer.kind === 'http'), ...built.rule.criteria];
      }
      const criteria = built.rule.criteria;
      invariant(points >= criteria.length, 'INVALID_POINTS', `This question needs at least ${criteria.length} points for its grading criteria.`);
      const weights = criteria.map((criterion, i) => previous.type === built.activity.type && oldRule.criteria.length === criteria.length ? oldRule.criteria[i].points : criterion.points);
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const allocated = weights.map(weight => Math.floor(points * weight / total));
      let remainder = points - allocated.reduce((sum, value) => sum + value, 0);
      const order = weights.map((weight, i) => ({ i, fraction: points * weight / total - allocated[i] })).sort((a, b) => b.fraction - a.fraction);
      for (const { i } of order) if (remainder-- > 0) allocated[i]++;
      invariant(allocated.every(value => value > 0), 'INVALID_POINTS', 'Increase the question score so each grading criterion receives at least one point.');
      built.rule.criteria = criteria.map((criterion, i) => ({ ...criterion, id: `edited-${activityId}-${i + 1}`, points: allocated[i] }));
      mission.activities[index] = { ...previous, ...built.activity, id: activityId, gradingRuleId: previous.gradingRuleId, maxPoints: points };
      delete mission.activities[index].sourceRefs;
      priv.rules[previous.gradingRuleId] = built.rule;
      if (priv.evidence) priv.evidence = priv.evidence.filter(item => item.activityId !== activityId);
      mission.maxPoints = mission.activities.reduce((sum, activity) => sum + activity.maxPoints, 0);
      pub.settings.coreMaxPoints = pub.missions.reduce((sum, item) => sum + item.maxPoints, 0);
      const errors = validatePackage(pub, priv);
      invariant(!errors.length, 'INVALID_QUESTION', errors.join(' '), 422);
      this.updateDraft(examId, version, pub, priv);
      this.audit('instructor', 'edit_question', `${examId}@${version}`, { activityId });
      return { saved: true };
    });
  }
  cloneExam(examId, version, actor = 'instructor') {
    return this.tx(() => {
      const source = this.getExam(examId, version);
      const nextVersion = this.db.prepare('SELECT COALESCE(MAX(version),0)+1 AS version FROM exams WHERE exam_id=?').get(examId).version;
      const pub = { ...source.public, version: nextVersion };
      const documents = this.listSources(examId, version);
      this.db.prepare('INSERT INTO exams (exam_id,version,status,public_json,private_json) VALUES (?,?,?,?,?)')
        .run(examId, nextVersion, 'draft', JSON.stringify(pub), JSON.stringify(source.private));
      this.db.prepare('UPDATE exams SET owner_id=? WHERE exam_id=? AND version=?').run(source.owner_id, examId, nextVersion);
      const insert = this.db.prepare('INSERT INTO source_documents VALUES (?,?,?,?,?,?,?,?)');
      for (const document of documents) insert.run(randomUUID(), examId, nextVersion, document.filename,
        document.content, document.coverage ? JSON.stringify(document.coverage) : null,
        document.reviewStatus, stamp());
      this.audit(actor, 'clone_exam', `${examId}@${nextVersion}`, { fromVersion: version });
      return { examId, version: nextVersion, status: 'draft' };
    });
  }
  getExam(examId, version) {
    const row = this.db.prepare('SELECT * FROM exams WHERE exam_id=? AND version=?').get(examId, version);
    invariant(row, 'EXAM_NOT_FOUND', 'Activity version not found.', 404);
    assertOwner(row.owner_id);
    return { ...row, public: parse(row.public_json), private: parse(row.private_json) };
  }
  listExams() {
    return this.db.prepare('SELECT exam_id,version,status,public_json,published_at,archived_at FROM exams WHERE (? IS NULL OR owner_id=?) ORDER BY exam_id,version DESC').all(facultyId(), facultyId())
      .map(r => {
        const pub = parse(r.public_json);
        return { examId: r.exam_id, version: r.version, status: r.status, title: pub.title,
          kind: presentationKind(pub), subject: pub.subject || '', difficulty: pub.difficulty || null,
          publishedAt: r.published_at, archivedAt: r.archived_at };
      });
  }
  archiveExam(examId, version, actor = 'instructor') {
    return this.tx(() => {
      const exam = this.getExam(examId, version);
      invariant(exam.status === 'draft', 'ARCHIVE_DENIED', 'Only unpublished drafts can be archived.', 409);
      invariant(!exam.archived_at, 'ALREADY_ARCHIVED', 'This draft is already archived.', 409);
      invariant(!this.db.prepare('SELECT 1 FROM runs WHERE exam_id=? AND version=?').get(examId, version),
        'ARCHIVE_DENIED', 'Drafts with runs cannot be archived.', 409);
      const archivedAt = stamp();
      this.db.prepare('UPDATE exams SET archived_at=? WHERE exam_id=? AND version=?').run(archivedAt, examId, version);
      this.audit(actor, 'archive_exam', `${examId}@${version}`);
      return { examId, version, archivedAt };
    });
  }
  restoreExam(examId, version, actor = 'instructor') {
    return this.tx(() => {
      const exam = this.getExam(examId, version);
      invariant(!!exam.archived_at, 'NOT_ARCHIVED', 'This draft is not archived.', 409);
      this.db.prepare('UPDATE exams SET archived_at=NULL WHERE exam_id=? AND version=?').run(examId, version);
      this.audit(actor, 'restore_exam', `${examId}@${version}`);
      return { examId, version, archivedAt: null };
    });
  }
  validate(examId, version) {
    const exam = this.getExam(examId, version);
    const errors = validatePackage(exam.public, exam.private);
    const sources = this.listSources(examId, version);
    for (const activity of (Array.isArray(exam.public.missions) ? exam.public.missions : []).flatMap(m => Array.isArray(m?.activities) ? m.activities : [])) {
      for (const ref of Array.isArray(activity?.sourceRefs) ? activity.sourceRefs : []) {
        if (!sources.some(source => source.filename === ref.file))
          errors.push(`${activity.id}: source ${ref.file} is missing.`);
      }
    }
    return errors;
  }
  addSource(examId, version, input, actor = 'instructor') {
    const exam = this.getExam(examId, version);
    invariant(exam.status === 'draft', 'IMMUTABLE_VERSION', 'Sources can only be added to a draft.', 409);
    invariant(typeof input.filename === 'string' && /^[^\\/<>:"|?*]{1,120}\.(txt|md|pdf|pptx)$/i.test(input.filename), 'UNSUPPORTED_SOURCE', 'Use a .txt, .md, .pdf or .pptx source file.');
    invariant(typeof input.content === 'string' && input.content.length > 0 && input.content.length <= 250000, 'INVALID_SOURCE', 'Text source must contain 1–250000 characters.');
    const id = randomUUID();
    this.db.prepare('INSERT INTO source_documents VALUES (?,?,?,?,?,?,?,?)')
      .run(id, examId, version, input.filename, input.content, null, 'pending_review', stamp());
    this.audit(actor, 'add_source', id, { examId, version, filename: input.filename });
    return { id, filename: input.filename, reviewStatus: 'pending_review' };
  }
  listSources(examId, version) {
    this.getExam(examId, version);
    return this.db.prepare('SELECT * FROM source_documents WHERE exam_id=? AND version=? ORDER BY uploaded_at').all(examId, version)
      .map(row => ({ id: row.id, filename: row.filename, content: row.content_text,
        coverage: row.coverage_json ? parse(row.coverage_json) : null,
        reviewStatus: row.review_status, uploadedAt: row.uploaded_at }));
  }
  reviewSource(examId, version, sourceId, coverage, actor = 'instructor') {
    const exam = this.getExam(examId, version);
    invariant(exam.status === 'draft', 'IMMUTABLE_VERSION', 'Source reviews can only be updated on a draft.', 409);
    const row = this.db.prepare('SELECT 1 FROM source_documents WHERE id=? AND exam_id=? AND version=?').get(sourceId, examId, version);
    invariant(row, 'SOURCE_NOT_FOUND', 'Source document not found.', 404);
    invariant(coverage && typeof coverage === 'object' &&
      ['topic', 'learningOutcome', 'proposedActivityType', 'evidence'].every(key => typeof coverage[key] === 'string' && coverage[key].trim()),
    'INVALID_COVERAGE', 'Coverage needs topic, learningOutcome, proposedActivityType and evidence.');
    this.db.prepare('UPDATE source_documents SET coverage_json=?,review_status=? WHERE id=?')
      .run(JSON.stringify(coverage), 'reviewed', sourceId);
    this.audit(actor, 'review_source', sourceId, { examId, version });
    return { id: sourceId, reviewStatus: 'reviewed' };
  }
  publish(examId, version, actor = 'instructor') {
    const exam = this.getExam(examId, version);
    invariant(exam.status === 'draft', 'IMMUTABLE_VERSION', 'Published versions cannot be edited or republished.', 409);
    const errors = this.validate(examId, version);
    invariant(!errors.length, 'PACKAGE_INVALID', errors.join(' '), 422);
    const contentHash = hash(exam.public_json + '\n' + exam.private_json);
    const publishedAt = stamp();
    this.db.prepare("UPDATE exams SET status='published',content_hash=?,published_at=? WHERE exam_id=? AND version=?")
      .run(contentHash, publishedAt, examId, version);
    this.audit(actor, 'publish', `${examId}@${version}`, { contentHash });
    return { examId, version, status: 'published', contentHash, publishedAt };
  }
  listClasses() {
    return this.db.prepare(`SELECT c.id,c.name,c.section,c.created_at,c.updated_at,
      COUNT(s.candidate_id) AS student_count FROM classes c
      LEFT JOIN class_students s ON s.class_id=c.id
      WHERE (? IS NULL OR c.owner_id=?) GROUP BY c.id ORDER BY c.name COLLATE NOCASE,c.section`).all(facultyId(), facultyId())
      .map(row => ({ id: row.id, name: row.name, section: row.section,
        studentCount: row.student_count, createdAt: row.created_at, updatedAt: row.updated_at }));
  }
  getClass(classId) {
    const row = this.db.prepare('SELECT * FROM classes WHERE id=?').get(classId);
    invariant(row, 'CLASS_NOT_FOUND', 'Class not found.', 404);
    assertOwner(row.owner_id);
    const roster = this.db.prepare('SELECT candidate_id,display_name,gender,year_level,program_short_name FROM class_students WHERE class_id=? ORDER BY display_name COLLATE NOCASE,candidate_id').all(classId)
      .map(student => ({ candidateId: student.candidate_id, displayName: student.display_name,
        gender: student.gender || '', yearLevel: student.year_level || '', programShortName: student.program_short_name || '',
        section: row.section }));
    return { id: row.id, name: row.name, section: row.section, roster,
      studentCount: roster.length, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  classInput(input, requireRoster) {
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    const section = typeof input?.section === 'string' ? input.section.trim() : '';
    invariant(name.length >= 1 && name.length <= 80 && section.length >= 1 && section.length <= 40,
      'INVALID_CLASS', 'Enter a class name and section.');
    const roster = input?.roster;
    invariant(!requireRoster || Array.isArray(roster), 'INVALID_CLASS', 'Upload a roster for this class.');
    if (roster !== undefined) {
      invariant(Array.isArray(roster) && roster.length >= 1 && roster.length <= 500,
        'INVALID_CLASS', 'A class needs 1–500 students.');
      const ids = new Set();
      for (const student of roster) {
        const id = student?.candidateId, displayName = student?.displayName;
        invariant(typeof id === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(id) &&
          typeof displayName === 'string' && displayName.trim().length >= 1 && displayName.trim().length <= 120 && !ids.has(id),
        'INVALID_CLASS', 'Each student needs a unique school ID and name.');
        invariant(['gender', 'yearLevel', 'programShortName'].every(key => student[key] === undefined ||
          (typeof student[key] === 'string' && student[key].length <= 120)),
        'INVALID_CLASS', 'Student details must be text.');
        ids.add(id);
      }
    }
    return { name, section, roster };
  }
  studentInput(input) {
    const candidateId = input?.candidateId;
    const displayName = typeof input?.displayName === 'string' ? input.displayName.trim() : '';
    invariant(typeof candidateId === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(candidateId) &&
      displayName.length >= 1 && displayName.length <= 120,
    'INVALID_STUDENT', 'Enter a school ID (letters, numbers, hyphens) and student name.');
    const details = {};
    for (const key of ['gender', 'yearLevel', 'programShortName']) {
      const value = input[key] === undefined ? '' : input[key];
      invariant(typeof value === 'string' && value.length <= 120,
        'INVALID_STUDENT', 'Student details must be text of 120 characters or less.');
      details[key] = value.trim();
    }
    return { candidateId, displayName, ...details };
  }
  createStudent(classId, input, actor = 'instructor') {
    const student = this.studentInput(input);
    this.getClass(classId);
    invariant(this.db.prepare('SELECT COUNT(*) AS count FROM class_students WHERE class_id=?').get(classId).count < 500,
      'CLASS_FULL', 'A class can have at most 500 students.', 409);
    invariant(!this.db.prepare('SELECT 1 FROM class_students WHERE class_id=? AND candidate_id=?').get(classId, student.candidateId),
      'STUDENT_EXISTS', 'This school ID is already in the class.', 409);
    this.tx(() => {
      this.db.prepare('INSERT INTO class_students (class_id,candidate_id,display_name,gender,year_level,program_short_name) VALUES (?,?,?,?,?,?)')
        .run(classId, student.candidateId, student.displayName, student.gender, student.yearLevel, student.programShortName);
      this.db.prepare('UPDATE classes SET updated_at=? WHERE id=?').run(stamp(), classId);
      this.audit(actor, 'create_class_student', classId, { candidateId: student.candidateId });
    });
    return this.getClass(classId);
  }
  updateStudent(classId, originalId, input, actor = 'instructor') {
    const student = this.studentInput(input);
    this.getClass(classId);
    invariant(this.db.prepare('SELECT 1 FROM class_students WHERE class_id=? AND candidate_id=?').get(classId, originalId),
      'STUDENT_NOT_FOUND', 'Student not found in this class.', 404);
    invariant(student.candidateId === originalId ||
      !this.db.prepare('SELECT 1 FROM class_students WHERE class_id=? AND candidate_id=?').get(classId, student.candidateId),
      'STUDENT_EXISTS', 'This school ID is already in the class.', 409);
    this.tx(() => {
      this.db.prepare('UPDATE class_students SET candidate_id=?,display_name=?,gender=?,year_level=?,program_short_name=? WHERE class_id=? AND candidate_id=?')
        .run(student.candidateId, student.displayName, student.gender, student.yearLevel, student.programShortName, classId, originalId);
      this.db.prepare('UPDATE classes SET updated_at=? WHERE id=?').run(stamp(), classId);
      this.audit(actor, 'update_class_student', classId, { originalId, candidateId: student.candidateId });
    });
    return this.getClass(classId);
  }
  deleteStudent(classId, candidateId, actor = 'instructor') {
    this.getClass(classId);
    invariant(this.db.prepare('SELECT 1 FROM class_students WHERE class_id=? AND candidate_id=?').get(classId, candidateId),
      'STUDENT_NOT_FOUND', 'Student not found in this class.', 404);
    this.tx(() => {
      this.db.prepare('DELETE FROM class_students WHERE class_id=? AND candidate_id=?').run(classId, candidateId);
      this.db.prepare('UPDATE classes SET updated_at=? WHERE id=?').run(stamp(), classId);
      this.audit(actor, 'delete_class_student', classId, { candidateId });
    });
    return this.getClass(classId);
  }
  createClass(input, actor = 'instructor') {
    const { name, section, roster } = this.classInput(input, true);
    const id = randomUUID(), now = stamp();
    this.tx(() => {
      this.db.prepare('INSERT INTO classes(id,name,section,created_at,updated_at,owner_id) VALUES (?,?,?,?,?,?)').run(id, name, section, now, now, facultyId() || 'faculty');
      const insert = this.db.prepare('INSERT INTO class_students (class_id,candidate_id,display_name,gender,year_level,program_short_name) VALUES (?,?,?,?,?,?)');
      for (const student of roster) insert.run(id, student.candidateId, student.displayName.trim(),
        student.gender || '', student.yearLevel || '', student.programShortName || '');
      this.audit(actor, 'create_class', id, { name, section, studentCount: roster.length });
    });
    return this.getClass(id);
  }
  updateClass(classId, input, actor = 'instructor') {
    this.getClass(classId);
    const { name, section, roster } = this.classInput(input, false);
    this.tx(() => {
      this.db.prepare('UPDATE classes SET name=?,section=?,updated_at=? WHERE id=?').run(name, section, stamp(), classId);
      if (roster !== undefined) {
        this.db.prepare('DELETE FROM class_students WHERE class_id=?').run(classId);
        const insert = this.db.prepare('INSERT INTO class_students (class_id,candidate_id,display_name,gender,year_level,program_short_name) VALUES (?,?,?,?,?,?)');
        for (const student of roster) insert.run(classId, student.candidateId, student.displayName.trim(),
          student.gender || '', student.yearLevel || '', student.programShortName || '');
      }
      this.audit(actor, 'update_class', classId, { name, section, rosterReplaced: roster !== undefined });
    });
    return this.getClass(classId);
  }
  deleteClass(classId, actor = 'instructor') {
    const existing = this.getClass(classId);
    this.tx(() => {
      this.db.prepare('DELETE FROM classes WHERE id=?').run(classId);
      this.audit(actor, 'delete_class', classId, { name: existing.name, section: existing.section });
    });
    return { id: classId, deleted: true };
  }
  createRun(input, actor = 'instructor') {
    const exam = this.getExam(input.examId, input.version);
    invariant(exam.status === 'published', 'EXAM_NOT_PUBLISHED', 'Publish the activity version first.', 409);
    invariant(input.name === undefined || input.name === null || typeof input.name === 'string',
      'INVALID_RUN', 'Run name must be text.');
    const name = input.name === undefined || input.name === null || input.name === '' ? null : input.name.trim();
    invariant(name === null || (name.length >= 1 && name.length <= 80), 'INVALID_RUN', 'Run name must be 1–80 characters.', 400);
    const feedbackMode = input.feedbackMode ?? 'graded';
    invariant(['practice', 'graded'].includes(feedbackMode), 'INVALID_RUN', 'Choose Practice or Graded feedback.');
    invariant(input.shuffleQuestions === undefined || typeof input.shuffleQuestions === 'boolean',
      'INVALID_RUN', 'Shuffle questions must be on or off.');
    const shuffleQuestions = input.shuffleQuestions === true;
    invariant(typeof input.pin === 'string' && input.pin.length >= 4, 'INVALID_RUN', 'A PIN of at least four characters is required.');
    const opens = Date.parse(input.opensAt), closes = Date.parse(input.closesAt);
    invariant(Number.isFinite(opens) && Number.isFinite(closes) && closes > opens, 'INVALID_RUN', 'Valid opening and closing times are required.');
    invariant(input.classId === undefined || (typeof input.classId === 'string' && input.classId.length > 0),
      'INVALID_RUN', 'Choose a valid saved class.');
    invariant(!(input.classId && input.roster), 'INVALID_RUN', 'Choose a saved class or supply a roster.');
    const assignedClass = input.classId ? this.getClass(input.classId) : null;
    const roster = assignedClass?.roster ?? input.roster;
    invariant(Array.isArray(roster) && roster.length, 'INVALID_RUN', 'Choose a class with students.');
    const ids = new Set();
    for (const r of roster) {
      invariant(typeof r.candidateId === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(r.candidateId) && r.displayName && r.section,
        'INVALID_ROSTER', 'Each roster member needs a school ID, name, and section.');
      invariant(!ids.has(r.candidateId), 'INVALID_ROSTER', 'Duplicate roster ID.'); ids.add(r.candidateId);
    }
    const id = randomUUID();
    this.tx(() => {
      this.db.prepare('INSERT INTO runs (id,exam_id,version,pin_hash,opens_at,closes_at,status,name,class_id,class_name,feedback_mode,shuffle_questions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, input.examId, input.version, hash(input.pin), new Date(opens).toISOString(), new Date(closes).toISOString(), 'open', name,
          assignedClass?.id ?? null, assignedClass?.name ?? null, feedbackMode, Number(shuffleQuestions));
      this.db.prepare('UPDATE runs SET owner_id=? WHERE id=?').run(facultyId() || 'faculty', id);
      const insert = this.db.prepare('INSERT INTO roster (run_id,candidate_id,display_name,section) VALUES (?,?,?,?)');
      for (const r of roster) insert.run(id, r.candidateId, r.displayName, r.section);
      this.audit(actor, 'create_run', id, { examId: input.examId, version: input.version, name,
        classId: assignedClass?.id ?? null, rosterCount: ids.size, feedbackMode, shuffleQuestions });
    });
    return { id, examId: input.examId, version: input.version, name: name || exam.public.title,
      classId: assignedClass?.id ?? null, className: assignedClass?.name ?? null,
      opensAt: new Date(opens).toISOString(), closesAt: new Date(closes).toISOString(),
      rosterCount: ids.size, feedbackMode, shuffleQuestions };
  }
  listRuns() {
    return this.db.prepare(`SELECT r.id,r.exam_id,r.version,r.opens_at,r.closes_at,r.status,r.name,r.class_id,r.class_name,r.feedback_mode,r.shuffle_questions,e.public_json
      FROM runs r JOIN exams e ON e.exam_id=r.exam_id AND e.version=r.version
      WHERE (? IS NULL OR r.owner_id=?) ORDER BY r.opens_at DESC`).all(facultyId(), facultyId())
      .map(r => {
        const examTitle = parse(r.public_json).title;
        return { id: r.id, examId: r.exam_id, examTitle, version: r.version,
          name: r.name || examTitle, classId: r.class_id, className: r.class_name,
          opensAt: r.opens_at, closesAt: r.closes_at, status: r.status,
          feedbackMode: r.feedback_mode, shuffleQuestions: !!r.shuffle_questions };
      });
  }
  renameRun(runId, inputName, actor = 'instructor') {
    const row = this.db.prepare('SELECT id FROM runs WHERE id=?').get(runId);
    invariant(row, 'RUN_NOT_FOUND', 'Run not found.', 404);
    const name = typeof inputName === 'string' ? inputName.trim() : '';
    invariant(name.length >= 1 && name.length <= 80, 'INVALID_RUN', 'Run name must be 1–80 characters.');
    this.db.prepare('UPDATE runs SET name=? WHERE id=?').run(name, runId);
    this.audit(actor, 'rename_run', runId, { name });
    return { id: runId, name };
  }
  updateRun(runId, input, actor = 'instructor') {
    return this.tx(() => {
      const run = this.db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
      invariant(run, 'RUN_NOT_FOUND', 'Run not found.', 404); assertOwner(run.owner_id);
      const name = typeof input?.name === 'string' ? input.name.trim() : run.name;
      invariant(name && name.length <= 80, 'INVALID_RUN', 'Run name must be 1–80 characters.');
      const closesAt = input?.closesAt === undefined ? run.closes_at : input.closesAt;
      invariant(typeof closesAt === 'string' && Number.isFinite(Date.parse(closesAt)) && Date.parse(closesAt) > Date.parse(run.opens_at), 'INVALID_RUN', 'Closing time must be after the opening time.');
      const active = this.db.prepare("SELECT MAX(deadline_at) AS deadline FROM sessions WHERE run_id=? AND status='in_progress' AND deadline_at>?").get(runId, stamp()).deadline;
      invariant(!active || Date.parse(closesAt) >= Date.parse(active), 'ACTIVE_ATTEMPTS', 'Closing time cannot cut short an active attempt.', 409);
      const closing = new Date(closesAt).toISOString();
      this.db.prepare('UPDATE runs SET name=?,closes_at=? WHERE id=?').run(name, closing, runId);
      this.audit(actor, 'update_run', runId, {name,closesAt:closing});
      return {id:runId,name,closesAt:closing};
    });
  }
  deleteRunRecords(runId) {
    const active = this.db.prepare("SELECT 1 FROM sessions WHERE run_id=? AND status='in_progress' AND deadline_at>?").get(runId, stamp());
    invariant(!active, 'ACTIVE_ATTEMPTS', 'Students are still taking this run. Finish their attempts before deleting it.', 409);
    invariant(!this.db.prepare("SELECT 1 FROM coding_jobs WHERE session_id IN (SELECT id FROM sessions WHERE run_id=?) AND status IN ('queued','running')").get(runId), 'GRADING_PENDING', 'Wait for queued or running grading to finish before deleting.', 409);
    for (const table of ['coding_jobs','penalty_events','score_overrides','answer_drafts','score_events','submissions'])
      this.db.prepare(`DELETE FROM ${table} WHERE session_id IN (SELECT id FROM sessions WHERE run_id=?)`).run(runId);
    this.db.prepare('DELETE FROM sessions WHERE run_id=?').run(runId);
    this.db.prepare('DELETE FROM proctor_tokens WHERE run_id=?').run(runId);
    this.db.prepare('DELETE FROM roster WHERE run_id=?').run(runId);
    this.db.prepare('DELETE FROM runs WHERE id=?').run(runId);
  }
  deleteRun(runId, actor = 'instructor') {
    return this.tx(() => {
      const run = this.db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
      invariant(run, 'RUN_NOT_FOUND', 'Run not found.', 404); assertOwner(run.owner_id);
      this.deleteRunRecords(runId); this.audit(actor, 'delete_run', runId, {name:run.name});
      return {id:runId,deleted:true};
    });
  }
  deleteActivity(examId, version, actor = 'instructor') {
    return this.tx(() => {
      const exam = this.getExam(examId,version);
      const runs = this.db.prepare('SELECT id,owner_id FROM runs WHERE exam_id=? AND version=?').all(examId,version);
      for (const run of runs) { assertOwner(run.owner_id); this.deleteRunRecords(run.id); }
      this.db.prepare('DELETE FROM source_documents WHERE exam_id=? AND version=?').run(examId,version);
      this.db.prepare('DELETE FROM exams WHERE exam_id=? AND version=?').run(examId,version);
      this.audit(actor,'delete_activity',`${examId}@${version}`,{title:exam.public.title,runs:runs.length});
      return {examId,version,deleted:true,deletedRuns:runs.length};
    });
  }
  resetRunPin(runId, pin, actor = 'instructor') {
    invariant(this.db.prepare('SELECT 1 FROM runs WHERE id=?').get(runId), 'RUN_NOT_FOUND', 'Run not found.', 404);
    invariant(typeof pin === 'string' && pin.length >= 4 && pin.length <= 80,
      'INVALID_RUN', 'A PIN of 4–80 characters is required.');
    this.tx(() => {
      this.db.prepare('UPDATE runs SET pin_hash=? WHERE id=?').run(hash(pin), runId);
      this.audit(actor, 'reset_run_pin', runId, {});
    });
    return { id: runId, pinUpdated: true };
  }
  proctorAccess(runId) {
    const run = this.db.prepare('SELECT proctor_code_hash,proctor_code_issued_at,closes_at FROM runs WHERE id=?').get(runId);
    invariant(run, 'RUN_NOT_FOUND', 'Run not found.', 404);
    return { enabled: !!run.proctor_code_hash && Date.now() < Date.parse(run.closes_at),
      issuedAt: run.proctor_code_issued_at, closesAt: run.closes_at };
  }
  issueProctorAccess(runId, inputCode, actor = 'instructor') {
    const run = this.db.prepare('SELECT id,closes_at FROM runs WHERE id=?').get(runId);
    invariant(run, 'RUN_NOT_FOUND', 'Run not found.', 404);
    invariant(Date.now() < Date.parse(run.closes_at), 'RUN_CLOSED', 'This run has ended.', 409);
    const code = typeof inputCode === 'string' ? inputCode.trim() : '';
    invariant(code.length >= 8 && code.length <= 100, 'INVALID_PROCTOR_CODE', 'Use a proctor code from 8 to 100 characters.');
    this.tx(() => {
      this.db.prepare('UPDATE runs SET proctor_code_hash=?,proctor_code_issued_at=? WHERE id=?')
        .run(hash(code), stamp(), runId);
      this.db.prepare('DELETE FROM proctor_tokens WHERE run_id=?').run(runId);
      this.audit(actor, 'issue_proctor_access', runId);
    });
    return { runId, code, ...this.proctorAccess(runId) };
  }
  revokeProctorAccess(runId, actor = 'instructor') {
    this.proctorAccess(runId);
    this.tx(() => {
      this.db.prepare('UPDATE runs SET proctor_code_hash=NULL,proctor_code_issued_at=NULL WHERE id=?').run(runId);
      this.db.prepare('DELETE FROM proctor_tokens WHERE run_id=?').run(runId);
      this.audit(actor, 'revoke_proctor_access', runId);
    });
    return { runId, enabled: false };
  }
  loginProctor(runId, code) {
    const run = typeof runId === 'string' && this.db.prepare('SELECT id,proctor_code_hash,closes_at FROM runs WHERE id=?').get(runId);
    const expected = run?.proctor_code_hash;
    const valid = typeof code === 'string' && code.length <= 100 && expected &&
      timingSafeEqual(Buffer.from(hash(code), 'hex'), Buffer.from(expected, 'hex'));
    invariant(valid, 'UNAUTHORIZED', 'Invalid run ID or proctor code.', 401);
    invariant(Date.now() < Date.parse(run.closes_at), 'RUN_CLOSED', 'This run has ended.', 403);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Math.min(Date.now() + 8 * 3600_000, Date.parse(run.closes_at))).toISOString();
    this.db.prepare('INSERT INTO proctor_tokens (token_hash,run_id,expires_at) VALUES (?,?,?)')
      .run(hash(token), runId, expiresAt);
    this.audit('proctor', 'proctor_login', runId);
    return { token, expiresAt, runId };
  }
  requireProctor(token) {
    const row = token && this.db.prepare(`SELECT p.run_id,p.expires_at,r.closes_at,r.proctor_code_hash
      FROM proctor_tokens p JOIN runs r ON r.id=p.run_id WHERE p.token_hash=?`).get(hash(token));
    invariant(row && row.proctor_code_hash && Date.now() < Date.parse(row.expires_at) &&
      Date.now() < Date.parse(row.closes_at), 'UNAUTHORIZED', 'Proctor sign-in required.', 401);
    return row.run_id;
  }
  logoutProctor(token) {
    this.requireProctor(token);
    this.db.prepare('DELETE FROM proctor_tokens WHERE token_hash=?').run(hash(token));
    return { signedOut: true };
  }
  proctorView(runId) {
    const run = this.db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
    invariant(run, 'RUN_NOT_FOUND', 'Run not found.', 404);
    const exam = this.getExam(run.exam_id, run.version);
    const activities = exam.public.missions.flatMap(mission => mission.activities);
    const questionCount = activities.length;
    const byId = new Map(activities.map(activity => [activity.id, activity]));
    const answers = new Map();
    for (const answer of this.db.prepare(`SELECT DISTINCT s.id AS session_id, sub.activity_id, NULL AS response_json
      FROM submissions sub JOIN sessions s ON s.id=sub.session_id WHERE s.run_id=?
      UNION ALL
      SELECT s.id, d.activity_id, d.response_json
      FROM answer_drafts d JOIN sessions s ON s.id=d.session_id WHERE s.run_id=? AND s.status='in_progress'`).iterate(runId, runId)) {
      const activity = byId.get(answer.activity_id);
      if (!activity || (answer.response_json !== null && !gradableDraft(activity, parse(answer.response_json)))) continue;
      if (!answers.has(answer.session_id)) answers.set(answer.session_id, new Set());
      answers.get(answer.session_id).add(answer.activity_id);
    }
    const rows = this.db.prepare(`SELECT r.candidate_id,r.display_name,r.section,s.id AS session_id,s.status,s.started_at,s.deadline_at,s.last_seen_at,
      (SELECT MAX(sub.at) FROM submissions sub WHERE sub.session_id=s.id) AS last_submission_at
      FROM roster r LEFT JOIN sessions s ON s.run_id=r.run_id AND s.candidate_id=r.candidate_id
      WHERE r.run_id=? ORDER BY r.section,r.display_name COLLATE NOCASE`).all(runId)
      .map(row => ({ candidateId: row.candidate_id, displayName: row.display_name, section: row.section,
        status: row.status === 'in_progress' && Date.now() >= Date.parse(row.deadline_at) ? 'expired'
          : row.status || 'registered',
        startedAt: row.started_at, deadlineAt: row.deadline_at, lastSeenAt: row.last_seen_at,
        answeredCount: answers.get(row.session_id)?.size || 0, lastSubmissionAt: row.last_submission_at }));
    const counts = { registered: 0, in_progress: 0, submitted: 0, expired: 0 };
    for (const row of rows) counts[row.status]++;
    return { runId, name: run.name || exam.public.title, activityTitle: exam.public.title,
      version: run.version, className: run.class_name, opensAt: run.opens_at, closesAt: run.closes_at,
      questionCount, counts, rows, updatedAt: stamp() };
  }
  setFacultyPassword(id, password) {
    invariant(typeof id === 'string' && /^[a-z0-9-]{3,40}$/.test(id), 'INVALID_FACULTY', 'Use a faculty username of 3–40 lowercase letters, digits or hyphens.');
    this.db.prepare(`INSERT INTO faculty_accounts VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash`)
      .run(id, passwordHash(password), stamp());
    this.db.prepare('DELETE FROM instructor_tokens WHERE faculty_id=?').run(id);
  }
  loginInstructor(password, configuredPassword, username = 'faculty') {
    const account = this.db.prepare('SELECT password_hash FROM faculty_accounts WHERE id=?').get(username);
    const valid = account ? passwordMatches(password, account.password_hash)
      : username === 'faculty' && typeof password === 'string' && password === configuredPassword;
    invariant(valid, 'UNAUTHORIZED', 'Invalid instructor credentials.', 401);
    const token = randomUUID() + randomUUID();
    const expires = new Date(Date.now() + 8 * 3600_000).toISOString();
    this.db.prepare('DELETE FROM instructor_tokens WHERE expires_at<=?').run(stamp());
    this.db.prepare('INSERT INTO instructor_tokens(token_hash,expires_at,faculty_id) VALUES (?,?,?)').run(hash(token), expires, username);
    this.audit(username, 'login', username);
    return { token, expiresAt: expires };
  }
  requireInstructor(token) {
    const row = token && this.db.prepare('SELECT expires_at,faculty_id FROM instructor_tokens WHERE token_hash=?').get(hash(token));
    invariant(row && Date.parse(row.expires_at) > Date.now(), 'UNAUTHORIZED', 'Instructor sign-in required.', 401);
    return row.faculty_id;
  }
  logoutInstructor(token) {
    this.requireInstructor(token);
    this.tx(() => {
      this.db.prepare('DELETE FROM instructor_tokens WHERE token_hash=?').run(hash(token));
      this.audit('instructor', 'logout', 'instructor');
    });
    return { loggedOut: true };
  }
  getAiProposal(token) {
    this.requireInstructor(token);
    const row = this.db.prepare('SELECT data_json FROM ai_proposals WHERE token_hash=?').get(hash(token));
    return row ? parse(row.data_json) : null;
  }
  saveAiProposal(token, data) {
    this.requireInstructor(token);
    invariant(data?.input?.source?.content && Array.isArray(data?.proposal?.design?.missions) &&
      Array.isArray(data?.selected), 'INVALID_PROPOSAL', 'Generated proposal is incomplete.');
    this.db.prepare(`INSERT INTO ai_proposals (token_hash,data_json,updated_at) VALUES (?,?,?)
      ON CONFLICT(token_hash) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at`)
      .run(hash(token), JSON.stringify(data), stamp());
    return { saved: true };
  }
  deleteAiProposal(token) {
    this.requireInstructor(token);
    this.db.prepare('DELETE FROM ai_proposals WHERE token_hash=?').run(hash(token));
    return { deleted: true };
  }
  admission({ runId, candidateId, pin }) {
    const run = this.db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
    const roster = run && this.db.prepare('SELECT * FROM roster WHERE run_id=? AND candidate_id=?').get(runId, candidateId);
    invariant(run && roster && hash(String(pin ?? '')) === run.pin_hash, 'UNAUTHORIZED', 'Invalid run, school ID or admission PIN.', 401);
    const now = Date.now();
    const existing = this.db.prepare('SELECT * FROM sessions WHERE run_id=? AND candidate_id=?').get(runId, candidateId);
    const resultReview = existing && now >= Date.parse(run.closes_at);
    invariant(resultReview || (run.status === 'open' && now >= Date.parse(run.opens_at) && now < Date.parse(run.closes_at)),
      'RUN_CLOSED', 'This activity run is not open.', 403);
    return { run, roster, existing, now, exam: this.getExam(run.exam_id, run.version) };
  }
  previewJoin(input) {
    const { run, roster, existing, now, exam } = this.admission(input);
    const policies = new Map();
    for (const mission of exam.public.missions) for (const activity of mission.activities) {
      const policy = resolveRetryPolicy(mission, activity);
      const key = JSON.stringify(policy);
      const entry = policies.get(key) || { ...policy, questionCount: 0 };
      entry.questionCount++;
      policies.set(key, entry);
    }
    return {
      title: exam.public.title, runName: run.name || exam.public.title,
      displayName: roster.display_name, section: roster.section, kind: presentationKind(exam.public),
      durationMinutes: exam.public.settings.durationMinutes, closesAt: run.closes_at,
      availableSeconds: Math.max(0, Math.floor((Date.parse(existing?.deadline_at || run.closes_at) - now) / 1000)),
      feedbackMode: run.feedback_mode, questionCount: exam.public.missions.reduce((sum, m) => sum + m.activities.length, 0),
      sectionCount: exam.public.missions.length, retryPolicies: [...policies.values()],
      referenceGuides: exam.public.settings.referenceGuides || [],
      resumed: !!existing, status: existing
        ? existing.status === 'in_progress' && now >= Date.parse(existing.deadline_at) ? 'expired' : existing.status
        : 'not_started'
    };
  }
  join(input) {
    const { run, existing, now, exam } = this.admission(input);
    const { runId, candidateId } = input;
    const token = randomUUID() + randomUUID();
    const expiresAt = new Date(now + 24 * 3600_000).toISOString();
    if (existing) {
      this.db.prepare('UPDATE sessions SET token_hash=?,token_expires_at=? WHERE id=?').run(hash(token), expiresAt, existing.id);
      return { token, expiresAt, resumed: true, session: this.sessionView(existing.id) };
    }
    const order = assignedOrder(exam.public.missions);
    const questionOrder = Object.fromEntries(exam.public.missions.map(mission => [mission.id,
      run.shuffle_questions ? shuffled(mission.activities.map(activity => activity.id))
        : mission.activities.map(activity => activity.id)]));
    const deadline = Math.min(now + exam.public.settings.durationMinutes * 60_000, Date.parse(run.closes_at));
    const id = randomUUID();
    this.db.prepare(`INSERT INTO sessions
        (id,run_id,candidate_id,token_hash,token_expires_at,order_json,question_order_json,started_at,deadline_at,status)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, runId, candidateId, hash(token), expiresAt, JSON.stringify(order), JSON.stringify(questionOrder),
        new Date(now).toISOString(), new Date(deadline).toISOString(), 'in_progress');
    this.audit(candidateId, 'start_session', id, { runId });
    return { token, expiresAt, resumed: false, session: this.sessionView(id) };
  }
  requireCandidate(token) {
    const row = token && this.db.prepare('SELECT id,last_seen_at FROM sessions WHERE token_hash=? AND token_expires_at>?').get(hash(token), stamp());
    invariant(row, 'UNAUTHORIZED', 'Candidate sign-in required.', 401);
    if (!row.last_seen_at || Date.now() - Date.parse(row.last_seen_at) > 10000) this.db.prepare('UPDATE sessions SET last_seen_at=? WHERE id=?').run(stamp(), row.id);
    return row.id;
  }
  logoutCandidate(token) {
    const sessionId = this.requireCandidate(token);
    this.tx(() => {
      this.db.prepare('UPDATE sessions SET token_hash=?,token_expires_at=? WHERE id=?')
        .run(hash(randomUUID() + randomUUID()), stamp(), sessionId);
      this.audit(this.context(sessionId).session.candidate_id, 'logout', sessionId);
    });
    return { loggedOut: true };
  }
  context(sessionId) {
    const session = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
    invariant(session, 'SESSION_NOT_FOUND', 'Session not found.', 404);
    const run = this.db.prepare('SELECT * FROM runs WHERE id=?').get(session.run_id);
    const exam = this.getExam(run.exam_id, run.version);
    const roster = this.db.prepare('SELECT display_name,section FROM roster WHERE run_id=? AND candidate_id=?').get(run.id, session.candidate_id);
    return { session, run, exam, roster };
  }
  progress(sessionId) {
    const { session, exam } = this.context(sessionId);
    const gated = presentationKind(exam.public) === 'ctf';
    const attempts = new Set(this.db.prepare('SELECT DISTINCT activity_id FROM submissions WHERE session_id=?').all(sessionId).map(r => r.activity_id));
    const completed = new Set();
    const order = parse(session.order_json);
    const missions = order.map(id => exam.public.missions.find(m => m.id === id));
    const states = missions.map((m, i) => {
      const dependenciesMet = (m.dependsOn ?? []).every(x => completed.has(x));
      const priorMet = i === 0 || completed.has(missions[i - 1].id);
      const done = m.activities.every(a => attempts.has(a.id));
      const unlocked = !gated || (dependenciesMet && priorMet);
      if (done && unlocked) completed.add(m.id);
      return { id: m.id, title: m.title, unlocked, completed: done && unlocked, activityCount: m.activities.length };
    });
    return states;
  }
  score(sessionId) {
    const earned = this.db.prepare('SELECT COALESCE(SUM(points),0) AS points FROM score_events WHERE session_id=?').get(sessionId).points;
    const lost = this.db.prepare('SELECT COALESCE(SUM(points),0) AS points FROM penalty_events WHERE session_id=?').get(sessionId).points;
    const overrides = this.db.prepare(`SELECT o.activity_id,o.points,
      COALESCE((SELECT SUM(e.points) FROM score_events e WHERE e.session_id=o.session_id AND e.activity_id=o.activity_id),0) AS earned,
      COALESCE((SELECT SUM(p.points) FROM penalty_events p WHERE p.session_id=o.session_id AND p.activity_id=o.activity_id),0) AS lost
      FROM score_overrides o WHERE o.session_id=?`).all(sessionId);
    const adjustment = overrides.reduce((sum, row) => sum + row.points - (row.earned - row.lost), 0);
    return Math.max(0, earned - lost + adjustment);
  }
  sessionView(sessionId) {
    if (this.automaticSettlement) this.settleAttempt(sessionId);
    const { session, run, exam, roster } = this.context(sessionId);
    const progress = this.progress(sessionId);
    const status = Date.now() >= Date.parse(session.deadline_at) && session.status === 'in_progress' ? 'expired' : session.status;
    const { pendingCodingCount, failedCodingCount } = this.db.prepare(`SELECT COUNT(*) AS pendingCodingCount,
      COUNT(CASE WHEN status='failed' THEN 1 END) AS failedCodingCount FROM coding_jobs
      WHERE session_id=? AND kind='submit' AND status IN ('queued','running','failed')`).get(sessionId);
    const activities = exam.public.missions.flatMap(mission => mission.activities);
    const codingLanguages = [...new Set(activities.filter(activity => activity.type === 'code_writing')
      .map(activity => activity.publicConfig.language))];
    const webProject = activities.some(activity => activity.type === 'web_project');
    const pendingReview = this.hasPendingReview(sessionId);
    const released = !pendingCodingCount && !pendingReview && resultsReleased(run, session);
    const kind = presentationKind(exam.public);
    const questionOrder = parse(session.question_order_json);
    const questions = kind === 'ctf' ? undefined : progress.flatMap(mission => {
      const activities = exam.public.missions.find(item => item.id === mission.id).activities;
      return (questionOrder?.[mission.id] ?? activities.map(activity => activity.id))
        .map(id => ({ id, missionId: mission.id, unlocked: mission.unlocked }));
    });
    const savedAnswers = questions && new Set(this.db.prepare(
      'SELECT DISTINCT activity_id AS id FROM submissions WHERE session_id=?'
    ).all(sessionId).map(row => row.id));
    if (savedAnswers) {
      const byId = new Map(activities.map(activity => [activity.id, activity]));
      for (const draft of this.db.prepare('SELECT activity_id, response_json FROM answer_drafts WHERE session_id=?').all(sessionId)) {
        const activity = byId.get(draft.activity_id);
        if (activity && gradableDraft(activity, parse(draft.response_json))) savedAnswers.add(draft.activity_id);
      }
    }
    return {
      id: session.id, candidateId: session.candidate_id, displayName: roster.display_name, section: roster.section,
      examId: exam.public.examId, version: exam.public.version, title: exam.public.title,
      kind, difficulty: exam.public.difficulty || null,
      referenceGuides: exam.public.settings.referenceGuides || [],
      description: exam.public.description, startedAt: session.started_at, deadlineAt: session.deadline_at,
      status, feedbackMode: run.feedback_mode, resultsReleased: released, pendingCodingCount, failedCodingCount, pendingReview,
      codingLanguages, webProject,
      questionCount: exam.public.missions.reduce((sum, mission) => sum + mission.activities.length, 0),
      submittedCount: this.db.prepare('SELECT COUNT(DISTINCT activity_id) AS count FROM submissions WHERE session_id=?').get(sessionId).count,
      ...(released ? { score: this.score(sessionId) } : {}), maxPoints: exam.public.settings.coreMaxPoints,
      order: progress,
      ...(questions ? { questions, savedAnswers: [...savedAnswers] } : {})
    };
  }
  missionView(sessionId, missionId) {
    const { session, exam } = this.context(sessionId);
    const state = this.progress(sessionId).find(x => x.id === missionId);
    invariant(state?.unlocked, 'LOCKED', 'Mission is locked or unavailable.', 403);
    const mission = exam.public.missions.find(m => m.id === missionId);
    const activityOrder = parse(session.question_order_json)?.[missionId] ?? mission.activities.map(a => a.id);
    const ordered = activityOrder.map(id => mission.activities.find(a => a.id === id)).filter(Boolean);
    return { ...mission, activities: ordered.map(({ gradingRuleId, ...publicActivity }) => {
      const last = this.db.prepare('SELECT response_json FROM submissions WHERE session_id=? AND activity_id=? ORDER BY rowid DESC LIMIT 1').get(sessionId, publicActivity.id);
      const draft = this.db.prepare('SELECT response_json,updated_at FROM answer_drafts WHERE session_id=? AND activity_id=?').get(sessionId, publicActivity.id);
      const attemptsUsed = this.db.prepare('SELECT COUNT(*) AS count FROM submissions WHERE session_id=? AND activity_id=?').get(sessionId, publicActivity.id).count;
      const policy = resolveRetryPolicy(mission, publicActivity);
      const response = draft && parse(draft.response_json);
      return { ...publicActivity, lastSubmission: last ? parse(last.response_json) : null,
        lastDraft: draft ? { ...response, updatedAt: draft.updated_at, gradable: gradableDraft(publicActivity, response) } : null,
        attemptsUsed, attemptPolicy: policy,
        attemptsRemaining: policy.maxRetries === null ? null : Math.max(0, policy.maxRetries + 1 - attemptsUsed) };
    }), version: exam.public.version };
  }
  checkDraftRevision(sessionId, activityId, expectedRevision) {
    if (expectedRevision === undefined) return;
    const current = this.db.prepare('SELECT updated_at FROM answer_drafts WHERE session_id=? AND activity_id=?').get(sessionId, activityId);
    invariant(expectedRevision === (current?.updated_at ?? ''), 'DRAFT_CONFLICT', 'This answer changed in another tab. Reload before saving.', 409);
  }
  saveDraft(sessionId, activityId, response, expectedRevision = undefined) {
    const { session, exam } = this.context(sessionId);
    invariant(session.status === 'in_progress' && Date.now() < Date.parse(session.deadline_at), 'SESSION_CLOSED', 'The session is closed.', 403);
    const mission = exam.public.missions.find(m => m.activities.some(a => a.id === activityId));
    invariant(mission, 'ACTIVITY_NOT_FOUND', 'Activity not found.', 404);
    invariant(this.progress(sessionId).find(item => item.id === mission.id)?.unlocked, 'LOCKED', 'Mission is locked or unavailable.', 403);
    invariant(response && typeof response === 'object' && !Array.isArray(response), 'INVALID_DRAFT', 'Draft must be an answer object.');
    const encoded = JSON.stringify(response);
    const activity = mission.activities.find(a => a.id === activityId);
    invariant(encoded.length <= (activity.type === 'web_project' ? 1_700_000 : 100_000), 'DRAFT_TOO_LARGE', 'Draft is too large.', 413);
    if (activity.type === 'data_inspection' && response.value != null)
      invariant(gradableDraft(activity, response), 'INVALID_ANSWER', 'Enter valid table filters, sort order, and page.');
    if (activity.type === 'code_writing')
      invariant(typeof response.value === 'string' && response.value.length <= 16000, 'INVALID_CODE', 'Drafts can contain at most 16,000 characters of code.');
    if (activity.type === 'web_project') invariant(!validateProject(response.value).length, 'INVALID_PROJECT', validateProject(response.value).join(' '));
    let updatedAt = stamp();
    this.tx(() => {
      const live = this.db.prepare('SELECT status,deadline_at FROM sessions WHERE id=?').get(sessionId);
      invariant(live.status === 'in_progress' && Date.now() < Date.parse(live.deadline_at), 'SESSION_CLOSED', 'The session is closed.', 403);
      const current = this.db.prepare('SELECT updated_at FROM answer_drafts WHERE session_id=? AND activity_id=?').get(sessionId, activityId);
      invariant(expectedRevision === undefined || expectedRevision === (current?.updated_at ?? ''), 'DRAFT_CONFLICT', 'This answer changed in another tab. Reload before saving.', 409);
      if (current && updatedAt <= current.updated_at) updatedAt = new Date(Date.parse(current.updated_at) + 1).toISOString();
        this.db.prepare(`INSERT INTO answer_drafts(session_id,activity_id,response_json,updated_at) VALUES(?,?,?,?)
          ON CONFLICT(session_id,activity_id) DO UPDATE SET response_json=excluded.response_json,updated_at=excluded.updated_at`)
          .run(sessionId, activityId, encoded, updatedAt);
    });
    return { saved: true, updatedAt, gradable: gradableDraft(activity, response) };
  }
  submit(sessionId, activityId, submission, idempotencyKey = null) {
    return this.#submitEvaluated(sessionId, activityId, submission, idempotencyKey);
  }
  codingContext(sessionId, activityId) {
    const context = this.context(sessionId);
    invariant(context.session.status === 'in_progress' && Date.now() < Date.parse(context.session.deadline_at), 'SESSION_CLOSED', 'The session is closed.', 403);
    const mission = context.exam.public.missions.find(m => m.activities.some(a => a.id === activityId));
    invariant(mission, 'ACTIVITY_NOT_FOUND', 'Activity not found.', 404);
    invariant(this.progress(sessionId).find(item => item.id === mission.id)?.unlocked, 'LOCKED', 'Mission is locked or unavailable.', 403);
    const activity = mission.activities.find(a => a.id === activityId);
    invariant(['code_writing', 'web_project'].includes(activity.type), 'INVALID_CODE_ACTIVITY', 'This question is not a coding question.');
    return { ...context, mission, activity, rule: context.exam.private.rules[activity.gradingRuleId] };
  }
  async previewCode(sessionId, activityId, submission) {
    const { activity } = this.codingContext(sessionId, activityId);
    return previewCode(activity.publicConfig, submission?.value, this.codeRunner, submission?.input);
  }
  async submitAnswer(sessionId, activityId, submission, idempotencyKey = null, expectedRevision) {
    const { exam } = this.context(sessionId);
    const activity = exam.public.missions.flatMap(m => m.activities).find(a => a.id === activityId);
    if (!['code_writing', 'web_project'].includes(activity?.type)) return this.#submitEvaluated(sessionId, activityId, submission, idempotencyKey, null, null, expectedRevision);
    const { mission, rule } = this.codingContext(sessionId, activityId);
    invariant(!this.db.prepare("SELECT 1 FROM coding_jobs WHERE session_id=? AND activity_id=? AND kind='submit' AND status IN ('queued','running')").get(sessionId, activityId),
      'CODING_JOB_PENDING', 'Wait for your queued submission for this question to finish.', 409);
    invariant(idempotencyKey === null || (typeof idempotencyKey === 'string' && /^[A-Za-z0-9-]{16,80}$/.test(idempotencyKey)), 'INVALID_IDEMPOTENCY_KEY', 'Submission retry key is invalid.');
    const previous = idempotencyKey && this.db.prepare('SELECT request_hash FROM submissions WHERE session_id=? AND activity_id=? AND idempotency_key=?').get(sessionId, activityId, idempotencyKey);
    if (previous) {
      invariant(previous.request_hash === hash(JSON.stringify(submission)), 'IDEMPOTENCY_CONFLICT', 'This retry key was already used for a different answer.', 409);
      return this.#submitEvaluated(sessionId, activityId, submission, idempotencyKey, { awarded: [] });
    }
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM submissions WHERE session_id=? AND activity_id=?').get(sessionId, activityId).count;
    const policy = resolveRetryPolicy(mission, activity);
    invariant(policy.maxRetries === null || count <= policy.maxRetries, 'ATTEMPT_LIMIT', 'No attempts remain for this question.', 403);
    const result = activity.type === 'web_project' ? await evaluateWeb(activity.publicConfig, rule, submission) : evaluate(activity, rule, submission);
    return this.#submitEvaluated(sessionId, activityId, submission, idempotencyKey, result, null, expectedRevision);
  }
  #submitEvaluated(sessionId, activityId, submission, idempotencyKey = null, executionResult = null, acceptedAt = null, expectedRevision) {
    const receivedAt = acceptedAt || stamp();
    const { run, exam } = this.context(sessionId);
    const mission = exam.public.missions.find(m => m.activities.some(a => a.id === activityId));
    invariant(mission, 'ACTIVITY_NOT_FOUND', 'Activity not found.', 404);
    invariant(this.progress(sessionId).find(item => item.id === mission.id)?.unlocked, 'LOCKED', 'Mission is locked or unavailable.', 403);
    const activity = mission.activities.find(a => a.id === activityId);
    const rule = exam.private.rules[activity.gradingRuleId];
    const evaluation = executionResult ?? evaluate(activity, rule, submission);
    const before = this.score(sessionId);
    const policy = resolveRetryPolicy(mission, activity);
    invariant(idempotencyKey === null || (typeof idempotencyKey === 'string' && /^[A-Za-z0-9-]{16,80}$/.test(idempotencyKey)),
      'INVALID_IDEMPOTENCY_KEY', 'Submission retry key is invalid.');
    const requestHash = hash(JSON.stringify(submission));
    let duplicate = null;
    let attemptNumber, deadlineAt;
    this.tx(() => {
      if (idempotencyKey) {
        duplicate = this.db.prepare(`SELECT id,result,at,request_hash FROM submissions
          WHERE session_id=? AND activity_id=? AND idempotency_key=?`).get(sessionId, activityId, idempotencyKey);
        if (duplicate) {
          invariant(duplicate.request_hash === requestHash, 'IDEMPOTENCY_CONFLICT', 'This retry key was already used for a different answer.', 409);
          attemptNumber = this.db.prepare(`SELECT COUNT(*) AS count FROM submissions
            WHERE session_id=? AND activity_id=? AND rowid <= (SELECT rowid FROM submissions WHERE id=?)`)
            .get(sessionId, activityId, duplicate.id).count;
          deadlineAt = this.db.prepare('SELECT deadline_at FROM sessions WHERE id=?').get(sessionId).deadline_at;
          return;
        }
      }
      const live = this.db.prepare('SELECT status,deadline_at FROM sessions WHERE id=?').get(sessionId);
      this.checkDraftRevision(sessionId, activityId, expectedRevision);
      invariant(gradableDraft(activity, submission), 'INVALID_ANSWER', 'Enter a valid answer before submitting.');
      // Persisted drafts and jobs were admitted before the deadline in effect at receipt.
      invariant(acceptedAt || (live.status === 'in_progress' && Date.now() < Date.parse(live.deadline_at)), 'SESSION_CLOSED', 'The session is closed.', 403);
      const previous = this.db.prepare('SELECT COUNT(*) AS count FROM submissions WHERE session_id=? AND activity_id=?').get(sessionId, activityId).count;
      invariant(policy.maxRetries === null || previous < policy.maxRetries + 1,
        'ATTEMPT_LIMIT', 'No attempts remain for this question.', 403);
      attemptNumber = previous + 1;
      const submissionId = randomUUID();
      this.db.prepare(`INSERT INTO submissions(id,session_id,activity_id,response_json,result,at,idempotency_key,request_hash)
        VALUES(?,?,?,?,?,?,?,?)`).run(submissionId, sessionId, activityId, JSON.stringify(submission), evaluation.result,
          acceptedAt || stamp(), idempotencyKey, idempotencyKey ? requestHash : null);
      if (['code_writing', 'web_project'].includes(activity.type)) this.db.prepare('DELETE FROM score_overrides WHERE session_id=? AND activity_id=?').run(sessionId, activityId);
      this.db.prepare('DELETE FROM answer_drafts WHERE session_id=? AND activity_id=? AND updated_at<=?').run(sessionId, activityId, receivedAt);
      if (policy.maxRetries !== null && attemptNumber > policy.maxRetries) {
        this.db.prepare("UPDATE coding_jobs SET status='superseded' WHERE session_id=? AND activity_id=? AND kind='submit' AND status='failed'")
          .run(sessionId, activityId);
      }
      const insert = this.db.prepare('INSERT OR IGNORE INTO score_events VALUES (?,?,?,?,?)');
      for (const c of evaluation.awarded) insert.run(sessionId, activityId, c.id, c.points, stamp());
      if (previous > 0) {
        this.db.prepare('INSERT INTO penalty_events VALUES (?,?,?,?,?,?)')
          .run(submissionId, sessionId, activityId, policy.pointPenalty, policy.timePenaltySeconds, stamp());
        const currentDeadline = Date.parse(live.deadline_at);
        const earliestDeadline = Math.min(currentDeadline, acceptedAt ? Date.parse(acceptedAt) : Date.now());
        deadlineAt = new Date(Math.max(earliestDeadline, currentDeadline - policy.timePenaltySeconds * 1000)).toISOString();
        this.db.prepare('UPDATE sessions SET deadline_at=? WHERE id=?').run(deadlineAt, sessionId);
      } else deadlineAt = live.deadline_at;
    });
    if (duplicate) {
      const penalty = this.db.prepare('SELECT points,seconds FROM penalty_events WHERE submission_id=?').get(duplicate.id);
      return { ...(run.feedback_mode === 'practice' ? {
        result: duplicate.result, feedbackCode: 'DUPLICATE_RETRY', awardedNow: 0, score: this.score(sessionId)
      } : { saved: true }), progress: this.progress(sessionId), attemptNumber, deadlineAt,
        duplicate: true, penaltyApplied: penalty ? { points: penalty.points, seconds: penalty.seconds } : null,
        attemptsRemaining: policy.maxRetries === null ? null : Math.max(0, policy.maxRetries + 1 - attemptNumber) };
    }
    return { ...(run.feedback_mode === 'practice' ? {
      result: evaluation.result, feedbackCode: evaluation.feedbackCode,
      awardedNow: this.score(sessionId) - before, score: this.score(sessionId)
    } : { saved: true }),
      progress: this.progress(sessionId), attemptNumber, deadlineAt,
      penaltyApplied: attemptNumber > 1 ? { points: policy.pointPenalty, seconds: policy.timePenaltySeconds } : null,
      attemptsRemaining: policy.maxRetries === null ? null : Math.max(0, policy.maxRetries + 1 - attemptNumber) };
  }
  expiredSessionIds(runId = null) {
    return this.db.prepare(`SELECT s.id FROM sessions s JOIN runs r ON r.id=s.run_id
      WHERE s.status='in_progress' AND s.deadline_at<=?
      AND (? IS NULL OR s.run_id=?) AND (? IS NULL OR r.owner_id=?)`)
      .all(stamp(), runId, runId, facultyId(), facultyId()).map(session => session.id);
  }
  settleExpired(runId = null) {
    for (const sessionId of this.expiredSessionIds(runId)) this.settleAttempt(sessionId);
  }
  settleAttempt(sessionId, force = false) {
    const { session, exam } = this.context(sessionId);
    if (session.status !== 'in_progress' || (!force && Date.now() < Date.parse(session.deadline_at))) return;
    const drafts = this.db.prepare('SELECT * FROM answer_drafts WHERE session_id=? ORDER BY updated_at').all(sessionId);
    for (const draft of drafts) {
      const mission = exam.public.missions.find(m => m.activities.some(a => a.id === draft.activity_id));
      const activity = mission?.activities.find(a => a.id === draft.activity_id);
      if (!activity) continue;
      const policy = resolveRetryPolicy(mission, activity);
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE session_id=? AND activity_id=?').get(sessionId, activity.id).n;
      // Exhausted retries never become free attempts at expiry.
      if (policy.maxRetries !== null && count > policy.maxRetries) continue;
      const response = parse(draft.response_json);
      if (!gradableDraft(activity, response)) continue;
      const queued = this.db.prepare("SELECT payload_json FROM coding_jobs WHERE session_id=? AND activity_id=? AND kind='submit' AND status IN ('queued','running','failed')").all(sessionId, activity.id);
      if (queued.some(job => job.payload_json === draft.response_json)) continue;
      if (policy.maxRetries !== null && count + queued.length > policy.maxRetries) continue;
      const key = `draft-${hash(draft.updated_at + draft.response_json).slice(0, 48)}`;
      if (activity.type === 'web_project') {
        this.codingQueue.enqueue(sessionId, activity.id, 'submit', key, response, { acceptedAt: draft.updated_at, finalizing: true });
      } else {
        this.#submitEvaluated(sessionId, activity.id, response, key, null, draft.updated_at);
      }
    }
    const { deadline_at: deadline } = this.db.prepare('SELECT deadline_at FROM sessions WHERE id=?').get(sessionId);
    const status = Date.now() >= Date.parse(deadline) ? 'expired' : 'submitted';
    this.db.prepare('UPDATE sessions SET status=? WHERE id=?').run(status, sessionId);
    this.audit(session.candidate_id, 'finalize', sessionId, { status });
  }
  finalize(sessionId) {
    this.settleAttempt(sessionId, true);
    return this.sessionView(sessionId);
  }
  results(runId) {
    const run = this.db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
    invariant(run, 'RUN_NOT_FOUND', 'Run not found.', 404);
    assertOwner(run.owner_id);
    if (this.automaticSettlement) this.settleExpired(runId);
    const exam = this.getExam(run.exam_id, run.version);
    const rows = this.db.prepare(`SELECT r.candidate_id, r.display_name, r.section, s.id AS session_id,
      s.status, s.started_at, s.deadline_at, s.results_published_at
      FROM roster r LEFT JOIN sessions s ON s.run_id=r.run_id AND s.candidate_id=r.candidate_id
      WHERE r.run_id=? ORDER BY r.section,r.candidate_id`).all(runId);
    const totals = new Map(), perQuestion = new Map();
    for (const [table, sign] of [['score_events', 1], ['penalty_events', -1]]) {
      for (const row of this.db.prepare(`SELECT session_id,activity_id,SUM(points) AS points FROM ${table}
        WHERE session_id IN (SELECT id FROM sessions WHERE run_id=?) GROUP BY session_id,activity_id`).all(runId)) {
        totals.set(row.session_id, (totals.get(row.session_id) || 0) + sign * row.points);
        const key = `${row.session_id}:${row.activity_id}`;
        perQuestion.set(key, (perQuestion.get(key) || 0) + sign * row.points);
      }
    }
    for (const row of this.db.prepare('SELECT session_id,activity_id,points FROM score_overrides WHERE session_id IN (SELECT id FROM sessions WHERE run_id=?)').all(runId)) {
      totals.set(row.session_id, (totals.get(row.session_id) || 0) + row.points - (perQuestion.get(`${row.session_id}:${row.activity_id}`) || 0));
    }
    const pending = new Map(this.db.prepare(`SELECT session_id, COUNT(CASE WHEN status='failed' THEN 1 END) AS failed
      FROM coding_jobs WHERE kind='submit' AND status IN ('queued','running','failed')
      AND session_id IN (SELECT id FROM sessions WHERE run_id=?) GROUP BY session_id`).all(runId).map(r => [r.session_id, r.failed]));
    const pendingReview = this.pendingReviewSessions(runId, exam);
    return { runId, examId: run.exam_id, version: run.version, title: exam.public.title,
      classId: run.class_id, className: run.class_name,
      name: run.name || exam.public.title,
      opensAt: run.opens_at, closesAt: run.closes_at,
      feedbackMode: run.feedback_mode,
      maxPoints: exam.public.settings.coreMaxPoints,
      rows: rows.map(r => ({ candidateId: r.candidate_id, displayName: r.display_name, section: r.section,
        sessionId: r.session_id, status: r.session_id && r.status === 'in_progress' && Date.now() >= Date.parse(r.deadline_at)
          ? 'expired' : r.status ?? 'registered', startedAt: r.started_at,
        deadlineAt: r.deadline_at, score: Math.max(0, totals.get(r.session_id) || 0), pendingCoding: pending.has(r.session_id),
        failedCodingCount: pending.get(r.session_id) || 0,
        finalizationPending: r.status === 'in_progress' && Date.now() >= Date.parse(r.deadline_at),
        pendingReview: !!r.session_id && pendingReview.has(r.session_id),
        resultsReleased: !pending.has(r.session_id) && !pendingReview.has(r.session_id) && resultsReleased(run, r) })) };
  }
  publishStudentResults(runId, candidateId, actor = 'instructor') {
    const review = this.reviewStudent(runId, candidateId);
    invariant(review.sessionId, 'SESSION_NOT_FOUND', 'This student has not started an attempt.', 404);
    if (this.automaticSettlement) this.settleAttempt(review.sessionId);
    invariant(!this.hasPendingCode(review.sessionId), 'CODING_JOB_PENDING', 'Wait for queued coding submissions to finish.', 409);
    invariant(!this.hasPendingReview(review.sessionId), 'REVIEW_PENDING', 'Grade all submitted coding answers and manual rubrics before publishing.', 409);
    invariant(this.context(review.sessionId).session.status !== 'in_progress', 'ATTEMPT_IN_PROGRESS', 'Wait until the student finishes before publishing their score.', 409);
    const publishedAt = stamp();
    this.tx(() => {
      this.db.prepare('UPDATE sessions SET results_published_at=? WHERE id=?').run(publishedAt, review.sessionId);
      this.audit(actor, 'publish_student_results', review.sessionId, { runId, candidateId });
    });
    return { runId, candidateId, resultsReleased: true, publishedAt };
  }
  publishCompletedResults(runId, actor = 'instructor') {
    const run = this.db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
    invariant(run, 'RUN_NOT_FOUND', 'Run not found.', 404);
    assertOwner(run.owner_id);
    if (this.automaticSettlement) this.settleExpired(runId);
    const exam = this.getExam(run.exam_id, run.version);
    const review = this.pendingReviewSessions(runId, exam);
    const pending = new Set(this.db.prepare(`SELECT DISTINCT session_id FROM coding_jobs
      WHERE kind='submit' AND status IN ('queued','running','failed')
      AND session_id IN (SELECT id FROM sessions WHERE run_id=?)`).all(runId).map(row => row.session_id));
    const publishedAt = stamp();
    const eligible = this.db.prepare(`SELECT id FROM sessions WHERE run_id=?
      AND status <> 'in_progress' AND results_published_at IS NULL`).all(runId)
      .filter(session => !pending.has(session.id) && !review.has(session.id));
    this.tx(() => {
      const update = this.db.prepare('UPDATE sessions SET results_published_at=? WHERE id=?');
      for (const session of eligible) update.run(publishedAt, session.id);
      this.audit(actor, 'publish_completed_results', runId, { publishedCount: eligible.length });
    });
    return { runId, publishedCount: eligible.length, publishedAt };
  }
  hasPendingCode(sessionId) {
    return !!this.db.prepare("SELECT 1 FROM coding_jobs WHERE session_id=? AND kind='submit' AND status IN ('queued','running','failed') LIMIT 1").get(sessionId);
  }
  retryGrading(runId) {
    const count = this.db.prepare(`UPDATE coding_jobs SET status='queued',failures=0,error_json=NULL WHERE status='failed'
      AND session_id IN (SELECT id FROM sessions WHERE run_id=?)`).run(runId).changes;
    this.audit('instructor', 'retry_grading', runId, { count }); this.codingQueue.pump();
    return { retried: Number(count) };
  }
  pendingReviewSessions(runId, exam) {
    const manual = new Set(exam.public.missions.flatMap(m => m.activities).filter(a =>
      a.type === 'web_project' && exam.private.rules[a.gradingRuleId].criteria.some(c => c.answer.kind === 'manual')
    ).map(a => a.id));
    const consoleIds = new Set(exam.public.missions.flatMap(m => m.activities).filter(a => a.type === 'code_writing').map(a => a.id));
    if (!manual.size && !consoleIds.size) return new Set();
    const latest = this.db.prepare(`SELECT sub.session_id,sub.activity_id,sub.result FROM submissions sub
      JOIN sessions s ON s.id=sub.session_id
      LEFT JOIN score_overrides o ON o.session_id=sub.session_id AND o.activity_id=sub.activity_id
      WHERE s.run_id=? AND o.session_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM submissions newer WHERE newer.session_id=sub.session_id
        AND newer.activity_id=sub.activity_id AND newer.rowid>sub.rowid)`).all(runId);
    return new Set(latest.filter(row => manual.has(row.activity_id) ||
      (consoleIds.has(row.activity_id) && row.result === 'pending_review')).map(row => row.session_id));
  }
  hasPendingReview(sessionId) {
    if (!sessionId) return false;
    const { session, exam } = this.context(sessionId);
    const manual = new Set(exam.public.missions.flatMap(m => m.activities).filter(a =>
      a.type === 'web_project' && exam.private.rules[a.gradingRuleId].criteria.some(c => c.answer.kind === 'manual')
    ).map(a => a.id));
    const consoleIds = new Set(exam.public.missions.flatMap(m => m.activities).filter(a => a.type === 'code_writing').map(a => a.id));
    if (!manual.size && !consoleIds.size) return false;
    return this.db.prepare(`SELECT sub.activity_id,sub.result FROM submissions sub
      LEFT JOIN score_overrides o ON o.session_id=sub.session_id AND o.activity_id=sub.activity_id
      WHERE sub.session_id=? AND o.session_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM submissions newer WHERE newer.session_id=sub.session_id
        AND newer.activity_id=sub.activity_id AND newer.rowid>sub.rowid)`).all(session.id)
      .some(row => manual.has(row.activity_id) || (consoleIds.has(row.activity_id) && row.result === 'pending_review'));
  }
  webCheckpointStore() {
    return {
      load: (sessionId, activityId) => {
        const saved = this.db.prepare('SELECT database_snapshot FROM web_checkpoints WHERE session_id=? AND activity_id=?').get(sessionId, activityId);
        if (saved) return saved.database_snapshot ?? undefined;
        const draft = this.db.prepare('SELECT response_json FROM answer_drafts WHERE session_id=? AND activity_id=?').get(sessionId, activityId);
        const submitted = draft || this.db.prepare('SELECT response_json FROM submissions WHERE session_id=? AND activity_id=? ORDER BY rowid DESC LIMIT 1').get(sessionId, activityId);
        return submitted ? parse(submitted.response_json).value?.database : undefined;
      },
      save: (sessionId, activityId, database) => {
        invariant(typeof database === 'string' && database.length <= 1400000 && /^[A-Za-z0-9+/]*={0,2}$/.test(database), 'INVALID_DATABASE', 'Invalid database checkpoint.');
        this.db.prepare(`INSERT INTO web_checkpoints VALUES (?,?,?,?) ON CONFLICT(session_id,activity_id)
          DO UPDATE SET database_snapshot=excluded.database_snapshot,saved_at=excluded.saved_at`).run(sessionId, activityId, database, stamp());
      },
      clear: (sessionId, activityId) => {
        this.db.prepare(`INSERT INTO web_checkpoints VALUES (?,?,NULL,?) ON CONFLICT(session_id,activity_id)
          DO UPDATE SET database_snapshot=NULL,saved_at=excluded.saved_at`).run(sessionId, activityId, stamp());
      }
    };
  }
  reviewStudent(runId, candidateId) {
    const run = this.db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
    invariant(run, 'RUN_NOT_FOUND', 'Run not found.', 404);
    const roster = this.db.prepare('SELECT * FROM roster WHERE run_id=? AND candidate_id=?').get(runId, candidateId);
    invariant(roster, 'STUDENT_NOT_FOUND', 'Student is not in this run.', 404);
    const exam = this.getExam(run.exam_id, run.version);
    const session = this.db.prepare('SELECT * FROM sessions WHERE run_id=? AND candidate_id=?').get(runId, candidateId);
    const base = { runId, candidateId, displayName: roster.display_name, section: roster.section,
      runName: run.name || exam.public.title, maxPoints: exam.public.settings.coreMaxPoints };
    if (!session) return { ...base, sessionId: null, status: 'registered', score: 0,
      canOverride: false, questions: [] };
    const attempts = this.db.prepare(`SELECT activity_id,response_json,result,at FROM submissions
      WHERE session_id=? ORDER BY rowid`).all(session.id);
    const byActivity = new Map();
    for (const attempt of attempts) {
      if (!byActivity.has(attempt.activity_id)) byActivity.set(attempt.activity_id, []);
      byActivity.get(attempt.activity_id).push({ response: parse(attempt.response_json),
        result: attempt.result, at: attempt.at });
    }
    const overrides = new Map(this.db.prepare('SELECT activity_id,points,reason,updated_at FROM score_overrides WHERE session_id=?')
      .all(session.id).map(row => [row.activity_id, row]));
    const orderedQuestions = parse(session.question_order_json);
    const questions = [];
    for (const missionId of parse(session.order_json)) {
      const mission = exam.public.missions.find(item => item.id === missionId);
      const ids = orderedQuestions[missionId] ?? mission.activities.map(activity => activity.id);
      for (const activityId of ids) {
        const activity = mission.activities.find(item => item.id === activityId);
        if (!activity) continue;
        const earned = this.db.prepare('SELECT COALESCE(SUM(points),0) AS points FROM score_events WHERE session_id=? AND activity_id=?')
          .get(session.id, activity.id).points;
        const lost = this.db.prepare('SELECT COALESCE(SUM(points),0) AS points FROM penalty_events WHERE session_id=? AND activity_id=?')
          .get(session.id, activity.id).points;
        const override = overrides.get(activity.id);
        let expectedAnswer;
        try { expectedAnswer = answerText(activity, exam.private.rules[activity.gradingRuleId]); }
        catch { expectedAnswer = 'See published answer key.'; }
        questions.push({ id: activity.id, missionId, missionTitle: mission.title,
          prompt: activity.prompt, type: activity.type, publicConfig: activity.publicConfig,
          maxPoints: activity.maxPoints, automaticPoints: earned - lost,
          effectivePoints: override ? override.points : earned - lost,
          override: override ? { points: override.points, reason: override.reason, updatedAt: override.updated_at } : null,
          expectedAnswer, attempts: byActivity.get(activity.id) ?? [] });
      }
    }
    const status = session.status === 'in_progress' && Date.now() >= Date.parse(session.deadline_at)
      ? 'expired' : session.status;
    const released = resultsReleased(run, session);
    return { ...base, sessionId: session.id, status, startedAt: session.started_at,
      deadlineAt: session.deadline_at, score: this.score(session.id),
      canOverride: session.status !== 'in_progress' && !this.hasPendingCode(session.id), resultsReleased: released && !this.hasPendingCode(session.id), questions };
  }
  overrideQuestionScore(runId, candidateId, activityId, input, actor = 'instructor') {
    const review = this.reviewStudent(runId, candidateId);
    invariant(review.sessionId && review.canOverride, 'ATTEMPT_IN_PROGRESS', 'Wait until the attempt ends before changing a score.', 409);
    const question = review.questions.find(item => item.id === activityId);
    invariant(question, 'ACTIVITY_NOT_FOUND', 'Question is not in this run.', 404);
    invariant(Number.isInteger(input?.points) && input.points >= 0 && input.points <= question.maxPoints,
      'INVALID_SCORE', `Enter a whole-number score from 0 to ${question.maxPoints}.`);
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    invariant(reason.length <= 300, 'INVALID_SCORE', 'Reason must be at most 300 characters.');
    this.tx(() => {
      this.db.prepare(`INSERT INTO score_overrides (session_id,activity_id,points,reason,updated_at)
        VALUES (?,?,?,?,?) ON CONFLICT(session_id,activity_id) DO UPDATE SET
        points=excluded.points,reason=excluded.reason,updated_at=excluded.updated_at`)
        .run(review.sessionId, activityId, input.points, reason, stamp());
      this.audit(actor, 'override_question_score', review.sessionId,
        { runId, candidateId, activityId, previousPoints: question.override?.points ?? null, points: input.points, reason });
    });
    return this.reviewStudent(runId, candidateId);
  }
  clearQuestionScoreOverride(runId, candidateId, activityId, actor = 'instructor') {
    const review = this.reviewStudent(runId, candidateId);
    invariant(review.sessionId && review.canOverride, 'ATTEMPT_IN_PROGRESS', 'Wait until the attempt ends before changing a score.', 409);
    const question = review.questions.find(item => item.id === activityId);
    invariant(question, 'ACTIVITY_NOT_FOUND', 'Question is not in this run.', 404);
    if (question.override) this.tx(() => {
      this.db.prepare('DELETE FROM score_overrides WHERE session_id=? AND activity_id=?').run(review.sessionId, activityId);
      this.audit(actor, 'clear_question_score_override', review.sessionId,
        { runId, candidateId, activityId, previousPoints: question.override.points });
    });
    return this.reviewStudent(runId, candidateId);
  }
  recoverStudent(runId, candidateId, input, action, actor = 'instructor') {
    const run = this.db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
    invariant(run, 'RUN_NOT_FOUND', 'Run not found.', 404);
    invariant(Date.now() < Date.parse(run.closes_at), 'RUN_CLOSED', 'This run has closed; recovery is no longer available.', 409);
    const session = this.db.prepare(`SELECT s.* FROM sessions s
      JOIN roster r ON r.run_id=s.run_id AND r.candidate_id=s.candidate_id
      WHERE s.run_id=? AND s.candidate_id=?`).get(runId, candidateId);
    invariant(session, 'SESSION_NOT_FOUND', 'This student has not started an attempt.', 404);
    invariant(!this.hasPendingCode(session.id), 'CODING_JOB_PENDING', 'Wait for queued coding submissions to finish before recovery.', 409);
    const minutes = Number(input?.minutes);
    invariant(Number.isInteger(minutes) && minutes >= 1 && minutes <= 120,
      'INVALID_RECOVERY', 'Enter a whole number of minutes from 1 to 120.');
    const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
    invariant(reason.length >= 3 && reason.length <= 300, 'INVALID_RECOVERY', 'Give a reason of 3–300 characters.');
    const now = Date.now();
    let deadline;
    if (action === 'extend') {
      invariant(['in_progress', 'expired'].includes(session.status), 'ATTEMPT_NOT_ACTIVE', 'Only active or expired attempts can receive extra time.', 409);
      deadline = Math.min(Math.max(now, Date.parse(session.deadline_at)) + minutes * 60_000, Date.parse(run.closes_at));
      invariant(deadline > Date.parse(session.deadline_at), 'RUN_CLOSED', 'The run closing time leaves no room to extend this attempt.', 409);
    } else {
      const effectiveStatus = session.status === 'in_progress' && now >= Date.parse(session.deadline_at) ? 'expired' : session.status;
      invariant(['submitted', 'expired'].includes(effectiveStatus), 'ATTEMPT_NOT_RECOVERABLE', 'Only submitted or expired attempts can be reopened.', 409);
      deadline = Math.min(now + minutes * 60_000, Date.parse(run.closes_at));
      invariant(deadline > now, 'RUN_CLOSED', 'The run closing time leaves no room to reopen this attempt.', 409);
    }
    this.tx(() => {
      this.db.prepare("UPDATE sessions SET status='in_progress',deadline_at=?,results_published_at=NULL WHERE id=?")
        .run(new Date(deadline).toISOString(), session.id);
      this.audit(actor, action === 'extend' ? 'extend_student_time' : 'reopen_student_attempt', session.id,
        { runId, candidateId, minutes, reason, previousDeadlineAt: session.deadline_at, deadlineAt: new Date(deadline).toISOString() });
    });
    return this.reviewStudent(runId, candidateId);
  }
  auditLog() {
    return this.db.prepare('SELECT actor,action,target,detail_json,at FROM audit_events WHERE (? IS NULL OR owner_id=?) ORDER BY at DESC LIMIT 100').all(facultyId(), facultyId())
      .map(r => ({ actor: r.actor, action: r.action, target: r.target, detail: parse(r.detail_json), at: r.at }));
  }
}
