import { randomUUID } from 'node:crypto';

// One application process owns this durable queue. Student programs still run
// exclusively through the restricted Docker runner.
export class CodingQueue {
  constructor(db, handler, { concurrency = 2, capacity = 160 } = {}) {
    this.db = db; this.handler = handler; this.concurrency = concurrency;
    this.capacity = capacity; this.active = 0; this.closed = false;
    db.exec(`CREATE TABLE IF NOT EXISTS coding_jobs (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      activity_id TEXT NOT NULL, kind TEXT NOT NULL, request_key TEXT NOT NULL,
      payload_json TEXT NOT NULL, accepted_at TEXT NOT NULL, status TEXT NOT NULL,
      result_json TEXT, error_json TEXT, UNIQUE(session_id,activity_id,kind,request_key));
      CREATE INDEX IF NOT EXISTS coding_jobs_pending ON coding_jobs(status,accepted_at);
      CREATE INDEX IF NOT EXISTS coding_jobs_session ON coding_jobs(session_id,status);`);
    this.recovered = new Set(db.prepare("SELECT id FROM coding_jobs WHERE status='running'").all().map(row => row.id));
    db.prepare("UPDATE coding_jobs SET status='queued' WHERE status='running'").run();
    setImmediate(() => this.pump());
  }
  enqueue(sessionId, activityId, kind, key, payload) {
    const encoded = JSON.stringify(payload);
    const prior = this.db.prepare('SELECT * FROM coding_jobs WHERE session_id=? AND activity_id=? AND kind=? AND request_key=?')
      .get(sessionId, activityId, kind, key);
    if (prior) {
      if (prior.payload_json !== encoded) throw Object.assign(new Error('Retry key belongs to a different answer.'), { code: 'IDEMPOTENCY_CONFLICT', status: 409 });
      if (prior.status === 'failed') this.db.prepare("UPDATE coding_jobs SET status='queued',error_json=NULL WHERE id=?").run(prior.id);
      this.pump(); return this.view(sessionId, prior.id);
    }
    if (this.db.prepare("SELECT 1 FROM coding_jobs WHERE session_id=? AND status IN ('queued','running')").get(sessionId))
      throw Object.assign(new Error('Wait for your current coding job to finish.'), { code: 'CODING_JOB_PENDING', status: 409 });
    if (this.stats().pending >= this.capacity) throw Object.assign(new Error('The coding queue is full. Retry shortly; no attempt was charged.'), { code: 'CODE_RUNNER_BUSY', status: 429 });
    const id = randomUUID();
    this.db.prepare("INSERT INTO coding_jobs(id,session_id,activity_id,kind,request_key,payload_json,accepted_at,status) VALUES(?,?,?,?,?,?,?,'queued')")
      .run(id, sessionId, activityId, kind, key, encoded, new Date().toISOString());
    this.pump(); return this.view(sessionId, id);
  }
  stats() {
    const rows = this.db.prepare("SELECT status,COUNT(*) AS n FROM coding_jobs WHERE status IN ('queued','running') GROUP BY status").all();
    const counts = Object.fromEntries(rows.map(r => [r.status, r.n]));
    return { queued: counts.queued || 0, running: counts.running || 0, pending: (counts.queued || 0) + (counts.running || 0), concurrency: this.concurrency, capacity: this.capacity };
  }
  view(sessionId, id) {
    const row = this.db.prepare('SELECT * FROM coding_jobs WHERE id=? AND session_id=?').get(id, sessionId);
    if (!row) throw Object.assign(new Error('Coding job not found.'), { code: 'NOT_FOUND', status: 404 });
    return { jobId: row.id, status: row.status, acceptedAt: row.accepted_at,
      ...(row.status === 'done' ? { result: JSON.parse(row.result_json) } : {}),
      ...(row.status === 'failed' ? { error: JSON.parse(row.error_json) } : {}) };
  }
  pump() {
    if (this.closed) return;
    while (this.active < this.concurrency) {
      const job = this.db.prepare("SELECT * FROM coding_jobs WHERE status='queued' ORDER BY CASE kind WHEN 'submit' THEN 0 ELSE 1 END,accepted_at,rowid LIMIT 1").get();
      if (!job) break;
      job.recovered = this.recovered.has(job.id);
      this.db.prepare("UPDATE coding_jobs SET status='running' WHERE id=?").run(job.id);
      this.active++;
      Promise.resolve().then(() => this.handler(job)).then(result => {
        if (!this.closed) this.db.prepare("UPDATE coding_jobs SET status='done',result_json=? WHERE id=?").run(JSON.stringify(result), job.id);
      }, error => {
        if (!this.closed) this.db.prepare("UPDATE coding_jobs SET status='failed',error_json=? WHERE id=?")
          .run(JSON.stringify({ code: error.code || 'CODE_RUNNER_UNAVAILABLE', message: error.status ? error.message : 'Coding service interrupted. Retry your submission.' }), job.id);
      }).finally(() => { this.active--; this.pump(); });
    }
  }
  close() { this.closed = true; }
}
