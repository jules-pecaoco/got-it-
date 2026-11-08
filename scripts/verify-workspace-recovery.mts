import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PhpWorkspace } from '../src/php-workspace.mts';

// The child deliberately exits without closing its one disposable workspace.
// PID 1 must remove that container on its own deadline, independently of Node.
const childCode = `import { PhpWorkspace } from './src/php-workspace.mts';
const workspace = new PhpWorkspace(3);
await workspace.start({ files: { 'index.php': '<?php echo 1;' } });
console.log(workspace.name);
process.exit(0);`;
const child = spawnSync(
  process.execPath,
  ['--import', './src/runtime-temp.mjs', '--import', 'tsx', '--input-type=module', '-e', childCode],
  { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 20000 },
);
assert.equal(child.status, 0, child.stderr);
const name = child.stdout.trim();
assert.match(name, /^gotit-web-[a-f0-9-]{36}$/);
try {
  let removed = false;
  const deadline = Date.now() + 10000;
  do {
    const result = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', name], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    });
    if (result.status !== 0) {
      removed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  assert.equal(removed, true, 'The orphaned audit workspace exceeded its independent lifetime.');
  console.log('PASS: workspace expired and was removed after its Node owner exited.');
} finally {
  spawnSync('docker', ['rm', '--force', name], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
}

// Normal cleanup remains immediate, rather than waiting for that safety deadline.
const normal = new PhpWorkspace();
try {
  await normal.start({ files: { 'index.php': '<?php echo 1;' } });
} finally {
  await normal.close();
}
const result = spawnSync('docker', ['inspect', normal.name], {
  encoding: 'utf8',
  windowsHide: true,
  timeout: 3000,
});
assert.notEqual(result.status, 0);
console.log('PASS: normal workspace close removed its exact container immediately.');

const expired = new PhpWorkspace(2);
try {
  await expired.start({ files: { 'index.php': '<?php echo 1;' } });
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await assert.rejects(expired.snapshot(), (error: any) => error.code === 'WEB_WORKSPACE_ENDED');
  console.log('PASS: an expired local workspace reports ended rather than a Docker outage.');
} finally {
  await expired.close();
}
