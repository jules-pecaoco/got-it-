import { randomUUID } from 'node:crypto';

// Claims and expiring leases prevent two API processes from owning the same job.
export class CodingQueue {
  constructor(db, handler, { concurrency = 2, capacity = 160 } = {}) {
    this.db = db; this.handler = handler; this.concurrency = concurrency;
    this.capacity = capacity; this.active = 0; this.closed = false;
    this.owner = randomUUID();
    db.exec(`CREATE TABLE IF NOT EXISTS coding_jobs (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      activity_id TEXT NOT NULL, kind TEXT NOT NULL, request_key TEXT NOT NULL,
      payload_json TEXT NOT NULL, accepted_at TEXT NOT NULL, status TEXT NOT NULL,
      result_json TEXT, error_json TEXT, lease_owner TEXT, lease_until TEXT,
      failures INTEGER NOT NULL DEFAULT 0, retry_at TEXT,
      UNIQUE(session_id,activity_id,kind,request_key));
      CREATE INDEX IF NOT EXISTS coding_jobs_pending ON coding_jobs(status,accepted_at);
      CREATE INDEX IF NOT EXISTS coding_jobs_session ON coding_jobs(session_id,status);`);
    this.recovered = new Set();
    this.timer = setInterval(() => {
      if (this.closed) return;
      db.prepare("UPDATE coding_jobs SET lease_until=? WHERE status='running' AND lease_owner=?")
        .run(new Date(Date.now() + 30000).toISOString(), this.owner);
      this.recover(); this.pump();
    }, 5000);
    this.timer.unref();
    this.recover();
    setImmediate(() => this.pump());
  }
  recover() {
    const now = new Date().toISOString();
    const expired = this.db.prepare("SELECT id FROM coding_jobs WHERE status='running' AND (lease_until IS NULL OR lease_until<?)").all(now);
    for (const job of expired) this.recovered.add(job.id);
    this.db.prepare("UPDATE coding_jobs SET status='queued',lease_owner=NULL WHERE status='running' AND (lease_until IS NULL OR lease_until<?)").run(now);
    this.db.prepare("UPDATE coding_jobs SET status='queued' WHERE status='failed' AND failures<3 AND retry_at<=?").run(now);
  }
  enqueue(sessionId, activityId, kind, key, payload, { acceptedAt = new Date().toISOString(), finalizing = false } = {}) {
    const encoded = JSON.stringify(payload);
    const prior = this.db.prepare('SELECT * FROM coding_jobs WHERE session_id=? AND activity_id=? AND kind=? AND request_key=?')
      .get(sessionId, activityId, kind, key);
    if (prior) {
      if (prior.payload_json !== encoded) throw Object.assign(new Error('Retry key belongs to a different answer.'), { code: 'IDEMPOTENCY_CONFLICT', status: 409 });
      if (prior.status === 'failed') this.db.prepare("UPDATE coding_jobs SET status='queued',error_json=NULL,failures=0 WHERE id=?").run(prior.id);
      this.pump(); return this.view(sessionId, prior.id);
    }
    if (!finalizing && this.db.prepare("SELECT 1 FROM coding_jobs WHERE session_id=? AND status IN ('queued','running')").get(sessionId))
      throw Object.assign(new Error('Wait for your current coding job to finish.'), { code: 'CODING_JOB_PENDING', status: 409 });
    if (this.stats().pending >= this.capacity) throw Object.assign(new Error('The coding queue is full. Retry shortly; no attempt was charged.'), { code: 'CODE_RUNNER_BUSY', status: 429 });
    const id = randomUUID();
    this.db.prepare("INSERT INTO coding_jobs(id,session_id,activity_id,kind,request_key,payload_json,accepted_at,status) VALUES(?,?,?,?,?,?,?,'queued')")
      .run(id, sessionId, activityId, kind, key, encoded, acceptedAt);
    this.pump(); return this.view(sessionId, id);
  }
  stats() {
    const rows = this.db.prepare("SELECT status,COUNT(*) AS n FROM coding_jobs WHERE status IN ('queued','running') GROUP BY status").all();
    const counts = Object.fromEntries(rows.map(r => [r.status, r.n]));
    const oldest = this.db.prepare("SELECT MIN(accepted_at) AS at FROM coding_jobs WHERE status='queued'").get().at;
    return { queued: counts.queued || 0, running: counts.running || 0, pending: (counts.queued || 0) + (counts.running || 0), concurrency: this.concurrency, capacity: this.capacity,
      oldestQueuedSeconds: oldest ? Math.max(0, Math.round((Date.now() - Date.parse(oldest)) / 1000)) : 0 };
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
      let job;
      this.db.exec('BEGIN IMMEDIATE');
      try {
        job = this.db.prepare("SELECT * FROM coding_jobs WHERE status='queued' ORDER BY CASE WHEN kind='preview' AND accepted_at<? THEN 0 WHEN kind='submit' THEN 1 ELSE 2 END,accepted_at,rowid LIMIT 1")
          .get(new Date(Date.now() - 30000).toISOString());
        if (job) this.db.prepare("UPDATE coding_jobs SET status='running',lease_owner=?,lease_until=? WHERE id=? AND status='queued'")
          .run(this.owner, new Date(Date.now() + 30000).toISOString(), job.id);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      if (!job) break;
      job.recovered = this.recovered.has(job.id);
      this.active++;
      Promise.resolve().then(() => this.handler(job)).then(result => {
        if (!this.closed) this.db.prepare("UPDATE coding_jobs SET status='done',result_json=?,lease_until=NULL WHERE id=? AND lease_owner=?").run(JSON.stringify(result), job.id, this.owner);
      }, error => {
        if (!this.closed) this.db.prepare("UPDATE coding_jobs SET status='failed',error_json=?,failures=failures+1,retry_at=?,lease_until=NULL WHERE id=? AND lease_owner=?")
          .run(JSON.stringify({ code: error.code || 'CODE_RUNNER_UNAVAILABLE', message: error.status ? error.message : 'Coding service interrupted. Retry your submission.' }),
            error.status === 503 || !error.status ? new Date(Date.now() + 5000).toISOString() : null, job.id, this.owner);
      }).finally(() => { this.active--; this.pump(); });
    }
  }
  close() { this.closed = true; clearInterval(this.timer); }
}
