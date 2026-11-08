export function initializeStoreSchema(db) {
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(`
      CREATE TABLE IF NOT EXISTS faculty_ai_settings (faculty_id TEXT PRIMARY KEY, settings_json TEXT NOT NULL);
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
        token_hash TEXT NOT NULL UNIQUE, token_expires_at TEXT, order_json TEXT NOT NULL,
        question_order_json TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL, deadline_at TEXT NOT NULL, status TEXT NOT NULL,
        results_published_at TEXT,
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
      CREATE TABLE IF NOT EXISTS web_checkpoints (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        activity_id TEXT NOT NULL, database_snapshot TEXT, saved_at TEXT NOT NULL,
        PRIMARY KEY(session_id,activity_id)
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
      CREATE INDEX IF NOT EXISTS penalties_session_activity ON penalty_events(session_id,activity_id);
      CREATE INDEX IF NOT EXISTS submissions_session_activity ON submissions(session_id,activity_id);
      CREATE INDEX IF NOT EXISTS sessions_run ON sessions(run_id);
    `);
  if (
    db
      .prepare('PRAGMA table_info(roster)')
      .all()
      .some((column) => column.name === 'secret_hash')
  )
    db.exec('ALTER TABLE roster DROP COLUMN secret_hash');
  if (
    !db
      .prepare('PRAGMA table_info(runs)')
      .all()
      .some((column) => column.name === 'name')
  )
    db.exec('ALTER TABLE runs ADD COLUMN name TEXT');
  if (
    !db
      .prepare('PRAGMA table_info(runs)')
      .all()
      .some((column) => column.name === 'class_id')
  )
    db.exec('ALTER TABLE runs ADD COLUMN class_id TEXT');
  if (
    !db
      .prepare('PRAGMA table_info(runs)')
      .all()
      .some((column) => column.name === 'class_name')
  )
    db.exec('ALTER TABLE runs ADD COLUMN class_name TEXT');
  if (
    !db
      .prepare('PRAGMA table_info(runs)')
      .all()
      .some((column) => column.name === 'feedback_mode')
  )
    db.exec("ALTER TABLE runs ADD COLUMN feedback_mode TEXT NOT NULL DEFAULT 'practice'");
  if (
    !db
      .prepare('PRAGMA table_info(runs)')
      .all()
      .some((column) => column.name === 'shuffle_questions')
  )
    db.exec('ALTER TABLE runs ADD COLUMN shuffle_questions INTEGER NOT NULL DEFAULT 0');
  if (
    !db
      .prepare('PRAGMA table_info(sessions)')
      .all()
      .some((column) => column.name === 'question_order_json')
  )
    db.exec("ALTER TABLE sessions ADD COLUMN question_order_json TEXT NOT NULL DEFAULT '{}'");
  if (
    !db
      .prepare('PRAGMA table_info(sessions)')
      .all()
      .some((column) => column.name === 'results_published_at')
  )
    db.exec('ALTER TABLE sessions ADD COLUMN results_published_at TEXT');
  if (
    !db
      .prepare('PRAGMA table_info(sessions)')
      .all()
      .some((column) => column.name === 'token_expires_at')
  )
    db.exec('ALTER TABLE sessions ADD COLUMN token_expires_at TEXT');
  // Legacy tokens had no expiry. Require one rejoin while preserving the attempt.
  db.exec("UPDATE sessions SET token_expires_at='1970-01-01T00:00:00.000Z' WHERE token_expires_at IS NULL");
  if (
    !db
      .prepare('PRAGMA table_info(submissions)')
      .all()
      .some((column) => column.name === 'idempotency_key')
  )
    db.exec('ALTER TABLE submissions ADD COLUMN idempotency_key TEXT');
  if (
    !db
      .prepare('PRAGMA table_info(submissions)')
      .all()
      .some((column) => column.name === 'request_hash')
  )
    db.exec('ALTER TABLE submissions ADD COLUMN request_hash TEXT');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS submissions_idempotency
      ON submissions(session_id,activity_id,idempotency_key)`);
  if (
    !db
      .prepare('PRAGMA table_info(runs)')
      .all()
      .some((column) => column.name === 'proctor_code_hash')
  )
    db.exec('ALTER TABLE runs ADD COLUMN proctor_code_hash TEXT');
  if (
    !db
      .prepare('PRAGMA table_info(runs)')
      .all()
      .some((column) => column.name === 'proctor_code_issued_at')
  )
    db.exec('ALTER TABLE runs ADD COLUMN proctor_code_issued_at TEXT');
  if (
    !db
      .prepare('PRAGMA table_info(exams)')
      .all()
      .some((column) => column.name === 'archived_at')
  )
    db.exec('ALTER TABLE exams ADD COLUMN archived_at TEXT');
  for (const [column, type] of [
    ['gender', 'TEXT'],
    ['year_level', 'TEXT'],
    ['program_short_name', 'TEXT'],
  ])
    if (
      !db
        .prepare('PRAGMA table_info(class_students)')
        .all()
        .some((item) => item.name === column)
    )
      db.exec(`ALTER TABLE class_students ADD COLUMN ${column} ${type}`);
}
