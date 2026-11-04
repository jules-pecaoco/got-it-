import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { loadConfig } from '../src/config.mjs';

const { root } = loadConfig();
let child, backupTimer, backupRunning = false, stopping = false, failures = 0;
function run(script, inherit = true) {
  return spawn(process.execPath, ['--experimental-sqlite', join(root, script)], { cwd: root, windowsHide: true, stdio: inherit ? 'inherit' : 'ignore', env: { ...process.env, NODE_ENV: 'production' } });
}
const preflight = run('scripts/preflight.mjs');
preflight.on('exit', code => {
  if (code !== 0) { process.exitCode = code || 1; return; }
  const backup = run('scripts/backup.mjs');
  backup.on('exit', result => {
    if (result !== 0) { process.exitCode = result || 1; return; }
    start();
    backupTimer = setInterval(() => {
      if (backupRunning || stopping) return;
      backupRunning = true;
      const task = run('scripts/backup.mjs');
      task.on('exit', code => { backupRunning = false; if (code) console.error('Scheduled backup failed; inspect the backup error.'); });
    }, 60 * 60 * 1000);
    backupTimer.unref();
  });
});
function start() {
  if (stopping) return;
  const began = Date.now();
  child = run('src/server.mjs');
  child.on('exit', code => {
    if (stopping || code === 0) return;
    failures = Date.now() - began > 60000 ? 1 : failures + 1;
    if (failures > 5) { console.error('Server repeatedly failed. Resolve the logged error before restarting.'); process.exitCode = 1; return; }
    console.error(`Server interrupted; restarting in ${failures * 2} seconds.`);
    setTimeout(start, failures * 2000);
  });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; clearInterval(backupTimer); child?.kill(); });
