import { PhpWorkspace } from './php-workspace.mts';
import type { WebResponse } from './php-workspace.mts';
import type { Project } from '../web/contracts.js';

class RemoteWorkspace {
  private id = '';
  private async call(path: string, data: unknown) {
    const origin = process.env.EXECUTION_ORIGIN!;
    const url = new URL(path, origin);
    if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname))
      throw new Error('Remote execution requires HTTPS.');
    const secret = process.env.EXECUTION_SECRET;
    if (!secret || secret.length < 32) throw new Error('Set EXECUTION_SECRET to at least 32 characters.');
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw Object.assign(new Error('Web execution worker unavailable. Retry shortly.'), {
        code: 'WEB_RUNTIME_UNAVAILABLE',
        status: 503,
      });
    return response.json();
  }
  async start(project: Project, seedSql = '') {
    const result = await this.call('/web/open', { project, seedSql });
    this.id = result.id;
  }
  async request(method: string, path: string, body = '', cookie = ''): Promise<WebResponse> {
    const result = await this.call('/web/request', { id: this.id, method, path, body, cookie });
    return { status: result.status, headers: result.headers, body: Buffer.from(result.body, 'base64') };
  }
  async snapshot(): Promise<string> {
    return (await this.call('/web/snapshot', { id: this.id })).database;
  }
  async close() {
    if (this.id) {
      const id = this.id;
      this.id = '';
      await this.call('/web/close', { id }).catch(() => {});
    }
  }
}
export function createWorkspace() {
  return process.env.EXECUTION_ORIGIN ? new RemoteWorkspace() : new PhpWorkspace();
}
