import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createWorkspace } from './workspace-client.mts';
import { WorkspaceQueue } from './workspace-queue.mts';
import type { PhpWorkspace } from './php-workspace.mts';
import type { Project } from '../web/contracts.js';

type Workspace = Pick<PhpWorkspace, 'start' | 'request' | 'snapshot' | 'close'>;
interface Checkpoints {
  load(sessionId: string, activityId: string): string | undefined;
  save(sessionId: string, activityId: string, database: string, changedAt?: string): void;
  clear(sessionId: string, activityId: string): void;
}
interface Preview {
  workspace: Workspace;
  sessionId: string;
  activityId: string;
  expires: number;
  queue: WorkspaceQueue;
  lastRequestAt?: string;
}
interface Options {
  checkpoints?: Checkpoints;
  workspaceFactory?: () => Workspace;
  capacity?: number;
  lifetimeMs?: number;
  now?: () => number;
}
const busy = () =>
  Object.assign(new Error('Preview busy. Retry shortly.'), { status: 503, code: 'WEB_CAPACITY' });
export function createPreviewService(
  origin: string,
  allowed: (sessionId: string) => boolean,
  parentOrigin = '*',
  finished = (sessionId: string) => !allowed(sessionId),
  options: Options = {},
) {
  const previews = new Map<string, Preview>();
  const opening = new Map<string, Promise<unknown>>();
  const memory = new Map<string, string>();
  const checkpoints: Checkpoints = options.checkpoints ?? {
    load: (session, activity) => memory.get(`${session}:${activity}`),
    save: (session, activity, database) => {
      memory.set(`${session}:${activity}`, database);
      if (memory.size > 160) memory.delete(memory.keys().next().value!);
    },
    clear: (session, activity) => {
      memory.delete(`${session}:${activity}`);
    },
  };
  const factory = options.workspaceFactory ?? createWorkspace;
  const capacity = options.capacity ?? 80;
  const lifetime = options.lifetimeMs ?? 10 * 60000;
  const now = options.now ?? Date.now;
  const parsed = new URL(origin);
  let closed = false,
    closing: Promise<void> | undefined;
  function lock<T>(key: string, action: () => Promise<T>): Promise<T> {
    if (closed || opening.has(key)) return Promise.reject(busy());
    const work = Promise.resolve()
      .then(action)
      .finally(() => opening.delete(key));
    opening.set(key, work);
    return work;
  }
  async function snapshot(preview: Preview) {
    return preview.queue.run(async () => {
      const database = await preview.workspace.snapshot();
      checkpoints.save(preview.sessionId, preview.activityId, database, preview.lastRequestAt);
      return database;
    }, true);
  }
  const server = createServer(async (req, res) => {
    const match = /^\/p\/([a-f0-9]{48})(\/.*)?$/.exec(req.url ?? '');
    const preview = match ? previews.get(match[1]) : undefined;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'",
    );
    if (closed || !preview || preview.expires < now() || !allowed(preview.sessionId)) {
      res.writeHead(404);
      res.end('This preview has ended. Return to your answer and select Run web preview to open a new one.');
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 100000) throw new Error('Request too large.');
        chunks.push(chunk);
      }
      if (closed || !allowed(preview.sessionId) || opening.has(`${preview.sessionId}:${preview.activityId}`))
        throw busy();
      const path = match![2] || '/';
      const response = await preview.queue.run(async () => {
        // A request may have waited behind another PHP operation until the
        // deadline. Recheck immediately before starting student code.
        if (closed || !allowed(preview.sessionId) || preview.expires < now()) throw busy();
        preview.lastRequestAt = new Date(now()).toISOString();
        const result = await preview.workspace.request(
          req.method || 'GET',
          path,
          Buffer.concat(chunks).toString('utf8'),
          req.headers.cookie || '',
        );
        if (req.method === 'POST') {
          const database = await preview.workspace.snapshot();
          checkpoints.save(preview.sessionId, preview.activityId, database, preview.lastRequestAt);
        }
        return result;
      });
      const prefix = `/p/${match![1]}`;
      const location = response.headers.location;
      if (typeof location === 'string') {
        if (location.startsWith('/') && !location.startsWith('//'))
          response.headers.location = prefix + location;
        else if (/^[a-z]+:|^\/\//i.test(location)) delete response.headers.location;
      }
      const cookies = response.headers['set-cookie'];
      if (Array.isArray(cookies))
        response.headers['set-cookie'] = cookies.map(
          (cookie) =>
            cookie.replace(/;\s*(?:Path|Domain)=[^;]*/gi, '') +
            `; Path=${prefix}/; HttpOnly; SameSite=Strict`,
        );
      const consoleScript = `<script>(()=>{const send=(...args)=>{try{parent.postMessage({type:'gotit-preview-console',text:args.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' ').slice(0,2000)},${JSON.stringify(parentOrigin)});}catch{}};for(const name of ['log','warn','error']){const original=console[name];console[name]=(...args)=>{send(name+':',...args);original.apply(console,args);};}addEventListener('error',event=>send('error:',event.message));addEventListener('unhandledrejection',event=>send('error:',String(event.reason)));})();</script>`;
      const html = String(response.headers['content-type'] || '').includes('text/html');
      let body: string | Buffer = response.body;
      if (html) {
        const document = response.body.toString('utf8');
        body = /<head[^>]*>/i.test(document)
          ? document.replace(/<head[^>]*>/i, (head) => head + consoleScript)
          : /<!doctype[^>]*>/i.test(document)
            ? document.replace(/<!doctype[^>]*>/i, (doctype) => doctype + consoleScript)
            : consoleScript + document;
      }
      res.writeHead(response.status, response.headers);
      res.end(body);
    } catch (error) {
      res.writeHead((error as { status?: number }).status || 503);
      res.end(
        'Your project preview is busy or stopped. Retry, or open a new preview. If it still does not work, tell your instructor.',
      );
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.setTimeout(30000);
  async function sweep() {
    await Promise.allSettled(
      [...previews.entries()].map(async ([token, preview]) => {
        const key = `${preview.sessionId}:${preview.activityId}`;
        if (opening.has(key) || (!finished(preview.sessionId) && preview.expires >= now())) return;
        await lock(key, async () => {
          if (!finished(preview.sessionId)) await snapshot(preview);
          await preview.queue.close();
          await preview.workspace.close();
          previews.delete(token);
        });
      }),
    );
  }
  const timer = setInterval(() => {
    void sweep();
  }, 30000);
  timer.unref();
  return {
    server,
    sweep,
    stats: () => ({
      active: previews.size,
      opening: opening.size,
      capacity,
      queued: [...previews.values()].reduce((n, preview) => n + preview.queue.stats().queued, 0),
    }),
    async open(sessionId: string, activityId: string, project: Project, seedSql = '', reset = false) {
      const key = `${sessionId}:${activityId}`;
      const resetAt = reset ? new Date(now()).toISOString() : undefined;
      return lock(key, async () => {
        const existing = [...previews.entries()].find(
          ([, item]) => item.sessionId === sessionId && item.activityId === activityId,
        );
        // Every opening holds a reservation, including replacements that release an old slot.
        if (!existing && previews.size + opening.size - 1 >= capacity) throw busy();
        let warning: string | undefined;
        if (!reset) {
          const saved = checkpoints.load(sessionId, activityId);
          if (saved !== undefined) project = { ...project, database: saved };
          if (existing) {
            try {
              project = { ...project, database: await snapshot(existing[1]) };
            } catch (error) {
              if ((error as { code?: string }).code !== 'WEB_WORKSPACE_ENDED') throw error;
              warning =
                'The previous preview ended. Reopened from the last saved database. Newer changes may be missing.';
            }
          }
        } else project = { files: project.files };
        // Persist before releasing the old slot. On failed replacement this remains recoverable.
        if (existing) {
          if (!reset && project.database !== undefined)
            checkpoints.save(sessionId, activityId, project.database);
          await existing[1].queue.close();
          await existing[1].workspace.close();
          previews.delete(existing[0]);
        }
        const workspace = factory();
        try {
          await workspace.start(project, seedSql);
          const database = await workspace.snapshot();
          checkpoints.save(sessionId, activityId, database, resetAt);
          const token = randomBytes(24).toString('hex');
          previews.set(token, {
            workspace,
            sessionId,
            activityId,
            expires: now() + lifetime,
            queue: new WorkspaceQueue(),
          });
          return { url: `${parsed.origin}/p/${token}/`, database, warning };
        } catch (error) {
          await workspace.close();
          throw error;
        }
      });
    },
    async discard(sessionId: string, activityId: string) {
      return lock(`${sessionId}:${activityId}`, async () => {
        const existing = [...previews.entries()].find(
          ([, item]) => item.sessionId === sessionId && item.activityId === activityId,
        );
        if (existing) {
          await existing[1].queue.close();
          await existing[1].workspace.close();
          previews.delete(existing[0]);
        }
        checkpoints.clear(sessionId, activityId);
      });
    },
    async snapshot(sessionId: string, activityId: string) {
      const pending = opening.get(`${sessionId}:${activityId}`);
      if (pending) await pending;
      const preview = [...previews.values()].find(
        (item) => item.sessionId === sessionId && item.activityId === activityId,
      );
      return preview ? snapshot(preview) : checkpoints.load(sessionId, activityId);
    },
    close() {
      closing ??= (async () => {
        closed = true;
        clearInterval(timer);
        await Promise.allSettled([...opening.values()]);
        await Promise.allSettled(
          [...previews.values()].map(async (preview) => {
            try {
              await snapshot(preview);
            } finally {
              await preview.queue.close();
              await preview.workspace.close();
            }
          }),
        );
        previews.clear();
        memory.clear();
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      })();
      return closing;
    },
  };
}
