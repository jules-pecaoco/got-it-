import { TerminalManager, type TerminalState } from './terminal.mts';
export function terminalService() {
  const origin = process.env.EXECUTION_ORIGIN;
  if (!origin) return new TerminalManager();
  const url = new URL(origin);
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname))
    throw new Error('Remote execution requires HTTPS.');
  const secret = process.env.EXECUTION_SECRET;
  if (!secret || secret.length < 32) throw new Error('EXECUTION_SECRET needs at least 32 characters.');
  const opened = new Map<string, string>();
  async function call(action: string, body: object): Promise<TerminalState> {
    let response;
    try {
      response = await fetch(new URL('/terminal/' + action, url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw Object.assign(new Error('The execution host is unavailable.'), {
        code: 'TERMINAL_UNAVAILABLE',
        status: 503,
      });
    }
    const result = await response.json();
    if (action === 'open' && response.status === 404)
      throw Object.assign(new Error('The execution worker needs a restart to enable live terminal runs.'), {
        code: 'TERMINAL_UPDATE_REQUIRED',
        status: 503,
      });
    if (!response.ok)
      throw Object.assign(new Error(result.message || 'The terminal request could not be completed.'), {
        code: result.code || 'TERMINAL_UNAVAILABLE',
        status: response.status,
      });
    if (
      typeof result.id !== 'string' ||
      typeof result.output !== 'string' ||
      typeof result.error !== 'string' ||
      !['starting', 'running', 'finished', 'stopped', 'failed'].includes(result.status) ||
      typeof result.inputClosed !== 'boolean'
    )
      throw new Error('Invalid terminal response.');
    return result;
  }
  return {
    async open(owner: string, language: string, code: string) {
      const result = await call('open', { owner, language, code });
      opened.set(result.id, owner);
      return result;
    },
    async read(owner: string, id: string) {
      const result = await call('read', { owner, id });
      if (!['starting', 'running'].includes(result.status)) opened.delete(id);
      return result;
    },
    write: (owner: string, id: string, input: { line?: string; eof?: boolean }) =>
      call('write', { owner, id, input }),
    async stop(owner: string, id: string) {
      const result = await call('stop', { owner, id });
      opened.delete(id);
      return result;
    },
    async close() {
      await Promise.allSettled([...opened].map(([id, owner]) => call('stop', { owner, id })));
      opened.clear();
    },
  };
}
