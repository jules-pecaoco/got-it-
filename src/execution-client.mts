import { codingStatus, executeCode } from './code-runner.mjs';

export function executionStatus(webPreviewConfigured: boolean) {
  const origin = process.env.EXECUTION_ORIGIN;
  const secret = process.env.EXECUTION_SECRET;
  async function probe() {
    if (!origin) return { ...(await codingStatus()), worker: 'local', webPreviewConfigured };
    try {
      const response = await fetch(new URL('/status', origin), {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(7000),
      });
      if (response.ok) {
        const result = (await response.json()) as Awaited<ReturnType<typeof codingStatus>>;
        if (
          Array.isArray(result.languages) &&
          typeof result.message === 'string' &&
          typeof result.docker === 'string'
        )
          return {
            available: result.available === true,
            docker: result.docker,
            languages: result.languages,
            message: result.message,
            worker: 'ready',
            webPreviewConfigured,
          };
      }
      const message =
        response.status === 404
          ? 'The execution worker needs an update or restart to report Docker status.'
          : response.status === 401
            ? 'The execution worker rejected the configured credentials.'
            : 'The execution worker could not report Docker status.';
      return {
        available: false,
        languages: [],
        docker: 'unknown',
        worker: 'unverified',
        webPreviewConfigured,
        message,
      };
    } catch {
      return {
        available: false,
        languages: [],
        docker: 'unknown',
        worker: 'unreachable',
        webPreviewConfigured,
        message: 'The execution worker is unreachable. Check that it is running.',
      };
    }
  }
  let pending: ReturnType<typeof probe> | undefined;
  let expires = 0;
  return () => {
    if (!pending || Date.now() >= expires) {
      expires = Infinity;
      pending = probe().finally(() => {
        expires = Date.now() + 10000;
      });
    }
    return pending;
  };
}

export function executionRunner() {
  const origin = process.env.EXECUTION_ORIGIN;
  if (!origin) return executeCode;
  const url = new URL('/execute', origin);
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname))
    throw new Error('Remote execution requires HTTPS.');
  const secret = process.env.EXECUTION_SECRET;
  if (!secret || secret.length < 32) throw new Error('EXECUTION_SECRET needs at least 32 characters.');
  return async (language: string, code: string, input: string) => {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ language, code, input }),
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw Object.assign(new Error('Execution worker unavailable. Retry shortly.'), {
        code: 'CODE_RUNNER_UNAVAILABLE',
        status: 503,
      });
    }
    if (!response.ok) {
      const issue = await response.json().catch(() => null);
      const code = issue?.code;
      if (['CODE_RUNNER_UNAVAILABLE', 'CODE_RUNNER_BUSY'].includes(code) && typeof issue.message === 'string')
        throw Object.assign(new Error(issue.message), { code, status: response.status });
      throw Object.assign(new Error('Execution worker unavailable. Retry shortly.'), {
        code: 'CODE_RUNNER_UNAVAILABLE',
        status: 503,
      });
    }
    const result = (await response.json()) as { output: string; error: string; succeeded: boolean };
    if (
      typeof result.output !== 'string' ||
      typeof result.error !== 'string' ||
      typeof result.succeeded !== 'boolean'
    )
      throw new Error('Invalid execution worker response.');
    return result;
  };
}
