import { executeCode } from './code-runner.mjs';

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
    if (!response.ok)
      throw Object.assign(new Error('Execution worker unavailable. Retry shortly.'), {
        code: 'CODE_RUNNER_UNAVAILABLE',
        status: 503,
      });
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
