import { spawnSync } from 'node:child_process';
import { runtimeImages } from '../src/code-runner.mjs';
for (const image of new Set(Object.values(runtimeImages))) {
  const result = spawnSync('docker', ['pull', image], { stdio: 'inherit', windowsHide: true, shell: false });
  if (result.error || result.status !== 0) {
    console.error('Start Docker with Linux containers, then run npm run setup:coding again.');
    process.exit(1);
  }
}
console.log('PHP, Python, SQL (SQLite), and JavaScript coding runtimes installed.');
