import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { PhpWorkspace } from './php-workspace.mts';
import { createWorkspace } from './workspace-client.mts';
import type { Project } from '../web/contracts.js';

interface Preview {
  workspace: ReturnType<typeof createWorkspace>;
  sessionId: string;
  activityId: string;
  expires: number;
  busy: Promise<unknown>;
}
export function createPreviewService(
  origin: string,
  allowed: (sessionId: string) => boolean,
  parentOrigin = '*',
) {
  const previews = new Map<string, Preview>();
  const opening = new Set<string>();
  const parsed = new URL(origin);
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
    if (!preview || preview.expires < Date.now() || !allowed(preview.sessionId)) {
      res.writeHead(404);
      res.end('Preview ended. Open a new preview from the assessment.');
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
      const path = match![2] || '/';
      // Serialize requests and snapshots so SQLite snapshots never race PHP writes.
      let result;
      const work = preview.busy.then(async () => {
        result = await preview.workspace.request(
          req.method || 'GET',
          path,
          Buffer.concat(chunks).toString('utf8'),
          req.headers.cookie || '',
        );
      });
      preview.busy = work.catch(() => {});
      await work;
      const response = result as unknown as Awaited<ReturnType<PhpWorkspace['request']>>;
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
    } catch {
      previews.delete(match![1]);
      await preview.workspace.close();
      res.writeHead(503);
      res.end('Preview interrupted. Save your project and reopen the preview.');
    }
  });
  const timer = setInterval(() => {
    for (const [token, preview] of previews)
      if (preview.expires < Date.now() || !allowed(preview.sessionId)) {
        previews.delete(token);
        void preview.workspace.close();
      }
  }, 30000);
  timer.unref();
  return {
    server,
    async open(sessionId: string, activityId: string, project: Project, seedSql = '', reset = false) {
      const key = `${sessionId}:${activityId}`;
      if (opening.has(key) || previews.size + opening.size >= 80)
        throw Object.assign(new Error('Preview busy. Retry shortly.'), { status: 503, code: 'WEB_CAPACITY' });
      opening.add(key);
      try {
        const existing = [...previews.entries()].find(
          ([, item]) => item.sessionId === sessionId && item.activityId === activityId,
        );
        if (existing) {
          previews.delete(existing[0]);
          await existing[1].busy;
          if (!reset) project = { ...project, database: await existing[1].workspace.snapshot() };
          await existing[1].workspace.close();
        }
        if (previews.size >= 80)
          throw Object.assign(new Error('All preview environments are busy. Retry shortly.'), {
            status: 503,
            code: 'WEB_CAPACITY',
          });
        if (reset) project = { files: project.files };
        const workspace = createWorkspace();
        await workspace.start(project, seedSql);
        const token = randomBytes(24).toString('hex');
        previews.set(token, {
          workspace,
          sessionId,
          activityId,
          expires: Date.now() + 10 * 60000,
          busy: Promise.resolve(),
        });
        return { url: `${parsed.origin}/p/${token}/`, database: await workspace.snapshot() };
      } finally {
        opening.delete(key);
      }
    },
    async snapshot(sessionId: string, activityId: string) {
      const preview = [...previews.values()].find(
        (item) => item.sessionId === sessionId && item.activityId === activityId,
      );
      if (!preview) return undefined;
      await preview.busy;
      return preview.workspace.snapshot();
    },
    async close() {
      clearInterval(timer);
      await Promise.all([...previews.values()].map((item) => item.workspace.close()));
      previews.clear();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
