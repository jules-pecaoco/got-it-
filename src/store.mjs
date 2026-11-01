import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { assignedOrder, evaluate, hash, resolveRetryPolicy, validatePackage } from './engine.mjs';
import { answerText } from '../public/answer-key.js';

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

export class Store {
  constructor(filename = ':memory:') {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS exams (
        exam_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
        public_json TEXT NOT NULL, private_json TEXT NOT NULL, content_hash TEXT,
        published_at TEXT, PRIMARY KEY (exam_id, version)
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, version INTEGER NOT NULL,
        pin_hash TEXT NOT NULL, opens_at TEXT NOT NULL, closes_at TEXT NOT NULL,
        status TEXT NOT NULL, name TEXT, class_id TEXT, class_name TEXT,
        feedback_mode TEXT NOT NULL DEFAULT 'practice', shuffle_questions INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (exam_id,version) REFERENCES exams(exam_id,version)
      );
      CREATE TABLE IF NOT EXISTS classes (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, section TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS class_students (
        class_id TEXT NOT NULL, candidate_id TEXT NOT NULL, display_name TEXT NOT NULL,
        gender TEXT, year_level TEXT, program_short_name TEXT,
        PRIMARY KEY (class_id,candidate_id), FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS roster (
        run_id TEXT NOT NULL, candidate_id TEXT NOT NULL, display_name TEXT NOT NULL,
        section TEXT NOT NULL,
        PRIMARY KEY (run_id,candidate_id), FOREIGN KEY (run_id) REFERENCES runs(id)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE, order_json TEXT NOT NULL,
        question_order_json TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL, deadline_at TEXT NOT NULL, status TEXT NOT NULL,
        UNIQUE (run_id,candidate_id), FOREIGN KEY (run_id,candidate_id) REFERENCES roster(run_id,candidate_id)
      );
      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, activity_id TEXT NOT NULL,
        response_json TEXT NOT NULL, result TEXT NOT NULL, at TEXT NOT NULL,
        idempotency_key TEXT, request_hash TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
      CREATE TABLE IF NOT EXISTS answer_drafts (
        session_id TEXT NOT NULL, activity_id TEXT NOT NULL, response_json TEXT NOT NULL,
        updated_at TEXT NOT NULL, PRIMARY KEY(session_id,activity_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS score_events (
        session_id TEXT NOT NULL, activity_id TEXT NOT NULL, criterion_id TEXT NOT NULL,
        points INTEGER NOT NULL, at TEXT NOT NULL,
        PRIMARY KEY (session_id,activity_id,criterion_id), FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
      CREATE TABLE IF NOT EXISTS penalty_events (
        submission_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, activity_id TEXT NOT NULL,
        points INTEGER NOT NULL, seconds INTEGER NOT NULL, at TEXT NOT NULL,
        FOREIGN KEY (submission_id) REFERENCES submissions(id),
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
      CREATE TABLE IF NOT EXISTS score_overrides (
        session_id TEXT NOT NULL, activity_id TEXT NOT NULL, points INTEGER NOT NULL,
        reason TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id,activity_id), FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
      CREATE TABLE IF NOT EXISTS instructor_tokens (
        token_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS proctor_tokens (
        token_hash TEXT PRIMARY KEY, run_id TEXT NOT NULL, expires_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS ai_proposals (
        token_hash TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (token_hash) REFERENCES instructor_tokens(token_hash) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
        target TEXT NOT NULL, detail_json TEXT NOT NULL, at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_documents (
        id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, version INTEGER NOT NULL,
        filename TEXT NOT NULL, content_text TEXT NOT NULL, coverage_json TEXT,
        review_status TEXT NOT NULL, uploaded_at TEXT NOT NULL,
        FOREIGN KEY (exam_id,version) REFERENCES exams(exam_id,version)
      );
    `);
    if (this.db.prepare('PRAGMA table_info(roster)').all().some(column => column.name === 'secret_hash'))
      this.db.exec('ALTER TABLE roster DROP COLUMN secret_hash');
    if (!this.db.prepare('PRAGMA table_info(runs)').all().some(column => column.name === 'name'))
      this.db.exec('ALTER TABLE runs ADD COLUMN name TEXT');
    if (!this.db.prepare('PRAGMA table_info(runs)').all().some(column => column.name === 'class_id'))
      this.db.exec('ALTER TABLE runs ADD COLUMN class_id TEXT');
    if (!this.db.prepare('PRAGMA table_info(runs)').all().some(column => column.name === 'class_name'))
      this.db.exec('ALTER TABLE runs ADD COLUMN class_name TEXT');
    if (!this.db.prepare('PRAGMA table_info(runs)').all().some(column => column.name === 'feedback_mode'))
      this.db.exec("ALTER TABLE runs ADD COLUMN feedback_mode TEXT NOT NULL DEFAULT 'practice'");
    if (!this.db.prepare('PRAGMA table_info(runs)').all().some(column => column.name === 'shuffle_questions'))
      this.db.exec('ALTER TABLE runs ADD COLUMN shuffle_questions INTEGER NOT NULL DEFAULT 0');
    if (!this.db.prepare('PRAGMA table_info(sessions)').all().some(column => column.name === 'question_order_json'))
      this.db.exec("ALTER TABLE sessions ADD COLUMN question_order_json TEXT NOT NULL DEFAULT '{}'");
    if (!this.db.prepare('PRAGMA table_info(submissions)').all().some(column => column.name === 'idempotency_key'))
      this.db.exec('ALTER TABLE submissions ADD COLUMN idempotency_key TEXT');
    if (!this.db.prepare('PRAGMA table_info(submissions)').all().some(column => column.name === 'request_hash'))
      this.db.exec('ALTER TABLE submissions ADD COLUMN request_hash TEXT');
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS submissions_idempotency
      ON submissions(session_id,activity_id,idempotency_key)`);
    if (!this.db.prepare('PRAGMA table_info(runs)').all().some(column => column.name === 'proctor_code_hash'))
      this.db.exec('ALTER TABLE runs ADD COLUMN proctor_code_hash TEXT');
    if (!this.db.prepare('PRAGMA table_info(runs)').all().some(column => column.name === 'proctor_code_issued_at'))
      this.db.exec('ALTER TABLE runs ADD COLUMN proctor_code_issued_at TEXT');
    if (!this.db.prepare('PRAGMA table_info(exams)').all().some(column => column.name === 'archived_at'))
      this.db.exec('ALTER TABLE exams ADD COLUMN archived_at TEXT');
    for (const [column, type] of [['gender', 'TEXT'], ['year_level', 'TEXT'], ['program_short_name', 'TEXT']])
      if (!this.db.prepare('PRAGMA table_info(class_students)').all().some(item => item.name === column))
        this.db.exec(`ALTER TABLE class_students ADD COLUMN ${column} ${type}`);
  }
  close() { this.db.close(); }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  audit(actor, action, target, detail = {}) {
    this.db.prepare('INSERT INTO audit_events VALUES (?,?,?,?,?,?)').run(randomUUID(), actor, action, target, JSON.stringify(detail), stamp());
  }
  importDraft(pub, priv, actor = 'instructor') {
    invariant(pub?.examId && Number.isInteger(pub?.version), 'INVALID_PACKAGE', 'examId and version are required.');
    invariant(!this.db.prepare('SELECT 1 FROM exams WHERE exam_id=? AND version=?').get(pub.examId, pub.version), 'VERSION_EXISTS', 'This version already exists.', 409);
    this.db.prepare('INSERT INTO exams (exam_id,version,status,public_json,private_json) VALUES (?,?,?,?,?)')
      .run(pub.examId, pub.version, 'draft', JSON.stringify(pub), JSON.stringify(priv));
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
  cloneExam(examId, version, actor = 'instructor') {
    return this.tx(() => {
      const source = this.getExam(examId, version);
      const nextVersion = this.db.prepare('SELECT COALESCE(MAX(version),0)+1 AS version FROM exams WHERE exam_id=?').get(examId).version;
      const pub = { ...source.public, version: nextVersion };
      const documents = this.listSources(examId, version);
      this.db.prepare('INSERT INTO exams (exam_id,version,status,public_json,private_json) VALUES (?,?,?,?,?)')
        .run(examId, nextVersion, 'draft', JSON.stringify(pub), JSON.stringify(source.private));
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
    return { ...row, public: parse(row.public_json), private: parse(row.private_json) };
  }
  listExams() {
    return this.db.prepare('SELECT exam_id,version,status,public_json,published_at,archived_at FROM exams ORDER BY exam_id,version DESC').all()
      .map(r => {
        const pub = parse(r.public_json);
        return { examId: r.exam_id, version: r.version, status: r.status, title: pub.title,
          kind: presentationKind(pub), difficulty: pub.difficulty || null,
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
      GROUP BY c.id ORDER BY c.name COLLATE NOCASE,c.section`).all()
      .map(row => ({ id: row.id, name: row.name, section: row.section,
        studentCount: row.student_count, createdAt: row.created_at, updatedAt: row.updated_at }));
  }
  getClass(classId) {
    const row = this.db.prepare('SELECT * FROM classes WHERE id=?').get(classId);
    invariant(row, 'CLASS_NOT_FOUND', 'Class not found.', 404);
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
      this.db.prepare('INSERT INTO classes VALUES (?,?,?,?,?)').run(id, name, section, now, now);
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
    const feedbackMode = input.feedbackMode ?? 'practice';
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
      FROM runs r JOIN exams e ON e.exam_id=r.exam_id AND e.version=r.version ORDER BY r.opens_at DESC`).all()
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
  proctorAccess(runId) {
    const run = this.db.prepare('SELECT proctor_code_hash,proctor_code_issued_at,closes_at FROM runs WHERE id=?').get(runId);
    invariant(run, 'RUN_NOT_FOUND', 'Run not found.', 404);
    return { enabled: !!run.proctor_code_hash && Date.now() < Date.parse(run.closes_at),
      issuedAt: run.proctor_code_issued_at, closesAt: run.closes_at };
  }
  issueProctorAccess(runId, actor = 'instructor') {
    const run = this.db.prepare('SELECT id,closes_at FROM runs WHERE id=?').get(runId);
    invariant(run, 'RUN_NOT_FOUND', 'Run not found.', 404);
    invariant(Date.now() < Date.parse(run.closes_at), 'RUN_CLOSED', 'This run has ended.', 409);
    const code = randomBytes(18).toString('base64url');
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
    const questionCount = exam.public.missions.reduce((sum, mission) => sum + mission.activities.length, 0);
    const rows = this.db.prepare(`SELECT r.candidate_id,r.display_name,r.section,s.status,s.started_at,s.deadline_at,
      (SELECT COUNT(DISTINCT sub.activity_id) FROM submissions sub WHERE sub.session_id=s.id) AS answered_count,
      (SELECT MAX(sub.at) FROM submissions sub WHERE sub.session_id=s.id) AS last_submission_at
      FROM roster r LEFT JOIN sessions s ON s.run_id=r.run_id AND s.candidate_id=r.candidate_id
      WHERE r.run_id=? ORDER BY r.section,r.display_name COLLATE NOCASE`).all(runId)
      .map(row => ({ candidateId: row.candidate_id, displayName: row.display_name, section: row.section,
        status: row.status === 'in_progress' && Date.now() >= Date.parse(row.deadline_at) ? 'expired'
          : row.status || 'registered',
        startedAt: row.started_at, deadlineAt: row.deadline_at,
        answeredCount: row.answered_count || 0, lastSubmissionAt: row.last_submission_at }));
    const counts = { registered: 0, in_progress: 0, submitted: 0, expired: 0 };
    for (const row of rows) counts[row.status]++;
    return { runId, name: run.name || exam.public.title, activityTitle: exam.public.title,
      version: run.version, className: run.class_name, opensAt: run.opens_at, closesAt: run.closes_at,
      questionCount, counts, rows, updatedAt: stamp() };
  }
  loginInstructor(password, configuredPassword) {
    invariant(typeof password === 'string' && password === configuredPassword, 'UNAUTHORIZED', 'Invalid instructor credentials.', 401);
    const token = randomUUID() + randomUUID();
    const expires = new Date(Date.now() + 8 * 3600_000).toISOString();
    this.db.prepare('INSERT INTO instructor_tokens VALUES (?,?)').run(hash(token), expires);
    this.audit('instructor', 'login', 'instructor');
    return { token, expiresAt: expires };
  }
  requireInstructor(token) {
    const row = token && this.db.prepare('SELECT expires_at FROM instructor_tokens WHERE token_hash=?').get(hash(token));
    invariant(row && Date.parse(row.expires_at) > Date.now(), 'UNAUTHORIZED', 'Instructor sign-in required.', 401);
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
  join({ runId, candidateId, pin }) {
    const run = this.db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
    const roster = run && this.db.prepare('SELECT * FROM roster WHERE run_id=? AND candidate_id=?').get(runId, candidateId);
    invariant(run && roster && hash(String(pin ?? '')) === run.pin_hash, 'UNAUTHORIZED', 'Invalid run, school ID or admission PIN.', 401);
    const now = Date.now();
    const existing = this.db.prepare('SELECT * FROM sessions WHERE run_id=? AND candidate_id=?').get(runId, candidateId);
    const resultReview = existing && now >= Date.parse(run.closes_at);
    invariant(resultReview || (run.status === 'open' && now >= Date.parse(run.opens_at) && now < Date.parse(run.closes_at)),
      'RUN_CLOSED', 'This activity run is not open.', 403);
    const token = randomUUID() + randomUUID();
    if (existing) {
      this.db.prepare('UPDATE sessions SET token_hash=? WHERE id=?').run(hash(token), existing.id);
      return { token, resumed: true, session: this.sessionView(existing.id) };
    }
    const exam = this.getExam(run.exam_id, run.version);
    const order = assignedOrder(exam.public.missions);
    const questionOrder = Object.fromEntries(exam.public.missions.map(mission => [mission.id,
      run.shuffle_questions ? shuffled(mission.activities.map(activity => activity.id))
        : mission.activities.map(activity => activity.id)]));
    const deadline = Math.min(now + exam.public.settings.durationMinutes * 60_000, Date.parse(run.closes_at));
    const id = randomUUID();
    this.db.prepare(`INSERT INTO sessions
      (id,run_id,candidate_id,token_hash,order_json,question_order_json,started_at,deadline_at,status)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, runId, candidateId, hash(token), JSON.stringify(order), JSON.stringify(questionOrder),
        new Date(now).toISOString(), new Date(deadline).toISOString(), 'in_progress');
    this.audit(candidateId, 'start_session', id, { runId });
    return { token, resumed: false, session: this.sessionView(id) };
  }
  requireCandidate(token) {
    const row = token && this.db.prepare('SELECT id FROM sessions WHERE token_hash=?').get(hash(token));
    invariant(row, 'UNAUTHORIZED', 'Candidate sign-in required.', 401);
    return row.id;
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
    const attempts = new Set(this.db.prepare('SELECT DISTINCT activity_id FROM submissions WHERE session_id=?').all(sessionId).map(r => r.activity_id));
    const completed = new Set();
    const order = parse(session.order_json);
    const missions = order.map(id => exam.public.missions.find(m => m.id === id));
    const states = missions.map((m, i) => {
      const dependenciesMet = (m.dependsOn ?? []).every(x => completed.has(x));
      const priorMet = i === 0 || completed.has(missions[i - 1].id);
      const done = m.activities.every(a => attempts.has(a.id));
      const unlocked = dependenciesMet && priorMet;
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
    const { session, run, exam, roster } = this.context(sessionId);
    const progress = this.progress(sessionId);
    const status = Date.now() >= Date.parse(session.deadline_at) && session.status === 'in_progress' ? 'expired' : session.status;
    const resultsReleased = run.feedback_mode === 'practice' || Date.now() >= Date.parse(run.closes_at);
    return {
      id: session.id, candidateId: session.candidate_id, displayName: roster.display_name, section: roster.section,
      examId: exam.public.examId, version: exam.public.version, title: exam.public.title,
      kind: presentationKind(exam.public), difficulty: exam.public.difficulty || null,
      description: exam.public.description, startedAt: session.started_at, deadlineAt: session.deadline_at,
      status, feedbackMode: run.feedback_mode, resultsReleased,
      ...(resultsReleased ? { score: this.score(sessionId) } : {}), maxPoints: exam.public.settings.coreMaxPoints,
      order: progress
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
      return { ...publicActivity, lastSubmission: last ? parse(last.response_json) : null,
        lastDraft: !last && draft ? { ...parse(draft.response_json), updatedAt: draft.updated_at } : null,
        attemptsUsed, attemptPolicy: policy,
        attemptsRemaining: policy.maxRetries === null ? null : Math.max(0, policy.maxRetries + 1 - attemptsUsed) };
    }), version: exam.public.version };
  }
  saveDraft(sessionId, activityId, response) {
    const { session, exam } = this.context(sessionId);
    invariant(session.status === 'in_progress' && Date.now() < Date.parse(session.deadline_at), 'SESSION_CLOSED', 'The session is closed.', 403);
    const mission = exam.public.missions.find(m => m.activities.some(a => a.id === activityId));
    invariant(mission, 'ACTIVITY_NOT_FOUND', 'Activity not found.', 404);
    this.missionView(sessionId, mission.id);
    invariant(response && typeof response === 'object' && !Array.isArray(response), 'INVALID_DRAFT', 'Draft must be an answer object.');
    const encoded = JSON.stringify(response);
    invariant(encoded.length <= 100_000, 'DRAFT_TOO_LARGE', 'Draft is too large.', 413);
    this.tx(() => {
      const live = this.db.prepare('SELECT status,deadline_at FROM sessions WHERE id=?').get(sessionId);
      invariant(live.status === 'in_progress' && Date.now() < Date.parse(live.deadline_at), 'SESSION_CLOSED', 'The session is closed.', 403);
      if (!this.db.prepare('SELECT 1 FROM submissions WHERE session_id=? AND activity_id=? LIMIT 1').get(sessionId, activityId)) {
        this.db.prepare(`INSERT INTO answer_drafts(session_id,activity_id,response_json,updated_at) VALUES(?,?,?,?)
          ON CONFLICT(session_id,activity_id) DO UPDATE SET response_json=excluded.response_json,updated_at=excluded.updated_at`)
          .run(sessionId, activityId, encoded, stamp());
      }
    });
    return { saved: true, updatedAt: stamp() };
  }
  submit(sessionId, activityId, submission, idempotencyKey = null) {
    const { run, exam } = this.context(sessionId);
    const mission = exam.public.missions.find(m => m.activities.some(a => a.id === activityId));
    invariant(mission, 'ACTIVITY_NOT_FOUND', 'Activity not found.', 404);
    this.missionView(sessionId, mission.id);
    const activity = mission.activities.find(a => a.id === activityId);
    const rule = exam.private.rules[activity.gradingRuleId];
    const evaluation = evaluate(activity, rule, submission);
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
      invariant(live.status === 'in_progress' && Date.now() < Date.parse(live.deadline_at), 'SESSION_CLOSED', 'The session is closed.', 403);
      const previous = this.db.prepare('SELECT COUNT(*) AS count FROM submissions WHERE session_id=? AND activity_id=?').get(sessionId, activityId).count;
      invariant(policy.maxRetries === null || previous < policy.maxRetries + 1,
        'ATTEMPT_LIMIT', 'No attempts remain for this question.', 403);
      attemptNumber = previous + 1;
      const submissionId = randomUUID();
      this.db.prepare(`INSERT INTO submissions(id,session_id,activity_id,response_json,result,at,idempotency_key,request_hash)
        VALUES(?,?,?,?,?,?,?,?)`).run(submissionId, sessionId, activityId, JSON.stringify(submission), evaluation.result,
          stamp(), idempotencyKey, idempotencyKey ? requestHash : null);
      this.db.prepare('DELETE FROM answer_drafts WHERE session_id=? AND activity_id=?').run(sessionId, activityId);
      const insert = this.db.prepare('INSERT OR IGNORE INTO score_events VALUES (?,?,?,?,?)');
      for (const c of evaluation.awarded) insert.run(sessionId, activityId, c.id, c.points, stamp());
      if (previous > 0) {
        this.db.prepare('INSERT INTO penalty_events VALUES (?,?,?,?,?,?)')
          .run(submissionId, sessionId, activityId, policy.pointPenalty, policy.timePenaltySeconds, stamp());
        deadlineAt = new Date(Math.max(Date.now(), Date.parse(live.deadline_at) - policy.timePenaltySeconds * 1000)).toISOString();
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
  finalize(sessionId) {
    const { session } = this.context(sessionId);
    if (session.status === 'in_progress') {
      const status = Date.now() >= Date.parse(session.deadline_at) ? 'expired' : 'submitted';
      this.db.prepare('UPDATE sessions SET status=? WHERE id=?').run(status, sessionId);
      this.audit(session.candidate_id, 'finalize', sessionId, { status });
    }
    return this.sessionView(sessionId);
  }
  results(runId) {
    const run = this.db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
    invariant(run, 'RUN_NOT_FOUND', 'Run not found.', 404);
    const exam = this.getExam(run.exam_id, run.version);
    const rows = this.db.prepare(`SELECT r.candidate_id, r.display_name, r.section, s.id AS session_id,
      s.status, s.started_at, s.deadline_at
      FROM roster r LEFT JOIN sessions s ON s.run_id=r.run_id AND s.candidate_id=r.candidate_id
      WHERE r.run_id=? ORDER BY r.section,r.candidate_id`).all(runId);
    return { runId, examId: run.exam_id, version: run.version, title: exam.public.title,
      classId: run.class_id, className: run.class_name,
      name: run.name || exam.public.title,
      opensAt: run.opens_at, closesAt: run.closes_at,
      maxPoints: exam.public.settings.coreMaxPoints,
      rows: rows.map(r => ({ candidateId: r.candidate_id, displayName: r.display_name, section: r.section,
        sessionId: r.session_id, status: r.session_id && r.status === 'in_progress' && Date.now() >= Date.parse(r.deadline_at)
          ? 'expired' : r.status ?? 'registered', startedAt: r.started_at,
        deadlineAt: r.deadline_at, score: r.session_id ? this.score(r.session_id) : 0 })) };
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
    return { ...base, sessionId: session.id, status, startedAt: session.started_at,
      deadlineAt: session.deadline_at, score: this.score(session.id),
      canOverride: status !== 'in_progress', questions };
  }
  overrideQuestionScore(runId, candidateId, activityId, input, actor = 'instructor') {
    const review = this.reviewStudent(runId, candidateId);
    invariant(review.sessionId && review.canOverride, 'ATTEMPT_IN_PROGRESS', 'Wait until the attempt ends before changing a score.', 409);
    const question = review.questions.find(item => item.id === activityId);
    invariant(question, 'ACTIVITY_NOT_FOUND', 'Question is not in this run.', 404);
    invariant(Number.isInteger(input?.points) && input.points >= 0 && input.points <= question.maxPoints,
      'INVALID_SCORE', `Enter a whole-number score from 0 to ${question.maxPoints}.`);
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    invariant(reason.length >= 3 && reason.length <= 300, 'INVALID_SCORE', 'Give a reason of 3–300 characters.');
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
    const minutes = Number(input?.minutes);
    invariant(Number.isInteger(minutes) && minutes >= 1 && minutes <= 120,
      'INVALID_RECOVERY', 'Enter a whole number of minutes from 1 to 120.');
    const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
    invariant(reason.length >= 3 && reason.length <= 300, 'INVALID_RECOVERY', 'Give a reason of 3–300 characters.');
    const now = Date.now();
    let deadline;
    if (action === 'extend') {
      invariant(session.status === 'in_progress', 'ATTEMPT_NOT_ACTIVE', 'Only an active attempt can receive extra time.', 409);
      deadline = Math.min(Math.max(now, Date.parse(session.deadline_at)) + minutes * 60_000, Date.parse(run.closes_at));
      invariant(deadline > Date.parse(session.deadline_at), 'RUN_CLOSED', 'The run closing time leaves no room to extend this attempt.', 409);
    } else {
      const effectiveStatus = session.status === 'in_progress' && now >= Date.parse(session.deadline_at) ? 'expired' : session.status;
      invariant(['submitted', 'expired'].includes(effectiveStatus), 'ATTEMPT_NOT_RECOVERABLE', 'Only submitted or expired attempts can be reopened.', 409);
      deadline = Math.min(now + minutes * 60_000, Date.parse(run.closes_at));
      invariant(deadline > now, 'RUN_CLOSED', 'The run closing time leaves no room to reopen this attempt.', 409);
    }
    this.tx(() => {
      this.db.prepare("UPDATE sessions SET status='in_progress',deadline_at=? WHERE id=?")
        .run(new Date(deadline).toISOString(), session.id);
      this.audit(actor, action === 'extend' ? 'extend_student_time' : 'reopen_student_attempt', session.id,
        { runId, candidateId, minutes, reason, previousDeadlineAt: session.deadline_at, deadlineAt: new Date(deadline).toISOString() });
    });
    return this.reviewStudent(runId, candidateId);
  }
  auditLog() {
    return this.db.prepare('SELECT actor,action,target,detail_json,at FROM audit_events ORDER BY at DESC LIMIT 100').all()
      .map(r => ({ actor: r.actor, action: r.action, target: r.target, detail: parse(r.detail_json), at: r.at }));
  }
}
