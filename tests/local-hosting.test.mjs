import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CodingQueue } from '../src/coding-queue.mjs';
import { backupDatabase } from '../src/backup.mjs';
import { migrationDatabase } from '../src/migration-database.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
test('migration hosting reuses its copy and never edits the original database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gotit-migration-'));
  const source = join(dir, 'original.sqlite'), target = join(dir, 'migration.sqlite');
  const previous = process.env.MIGRATION_DATA_FILE;
  let db = new DatabaseSync(source); db.exec('CREATE TABLE answers(value TEXT); INSERT INTO answers VALUES(\'original\')'); db.close();
  try {
    process.env.MIGRATION_DATA_FILE = target; assert.equal(migrationDatabase(source), target);
    db = new DatabaseSync(target); db.exec("INSERT INTO answers VALUES('migration')"); db.close();
    assert.equal(migrationDatabase(source), target);
    db = new DatabaseSync(source, { readOnly: true }); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM answers').get().n, 1); db.close();
    process.env.MIGRATION_DATA_FILE = source; assert.throws(() => migrationDatabase(source), /separate/);
  } finally { if (previous === undefined) delete process.env.MIGRATION_DATA_FILE; else process.env.MIGRATION_DATA_FILE = previous; rmSync(dir, { recursive: true }); }
});
test('two queue owners do not reclaim another owner live lease', async () => {
  const db = new DatabaseSync(':memory:'); db.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY); INSERT INTO sessions VALUES('s1')");
  let release, executions = 0;
  const handler = async () => { executions++; await new Promise(resolve => { release = resolve; }); return { saved: true }; };
  const first = new CodingQueue(db, handler);
  const job = first.enqueue('s1', 'q1', 'submit', 'request-key', {});
  await tick();
  const second = new CodingQueue(db, handler);
  try {
    await tick(); assert.equal(executions, 1); assert.equal(second.view('s1', job.jobId).status, 'running');
    release(); await tick(); assert.equal(first.view('s1', job.jobId).status, 'done');
  } finally { first.close(); second.close(); db.close(); }
});
test('80 queued jobs complete with bounded concurrency and isolated results', async () => {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY)');
  let running = 0, peak = 0, executed = 0;
  const queue = new CodingQueue(db, async row => {
    peak = Math.max(peak, ++running); await tick(); running--; executed++; return { saved: row.session_id };
  });
  try {
    const jobs = Array.from({ length: 80 }, (_, i) => {
      db.prepare('INSERT INTO sessions VALUES(?)').run(`student-${i}`);
      return queue.enqueue(`student-${i}`, 'q1', 'submit', `request-key-${i}`, { value: 'print(1)' });
    });
    assert.throws(() => queue.enqueue('student-0', 'q2', 'submit', 'another-request', {}), e => e.code === 'CODING_JOB_PENDING');
    assert.throws(() => queue.view('student-1', jobs[0].jobId), e => e.status === 404);
    const deadline = Date.now() + 5000;
    while (queue.stats().pending && Date.now() < deadline) await tick();
    assert.equal(queue.stats().pending, 0); assert.equal(peak, 2); assert.equal(executed, 80);
    for (let i = 0; i < jobs.length; i++) assert.deepEqual(queue.view(`student-${i}`, jobs[i].jobId).result, { saved: `student-${i}` });
    assert.equal(queue.enqueue('student-0', 'q1', 'submit', 'request-key-0', { value: 'print(1)' }).jobId, jobs[0].jobId);
    assert.throws(() => queue.enqueue('student-0', 'q1', 'submit', 'request-key-0', { value: 'different' }), e => e.code === 'IDEMPOTENCY_CONFLICT');
  } finally { queue.close(); db.close(); }
});

test('queue recovers interrupted jobs from disk and bounds its backlog', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gotit-queue-')), file = join(dir, 'jobs.sqlite');
  let db = new DatabaseSync(file); db.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY); INSERT INTO sessions VALUES('s1'),('s2')");
  let queue = new CodingQueue(db, async () => ({}), { capacity: 1 });
  queue.close();
  db.prepare("INSERT INTO coding_jobs(id,session_id,activity_id,kind,request_key,payload_json,accepted_at,status) VALUES('j1','s1','q1','submit','key','{}',?,'running')").run(new Date().toISOString());
  db.close();
  db = new DatabaseSync(file); queue = new CodingQueue(db, async () => ({ recovered: true }), { capacity: 1 });
  try {
    assert.throws(() => queue.enqueue('s2', 'q1', 'submit', 'key', {}), e => e.code === 'CODE_RUNNER_BUSY');
    const deadline = Date.now() + 2000;
    while (queue.stats().pending && Date.now() < deadline) await tick();
    assert.deepEqual(queue.view('s1', 'j1').result, { recovered: true });
  } finally { queue.close(); db.close(); rmSync(dir, { recursive: true }); }
});

test('online backup includes committed WAL data and never overwrites a destination', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gotit-backup-')), source = join(dir, 'live.sqlite'), dest = join(dir, 'backup.sqlite');
  const db = new DatabaseSync(source);
  try {
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE answers(value TEXT); INSERT INTO answers VALUES('committed')");
    backupDatabase(source, dest);
    const copy = new DatabaseSync(dest, { readOnly: true });
    try { assert.equal(copy.prepare('SELECT value FROM answers').get().value, 'committed'); } finally { copy.close(); }
    assert.throws(() => backupDatabase(source, dest), /new file/);
  } finally { db.close(); rmSync(dir, { recursive: true }); }
});
