import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { codingStatus, executeCode, startCodeReconciliation } from './code-runner.mjs';
import { PhpWorkspace } from './php-workspace.mts';
import { randomUUID } from 'node:crypto';
import type { Project } from '../web/contracts.js';
import { TerminalManager } from './terminal.mts';

const secret = process.env.EXECUTION_SECRET;
if (!secret || secret.length < 32) throw new Error('Set EXECUTION_SECRET to at least 32 characters.');
const app = Fastify({ bodyLimit: 1700000, logger: false });
app.addHook('onRequest', async (request, reply) => {
  const supplied = Buffer.from(request.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    return reply.code(401).send({ error: 'Unauthorized' });
});
app.get('/status', () => codingStatus());
let active = 0;
const terminals = new TerminalManager();
const codeCleanup = startCodeReconciliation();
app.post<{
  Params: { action: string };
  Body: {
    owner: string;
    id: string;
    language: string;
    code: string;
    input: { line?: string; eof?: boolean };
  };
}>('/terminal/:action', async (request, reply) => {
  const { owner, id, language, code, input } = request.body || {};
  if (typeof owner !== 'string' || !owner || owner.length > 128)
    return reply.code(400).send({ code: 'INVALID_OWNER', message: 'Invalid terminal owner.' });
  try {
    switch (request.params.action) {
      case 'open':
        return await terminals.open(owner, language, code);
      case 'read':
        return terminals.read(owner, id);
      case 'write':
        return terminals.write(owner, id, input);
      case 'stop':
        return await terminals.stop(owner, id);
      default:
        return reply.code(404).send({ message: 'Not found.' });
    }
  } catch (error) {
    const issue = error as Error & { status?: number; code?: string };
    return reply
      .code(issue.status || 503)
      .send({ code: issue.code || 'TERMINAL_UNAVAILABLE', message: issue.message });
  }
});
app.post<{ Body: { language: string; code: string; input: string } }>(
  '/execute',
  {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['language', 'code', 'input'],
        properties: {
          language: { type: 'string', enum: ['php', 'python', 'sql', 'javascript'] },
          code: { type: 'string', minLength: 1, maxLength: 16000 },
          input: { type: 'string', maxLength: 16000 },
        },
      },
    },
  },
  async (request, reply) => {
    if (active >= 2)
      return reply
        .code(429)
        .send({ code: 'CODE_RUNNER_BUSY', message: 'The code runner is busy. Try again shortly.' });
    active++;
    try {
      return await executeCode(request.body.language, request.body.code, request.body.input);
    } catch (error) {
      const issue = error as Error & { code?: string; status?: number };
      if (issue.code === 'CODE_RUNNER_UNAVAILABLE' || issue.code === 'CODE_RUNNER_BUSY')
        return reply.code(issue.status ?? 503).send({ code: issue.code, message: issue.message });
      throw error;
    } finally {
      active--;
    }
  },
);
const workspaces = new Map<string, { workspace: PhpWorkspace; expires: number }>();
let opening = 0;
app.post<{ Body: { project: Project; seedSql: string } }>('/web/open', async (request, reply) => {
  if (workspaces.size + opening >= 80) return reply.code(503).send({ error: 'Busy' });
  if (typeof request.body.seedSql !== 'string' || request.body.seedSql.length > 16000)
    return reply.code(422).send({ error: 'Invalid seed' });
  opening++;
  const workspace = new PhpWorkspace();
  try {
    await workspace.start(request.body.project, request.body.seedSql);
    const id = randomUUID();
    workspaces.set(id, { workspace, expires: Date.now() + 11 * 60000 });
    return { id };
  } finally {
    opening--;
  }
});
app.post<{ Body: { id: string; method: string; path: string; body: string; cookie: string } }>(
  '/web/request',
  async (request, reply) => {
    const item = workspaces.get(request.body.id);
    if (!item) return reply.code(404).send({ error: 'Ended' });
    const { method, path, body, cookie } = request.body;
    if (
      ![method, path, body, cookie].every((value) => typeof value === 'string') ||
      body.length > 100000 ||
      cookie.length > 16000
    )
      return reply.code(422).send({ error: 'Invalid request' });
    const result = await item.workspace.request(method, path, body, cookie);
    return { ...result, body: result.body.toString('base64') };
  },
);
app.post<{ Body: { id: string } }>('/web/snapshot', async (request, reply) => {
  const item = workspaces.get(request.body.id);
  if (!item) return reply.code(404).send({ error: 'Ended' });
  try {
    return { database: await item.workspace.snapshot() };
  } catch (error) {
    if ((error as { code?: string }).code === 'WEB_WORKSPACE_ENDED')
      return reply.code(404).send({ error: 'Ended' });
    throw error;
  }
});
app.post<{ Body: { id: string } }>('/web/close', async (request) => {
  const item = workspaces.get(request.body.id);
  workspaces.delete(request.body.id);
  await item?.workspace.close();
  return { closed: true };
});
const timer = setInterval(() => {
  for (const [id, item] of workspaces)
    if (item.expires < Date.now()) {
      workspaces.delete(id);
      void item.workspace.close();
    }
}, 30000);
timer.unref();
app.addHook('onClose', async () => {
  await codeCleanup.stop();
  await terminals.close();
  clearInterval(timer);
  await Promise.all([...workspaces.values()].map((item) => item.workspace.close()));
});
await app.listen({
  host: process.env.WORKER_HOST || '127.0.0.1',
  port: Number(process.env.WORKER_PORT || 3101),
});
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    void app.close();
  });
