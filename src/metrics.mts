import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
const delay = monitorEventLoopDelay({ resolution: 20 });
delay.enable();
const requests = new Map<string, { count: number; failures: number; samples: number[] }>();
export function measureRequest(req: IncomingMessage, res: ServerResponse) {
  const started = performance.now();
  const path = (req.url?.split('?')[0] || '/').replace(
    /(students|activities|missions|coding-jobs|runs|classes|assessments|exams)\/[^/]+/g,
    '$1/:id',
  );
  const key = path.startsWith('/api/') && path.length < 180 ? `${req.method} ${path}` : 'static';
  res.once('finish', () => {
    if (!requests.has(key) && requests.size >= 64) return;
    const row = requests.get(key) || { count: 0, failures: 0, samples: [] };
    row.count++;
    if (res.statusCode >= 500) row.failures++;
    row.samples.push(performance.now() - started);
    if (row.samples.length > 256) row.samples.shift();
    requests.set(key, row);
  });
}
export function metricsSnapshot() {
  return {
    eventLoopP95Ms: Number((delay.percentile(95) / 1e6).toFixed(2)),
    requests: [...requests].map(([route, row]) => {
      const samples = [...row.samples].sort((a, b) => a - b);
      return {
        route,
        count: row.count,
        serverErrors: row.failures,
        recentP95Ms: Number(samples[Math.floor(samples.length * 0.95)]?.toFixed(2) || 0),
      };
    }),
  };
}
