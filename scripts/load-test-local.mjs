import assert from 'node:assert/strict';
import { statfsSync } from 'node:fs';
import os from 'node:os';
import { parse } from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildGeneratedPackage } from '../src/ai.mjs';
import { configureRuntimeTemp } from '../src/runtime-temp.mjs';

const tempDirectory = configureRuntimeTemp();

const realDocker = process.argv.includes('--docker');
const count = Number(process.argv.find(arg => /^--students=/.test(arg))?.split('=')[1] || 80);
assert.ok(Number.isInteger(count) && count >= 1 && count <= 80, 'Choose 1–80 students.');
if (realDocker) {
  const disk = statfsSync(parse(os.tmpdir()).root);
  assert.ok(disk.bavail * disk.bsize >= 10 * 2**30, `Free at least 10 GB on the runtime/temp drive (${tempDirectory}) before a Docker load test.`);
}
// Never connect to the configured classroom database or send data to AI.
process.env.NODE_ENV = 'test'; process.env.DATA_FILE = ':memory:'; process.env.DEMO_MODE = '1';
const { server, store } = await import('../src/server.mjs');
let running = 0, peak = 0;
if (!realDocker) store.codeRunner = async (_language, _code, input) => {
  peak = Math.max(peak, ++running);
  await new Promise(resolve => setTimeout(resolve, 10)); running--;
  return { succeeded: true, output: String(input.split(' ').map(Number).reduce((a,b) => a+b)), error: '' };
};
const source = { filename: 'load-test.md', content: 'Read two integers and print their sum. Use standard input and output and handle negative values and zero. Verify more than one pair of numbers.' };
const generated = buildGeneratedPackage({ title: 'Local load rehearsal', subject: 'Python', kind: 'activity', durationMinutes: 30, missionCount: 1, source },
  { missions: [{ title: 'Sum', activities: [{ type: 'code_writing', language: 'python', prompt: 'Read two integers. Print their sum.',
    starterCode: '# TODO', samples: [{ input: '2 3', output: '5' }], comparison: { mode: 'whitespace' },
    referenceCode: 'a,b=map(int,input().split())\nprint(a+b)', tests: [{ input: '2 3', output: '5' }, { input: '-8 1', output: '-7' }],
    evidenceQuote: 'Read two integers and print their sum.', location: 'Source' }] }] });
const timings = [];
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function call(path, token, data, extra = {}) {
  const start = performance.now();
  const response = await fetch(base + path, { method: data === undefined ? 'GET' : path.endsWith('/draft') ? 'PUT' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...extra }, body: data === undefined ? undefined : JSON.stringify(data) });
  const body = await response.json(); timings.push(performance.now() - start);
  assert.ok(response.ok, `${path}: ${body.code}`); return body.data;
}
try {
  store.importDraft(generated.public, generated.private); store.addSource(generated.public.examId, 1, source); store.publish(generated.public.examId, 1);
  const run = store.createRun({ examId: generated.public.examId, version: 1, pin: '2468', feedbackMode: 'graded',
    opensAt: new Date(Date.now()-1000).toISOString(), closesAt: new Date(Date.now()+3600000).toISOString(),
    roster: Array.from({ length: count }, (_, i) => ({ candidateId: `LOAD-${i}`, displayName: `Test student ${i}`, section: 'Synthetic' })) });
  const started = performance.now();
  await Promise.all(Array.from({ length: count }, async (_, i) => {
    const credentials = { runId: run.id, candidateId: `LOAD-${i}`, pin: '2468' };
    await call('/api/auth/student/preview', null, credentials);
    const joined = await call('/api/auth/student/join', null, credentials), token = joined.token;
    await call('/api/me/missions/mission-1', token);
    const answer = { value: 'a,b=map(int,input().split())\nprint(a+b)' };
    await call('/api/me/activities/m1-q1/draft', token, answer);
    const preview = await call('/api/me/activities/m1-q1/preview', token, answer, { Prefer: 'respond-async' });
    let job;
    const until = Date.now() + 15 * 60 * 1000;
    do {
      assert.ok(Date.now() < until, 'Preview queue did not drain.');
      await new Promise(resolve => setTimeout(resolve, realDocker ? 2000 : 50));
      job = await call(`/api/me/coding-jobs/${preview.jobId}`, token);
      assert.notEqual(job.status, 'failed', JSON.stringify(job.error));
    } while (job.status !== 'done');
    assert.equal(job.result.samples[0].succeeded, true);
    const receipt = await call('/api/me/activities/m1-q1/submit', token, answer, { 'Idempotency-Key': `load-request-${String(i).padStart(8,'0')}` });
    assert.equal(receipt.saved, true);
    await call('/api/me/finalize', token, {});
    assert.equal(store.hasPendingReview(joined.session.id), true);
    assert.equal(store.score(joined.session.id), 0);
  }));
  timings.sort((a,b) => a-b);
  console.log(JSON.stringify({ mode: realDocker ? 'REAL Docker execution' : 'SIMULATED runner; not a Docker capacity measurement', tempDirectory, students: count,
    requests: timings.length, durationSeconds: +( (performance.now()-started)/1000).toFixed(2),
    requestP95Ms: +timings[Math.floor(timings.length*0.95)].toFixed(2), peakSimulatedExecutions: realDocker ? undefined : peak,
    queue: store.codingQueue.stats(), verifiedManualReviewSubmissions: count }, null, 2));
} finally { server.close(); store.close(); }
