import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Store } from '../src/store.mjs';
import { createPreviewService } from '../src/web-preview.mts';
import { WorkspaceQueue } from '../src/workspace-queue.mts';
import { reconcileWorkspaces, startManagedWorkspace } from '../src/managed-workspaces.mts';
import { startSettlementTimers } from '../src/settlement-timers.mjs';
import { attemptSettlement } from '../src/attempt-settlement.mjs';
import { webTemplate } from './fixtures/web-template.mjs';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { requestChildShutdown } from '../src/child-shutdown.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixtures(store, count = 1) {
  const exam = webTemplate('reliability-web');
  store.importDraft(exam.public, exam.private);
  store.publish(exam.public.examId, 1);
  const run = store.createRun({ examId: exam.public.examId, version: 1, pin: '4242',
    opensAt: new Date(Date.now() - 1000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString(),
    roster: Array.from({ length: count }, (_, i) => ({ candidateId: `S-${i}`, displayName: `Synthetic ${i}`, section: 'Test' })) });
  const ids = Array.from({ length: count }, (_, i) => store.join({ runId: run.id, candidateId: `S-${i}`, pin: '4242' }).session.id);
  return { run, ids, files: exam.public.missions[0].activities[0].publicConfig.files };
}
function fakeFactory() {
  const state = { active: 0, peak: 0, last: undefined, fail: false };
  const factory = () => {
    let started = false;
    const item = { database: '' };
    return {
      async start(project) {
        if (state.fail) throw new Error('simulated startup failure');
        started = true; state.active++; state.peak = Math.max(state.peak, state.active);
        item.database = project.database ?? Buffer.from('seed').toString('base64'); state.last = item;
      },
      async snapshot() { return item.database; },
      async request() { return { status: 200, headers: {}, body: Buffer.from('ok') }; },
      async close() { if (started) { started = false; state.active--; } },
    };
  };
  return { state, factory };
}

test('database checkpoints survive preview expiry, process recreation, failed replacement and explicit import/reset', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'gotit-reliability-'));
  const filename = join(folder, 'test.sqlite');
  let store = new Store(filename, { automaticSettlement: false });
  const { ids: [sid], files } = fixtures(store);
  let now = Date.now();
  const { state, factory } = fakeFactory();
  const make = () => createPreviewService('http://localhost:3999', () => true, '*', () => false,
    { checkpoints: store.webCheckpointStore(), workspaceFactory: factory, now: () => now, lifetimeMs: 100, capacity: 1 });
  let service = make();
  try {
    const old = Buffer.from('old').toString('base64'), latest = Buffer.from('latest records').toString('base64');
    const browser = { files, database: old };
    store.saveDraft(sid, 'php-app', { value: browser });
    await service.open(sid, 'php-app', browser);
    state.last.database = latest;
    now += 101;
    await service.sweep();
    assert.equal(state.active, 0);
    assert.equal(await service.snapshot(sid, 'php-app'), latest);
    assert.equal((await service.open(sid, 'php-app', browser)).database, latest);
    state.fail = true;
    await assert.rejects(service.open(sid, 'php-app', browser), /startup failure/);
    state.fail = false;
    assert.equal((await service.open(sid, 'php-app', browser)).database, latest);
    await service.close(); store.close();
    store = new Store(filename, { automaticSettlement: false });
    service = make();
    assert.equal((await service.open(sid, 'php-app', browser)).database, latest);
    await service.discard(sid, 'php-app');
    const imported = Buffer.from('imported').toString('base64');
    assert.equal((await service.open(sid, 'php-app', { files, database: imported })).database, imported);
    assert.equal((await service.open(sid, 'php-app', browser, '', true)).database, Buffer.from('seed').toString('base64'));
    assert.equal(state.peak, 1);
  } finally {
    await service.close(); store.close();
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    rmSync(folder, { recursive: true, force: true });
  }
});

test('all 80 preview slots can replace projects without allocating an 81st workspace', async () => {
  const { state, factory } = fakeFactory();
  const service = createPreviewService('http://localhost:3999', () => true, '*', () => false, { workspaceFactory: factory });
  try {
    const project = { files: { 'index.php': '<?php echo 1;' } };
    await Promise.all(Array.from({ length: 80 }, (_, i) => service.open(`S-${i}`, 'web', project)));
    await assert.rejects(service.open('new', 'web', project), e => e.code === 'WEB_CAPACITY');
    await Promise.all(Array.from({ length: 80 }, (_, i) => service.open(`S-${i}`, 'web', project)));
    assert.equal(state.peak, 80);
    assert.equal(state.active, 80);
  } finally { await service.close(); }
});

test('preview backlog is bounded and snapshots run before waiting browser requests', async () => {
  const queue = new WorkspaceQueue(2, 1000), active = deferred(), order = [];
  const first = queue.run(async () => { order.push('write'); await active.promise; });
  const browser = queue.run(async () => { order.push('browser'); });
  const snapshot = queue.run(async () => { order.push('snapshot'); }, true);
  await assert.rejects(queue.run(async () => {}), e => e.code === 'WEB_CAPACITY');
  active.resolve(); await Promise.all([first, browser, snapshot]);
  assert.deepEqual(order, ['write', 'snapshot', 'browser']);
  await queue.close();
  await assert.rejects(queue.run(async () => {}), e => e.code === 'WEB_CAPACITY');
});

test('an expired queued request is rejected without executing after a slow write', async () => {
  const queue = new WorkspaceQueue(2, 10), active = deferred(); let executed = false;
  const first = queue.run(() => active.promise);
  await assert.rejects(queue.run(async () => { executed = true; }), e => e.code === 'WEB_CAPACITY');
  active.resolve(); await first; await queue.close();
  assert.equal(executed, false);
});

test('expiry scheduling continues while a background checkpoint is blocked', async () => {
  const blocked = deferred(), began = deferred(), expired = deferred(); let checkpoints = 0, expiries = 0;
  const timers = startSettlementTimers({
    checkpointActive: async () => { checkpoints++; began.resolve(); await blocked.promise; },
    settleExpired: async () => { expiries++; if (expiries > 2) expired.resolve(); },
  }, { expiryMs: 5, checkpointMs: 5 });
  const keepAlive = setTimeout(() => { blocked.resolve(); expired.resolve(); }, 2000);
  try { await began.promise; await expired.promise; assert.ok(expiries > 2); assert.equal(checkpoints, 1); }
  finally { clearTimeout(keepAlive); blocked.resolve(); await timers.stop(); }
});

test('a slow expired student does not block another student settlement', async () => {
  const store = new Store(':memory:', { automaticSettlement: false });
  const blocked = deferred(); let sweep;
  try {
    const { ids, files } = fixtures(store, 2);
    store.codingQueue.concurrency = 0;
    for (const id of ids) store.saveDraft(id, 'php-app', { value: { files } });
    store.db.prepare('UPDATE sessions SET deadline_at=?').run(new Date(Date.now() - 1000).toISOString());
    const settlement = attemptSettlement(store, { snapshot: async id => { if (id === ids[0]) await blocked.promise; return Buffer.from('database').toString('base64'); } });
    sweep = settlement.settleExpired();
    for (let i = 0; i < 10 && store.context(ids[1]).session.status === 'in_progress'; i++) await tick();
    assert.equal(store.context(ids[1]).session.status, 'expired');
    assert.equal(store.context(ids[0]).session.status, 'in_progress');
  } finally { blocked.resolve(); await sweep; store.close(); }
});

test('reconciliation only removes expired owned containers and counts crash survivors toward capacity', async () => {
  const now = Date.now(), expired = `gotit-web-${'a'.repeat(36)}`, live = `gotit-web-${'b'.repeat(36)}`, calls = [];
  const run = async args => {
    calls.push(args);
    if (args[0] === 'ps') return `${expired}|${now - 1}\n${live}|${now + 60000}\n`;
    return '';
  };
  assert.equal(await reconcileWorkspaces(run, now), 1);
  assert.ok(calls[0].some(arg => arg.startsWith('label=gotit.owner=')));
  assert.deepEqual(calls[1], ['rm', '--force', expired]);
  const full = async args => args[0] === 'ps' ? Array.from({ length: 80 }, () => `${live}|${now + 60000}`).join('\n') : assert.fail('Must not launch another container');
  await assert.rejects(startManagedWorkspace('audit', [], 720, full), e => e.code === 'WEB_CAPACITY');
});

test('large objective result views use a bounded number of queries instead of per-student question lookups', () => {
  const store = new Store(':memory:', { automaticSettlement: false });
  try {
    const pub = JSON.parse(readFileSync(new URL('./fixtures/garden/public-exam.json', import.meta.url)));
    const priv = JSON.parse(readFileSync(new URL('./fixtures/garden/private-grading.json', import.meta.url)));
    pub.kind = 'quiz';
    store.importDraft(pub, priv); store.publish(pub.examId, 1);
    const run = store.createRun({ examId: pub.examId, version: 1, pin: '4242',
      opensAt: new Date(Date.now() - 1000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString(),
      roster: Array.from({ length: 500 }, (_, i) => ({ candidateId: `S-${i}`, displayName: `Synthetic ${i}`, section: 'Test' })) });
    for (let i = 0; i < 500; i++) store.join({ runId: run.id, candidateId: `S-${i}`, pin: '4242' });
    let calls = 0;
    const prepare = store.db.prepare.bind(store.db);
    store.db.prepare = sql => new Proxy(prepare(sql), { get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== 'function') return value;
      return (...args) => { calls++; return value.apply(target, args); };
    } });
    const result = store.results(run.id);
    assert.equal(result.rows.length, 500);
    assert.ok(result.rows.every(row => row.pendingReview === false));
    assert.ok(calls < 20, `Results view executed ${calls} queries`);
  } finally { store.close(); }
});

test('launcher IPC drains and closes the application on Windows as well as Unix', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'gotit-shutdown-'));
  const filename = join(folder, 'app.sqlite');
  const code = `const { server } = await import('./src/server.mjs');
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    process.send({type:'ready'});`;
  const child = spawn(process.execPath, ['--import', './src/runtime-temp.mjs', '--import', 'tsx', '--experimental-sqlite', '--input-type=module', '-e', code],
    { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { ...process.env, NODE_ENV: 'test', DATA_FILE: filename, DEMO_MODE: '0', INSTRUCTOR_PASSWORD: 'shutdown-test-password', PREVIEW_ORIGIN: '', EXECUTION_ORIGIN: '', PUBLIC_ORIGIN: '' } });
  let diagnostics = '';
  child.stderr.on('data', data => { diagnostics += data; });
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const timeout = setTimeout(() => child.kill(), 15000);
  try {
    await new Promise((resolve, reject) => {
      child.once('message', resolve);
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Child exited before readiness (${code}): ${diagnostics}`)));
    });
    requestChildShutdown(child);
    assert.deepEqual(await exit, { code: 0, signal: null }, diagnostics);
    const restored = new Store(filename);
    try { assert.equal(restored.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); }
    finally { restored.close(); }
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await exit; }
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    rmSync(folder, { recursive: true, force: true });
  }
});

test('preview POSTs persist their database before success and queued requests cannot start after the deadline', async () => {
  const started = deferred(), release = deferred();
  let allowed = true, saved, writes = 0;
  const service = createPreviewService('http://localhost:3999', () => allowed, '*', () => false, {
    checkpoints: { load: () => saved, save: (_s, _a, value) => { saved = value; }, clear: () => { saved = undefined; } },
    workspaceFactory: () => ({
      start: async () => {}, close: async () => {},
      snapshot: async () => Buffer.from(String(writes)).toString('base64'),
      request: async () => { writes++; started.resolve(); await release.promise; return { status: 200, headers: {}, body: Buffer.from('ok') }; },
    }),
  });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const preview = await service.open('session', 'web', { files: { 'index.php': '<?php' } });
  const url = `http://127.0.0.1:${service.server.address().port}${new URL(preview.url).pathname}`;
  try {
    const first = fetch(url, { method: 'POST', body: 'one=1' });
    await started.promise;
    const second = fetch(url, { method: 'POST', body: 'two=2' });
    for (let i = 0; i < 100 && service.stats().queued === 0; i++) await tick();
    assert.equal(service.stats().queued, 1);
    allowed = false;
    release.resolve();
    const response = await first;
    assert.equal(response.status, 200); await response.text();
    assert.equal(saved, Buffer.from('1').toString('base64'));
    const rejected = await second;
    assert.equal(rejected.status, 503); await rejected.text();
    assert.equal(writes, 1);
  } finally { release.resolve(); await service.close(); }
});
