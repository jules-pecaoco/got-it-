import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { webTemplate } from '../tests/fixtures/web-template.mjs';
import { buildGeneratedPackage } from '../src/ai.mjs';

const real = process.argv.includes('--docker');
const count = Number(process.argv.find((value) => value.startsWith('--students='))?.split('=')[1] || 80);
assert.ok(Number.isInteger(count) && count > 0 && count <= 80, 'Choose 1–80 students.');
const workspaces = new Map<string, { title: string }>();
const terminalRuns = new Map<string, any>();
let serial = 0;
// Simulated mode exercises the actual API, preview proxy and execution-client boundaries.
// Its synthetic worker never starts containers and does not establish Docker capacity.
const worker = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  let result: any = {};
  if (req.url === '/web/open') {
    const id = String(++serial);
    const title = input.project.database ? Buffer.from(input.project.database, 'base64').toString() : '';
    workspaces.set(id, { title });
    result = { id };
  } else if (req.url === '/web/request') {
    const item = workspaces.get(input.id)!;
    if (input.method === 'POST') item.title = new URLSearchParams(input.body).get('title') || '';
    result = {
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: Buffer.from(`<p>${item.title}</p>`).toString('base64'),
    };
  } else if (req.url === '/web/snapshot')
    result = { database: Buffer.from(workspaces.get(input.id)!.title).toString('base64') };
  else if (req.url === '/web/close') workspaces.delete(input.id);
  else if (req.url?.startsWith('/terminal/')) {
    if (req.url === '/terminal/open') {
      const id = String(++serial).padStart(36, '0');
      result = { id, status: 'running', output: '', error: '', inputClosed: false };
      terminalRuns.set(id, result);
    } else {
      result = terminalRuns.get(input.id);
      if (req.url === '/terminal/write') {
        result.output += input.input.line + '\n';
        result.status = 'finished';
      }
      if (req.url === '/terminal/stop') result.status = 'stopped';
    }
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(result));
});
process.env.NODE_ENV = 'test';
process.env.DATA_FILE = ':memory:';
process.env.DEMO_MODE = '0';
process.env.INSTRUCTOR_PASSWORD = 'mixed-load-fixture-password';
process.env.PUBLIC_ORIGIN = '';
if (!real) {
  await new Promise<void>((resolve) => worker.listen(0, '127.0.0.1', resolve));
  process.env.EXECUTION_ORIGIN = `http://127.0.0.1:${(worker.address() as any).port}`;
  process.env.EXECUTION_SECRET = 'fictional-mixed-load-secret-32-characters';
} else {
  process.env.EXECUTION_ORIGIN = '';
}
// Reserve a preview address before configuration is read; never use a classroom port.
const reservation = createServer();
await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const previewPort = (reservation.address() as any).port;
await new Promise<void>((resolve) => reservation.close(() => resolve()));
process.env.PREVIEW_ORIGIN = `http://127.0.0.1:${previewPort}`;
const { server, store, webPreviews, stopApplication } = await import('../src/server.mjs');
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
await new Promise<void>((resolve) => webPreviews!.server.listen(previewPort, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const timings: number[] = [];
async function call(path: string, token?: string, data?: unknown, method?: string) {
  const began = performance.now();
  const response = await fetch(base + path, {
    method: method || (data === undefined ? 'GET' : 'POST'),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(40000),
  });
  const result = await response.json();
  timings.push(performance.now() - began);
  assert.ok(response.ok, `${path}: ${result.code}`);
  return result.data;
}
try {
  const source = {
    filename: 'mixed.md',
    content:
      'Read a line of text from standard input and print it. Test with different input, including short words, numbers and spaces, and print the received line without alteration.',
  };
  const generated = buildGeneratedPackage(
    { title: 'Mixed load', subject: 'Python', kind: 'quiz', durationMinutes: 30, missionCount: 1, source },
    {
      missions: [
        {
          title: 'Programming',
          activities: [
            {
              type: 'code_writing',
              language: 'python',
              prompt: 'Read and print a line.',
              starterCode: '# TODO',
              samples: [{ input: 'hello', output: 'hello' }],
              referenceCode: 'print(input())',
              tests: [
                { input: 'hello', output: 'hello' },
                { input: 'world', output: 'world' },
              ],
              comparison: { mode: 'whitespace' },
              evidenceQuote: 'Read a line of text from standard input and print it.',
              location: 'Source',
            },
          ],
        },
      ],
    },
  );
  const template = webTemplate('mixed-web');
  const web = template.public.missions[0].activities[0];
  web.publicConfig.files['index.php'] =
    `<?php $db=new PDO('sqlite:/tmp/data/database.sqlite');if($_SERVER['REQUEST_METHOD']==='POST'){$q=$db->prepare('INSERT INTO tasks(title) VALUES(?)');$q->execute([$_POST['title']??'']);}foreach($db->query('SELECT title FROM tasks') as $row)echo '<p>'.htmlspecialchars($row['title'],ENT_QUOTES,'UTF-8').'</p>';`;
  generated.public.missions[0].activities.push(web);
  generated.public.missions[0].maxPoints += 100;
  generated.public.settings.coreMaxPoints += 100;
  generated.private.rules['php-rubric'] = {
    type: 'web_project',
    criteria: [
      { id: 'mixed-manual', points: 100, answer: { kind: 'manual', description: 'Review project.' } },
    ],
  };
  store.importDraft(generated.public, generated.private);
  store.addSource(generated.public.examId, 1, source);
  store.publish(generated.public.examId, 1);
  const run = store.createRun({
    examId: generated.public.examId,
    version: 1,
    pin: '4242',
    feedbackMode: 'graded',
    opensAt: new Date(Date.now() - 1000).toISOString(),
    closesAt: new Date(Date.now() + 3600000).toISOString(),
    roster: Array.from({ length: count }, (_, i) => ({
      candidateId: `MIX-${i}`,
      displayName: `Synthetic ${i}`,
      section: 'Load',
    })),
  });
  const students = Array.from({ length: count }, (_, i) => i);
  const started = performance.now();
  // Eight workflows at once match the default terminal limit. Full preview-capacity
  // replacement is covered separately by the 80-slot regression.
  await Promise.all(
    Array.from({ length: Math.min(8, count) }, async () => {
      while (students.length) {
        const i = students.shift()!;
        const credentials = { runId: run.id, candidateId: `MIX-${i}`, pin: '4242' };
        await call('/api/auth/student/preview', undefined, credentials);
        const joined = await call('/api/auth/student/join', undefined, credentials),
          token = joined.token;
        await call('/api/me/missions/mission-1', token);
        for (let revision = 0; revision < 3; revision++)
          await call(
            '/api/me/activities/m1-q1/draft',
            token,
            { value: `# revision ${revision}\nprint(input())` },
            'PUT',
          );
        const terminal = await call('/api/me/activities/m1-q1/terminal', token, { value: 'print(input())' });
        await call(`/api/me/activities/m1-q1/terminal/${terminal.id}`, token, { line: `hello-${i}` });
        let terminalState;
        const until = Date.now() + 30000;
        do {
          assert.ok(Date.now() < until, 'Terminal did not finish');
          terminalState = await call(`/api/me/activities/m1-q1/terminal/${terminal.id}`, token);
          if (terminalState.status === 'running') await new Promise((resolve) => setTimeout(resolve, 100));
        } while (terminalState.status === 'running');
        assert.equal(terminalState.status, 'finished');
        assert.match(terminalState.output, new RegExp(`hello-${i}`));
        const project = { value: { files: web.publicConfig.files } };
        await call('/api/me/activities/php-app/draft', token, project, 'PUT');
        let preview = await call('/api/me/activities/php-app/web-preview', token, project);
        const title = `saved-record-${i}`;
        const posted = await fetch(preview.url, { method: 'POST', body: `title=${title}` });
        assert.equal(posted.status, 200);
        assert.match(await posted.text(), new RegExp(title));
        const snapshot = await call('/api/me/activities/php-app/web-preview', token);
        assert.ok(snapshot.database);
        preview = await call('/api/me/activities/php-app/web-preview', token, project);
        const reopened = await fetch(preview.url);
        assert.match(await reopened.text(), new RegExp(title));
        await call('/api/me/activities/php-app/draft', token, project, 'PUT');
        const resumed = await call('/api/auth/student/join', undefined, credentials);
        assert.equal(resumed.session.id, joined.session.id);
        await call('/api/me/finalize', resumed.token, {});
        assert.equal(store.hasPendingReview(joined.session.id), true);
        const deadline = Date.now() + 30000;
        while (store.hasPendingCode(joined.session.id)) {
          assert.ok(Date.now() < deadline, 'Finalization queue did not drain');
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.equal(
          store.results(run.id).rows.find((row) => row.sessionId === joined.session.id)?.resultsReleased,
          false,
        );
        // Finishing removes runtime resources but keeps its durable checkpoint.
        await webPreviews!.sweep();
      }
    }),
  );
  timings.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        mode: real ? 'REAL Docker mixed workflow' : 'SIMULATED execution worker; not Docker capacity',
        students: count,
        concurrentWorkflows: Math.min(8, count),
        requests: timings.length,
        durationSeconds: +((performance.now() - started) / 1000).toFixed(2),
        requestP95Ms: +timings[Math.floor(timings.length * 0.95)].toFixed(2),
        verifiedDraftsTerminalsPreviewRecoveryAndManualReview: count,
        previews: webPreviews!.stats(),
        queue: store.codingQueue.stats(),
      },
      null,
      2,
    ),
  );
} finally {
  await stopApplication();
  if (worker.listening) await new Promise<void>((resolve) => worker.close(() => resolve()));
}
