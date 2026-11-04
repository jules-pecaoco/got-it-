import { spawn } from 'node:child_process';
import { statfsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { parse, join } from 'node:path';
import os from 'node:os';
import { loadConfig } from '../src/config.mjs';

const { root, dataFile } = loadConfig();
for (const drive of new Set([parse(os.tmpdir()).root, parse(root).root, parse(dataFile).root])) {
  if (!drive) continue;
  const disk = statfsSync(drive);
  if (disk.bavail * disk.bsize < 10 * 2**30) throw new Error(`Free at least 10 GB on ${drive} before internet preview. No tunnel was started.`);
}
const prepare = spawn(process.execPath, [join(root, 'scripts/prepare-local.mjs')], { cwd: root, windowsHide: true, stdio: 'inherit' });
let tunnel, app, started = false, stopping = false;
function stop() { stopping = true; app?.kill(); tunnel?.kill(); }
prepare.on('exit', code => {
  if (code !== 0 || stopping) { process.exitCode = code || 1; return; }
  // cloudflared must already be installed. This command does not create an
  // account, buy a domain, or install a persistent service.
  tunnel = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${process.env.PORT || 3000}`], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffer = '';
  const timeout = setTimeout(() => { console.error('Tunnel startup timed out.'); stop(); process.exitCode = 1; }, 60000);
  const receive = chunk => {
    buffer = (buffer + chunk.toString()).slice(-16000);
    const url = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
    if (!url || started || stopping) return;
    started = true; clearTimeout(timeout);
    console.log(`Temporary preview address: ${url}\nThe address changes when this preview restarts. Use a named tunnel for regular classes.`);
    const prepared = parseEnv(readFileSync(join(root, '.env'), 'utf8'));
    app = spawn(process.execPath, [join(root, 'scripts/serve-local.mjs')], { cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, INSTRUCTOR_PASSWORD: prepared.INSTRUCTOR_PASSWORD || process.env.INSTRUCTOR_PASSWORD, PUBLIC_ORIGIN: url, DEMO_MODE: '0', HOST: '127.0.0.1' } });
    app.on('exit', code => { process.exitCode = code || 0; stop(); });
  };
  tunnel.stdout.on('data', receive); tunnel.stderr.on('data', receive);
  tunnel.on('error', error => { clearTimeout(timeout); console.error(`Cannot start cloudflared: ${error.message}`); stop(); process.exitCode = 1; });
  tunnel.on('exit', () => { clearTimeout(timeout); if (!stopping) { console.error('Tunnel ended; stopping the application.'); process.exitCode = 1; stop(); } });
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
