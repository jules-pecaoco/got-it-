import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
let failed = false;
function checkDirectory(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (item.isDirectory()) { if (item.name !== 'vendor') checkDirectory(join(directory, item.name)); continue; }
    const file = item.name;
    if (!/\.(mjs|js)$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', join(directory, file)], { windowsHide: true, encoding: 'utf8' });
    if (result.status) { failed = true; console.error(result.stderr); }
  }
}
for (const directory of ['src', 'public', 'scripts', 'tests']) checkDirectory(directory);
if (failed) process.exitCode = 1;
else console.log('JavaScript syntax checks passed.');
