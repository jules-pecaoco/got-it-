import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { executeCode } from '../src/code-runner.mjs';

const probes = {
  php: '<?php while (true) {}',
  sql: 'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n) SELECT max(x) FROM n;',
};

function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 3000, windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function ownedContainers(jobId, all = true) {
  const result = docker([
    'ps',
    ...(all ? ['-a'] : []),
    '-q',
    '--no-trunc',
    '--filter',
    'label=gotit.code=true',
    '--filter',
    `label=gotit.job=${jobId}`,
  ]);
  const ids = result.split(/\s+/).filter(Boolean);
  for (const id of ids) assert.match(id, /^[a-f0-9]{64}$/);
  return ids;
}

async function waitFor(predicate, duration, message) {
  const deadline = Date.now() + duration;
  do {
    if (predicate()) return;
    await delay(100);
  } while (Date.now() < deadline);
  assert.fail(message);
}

async function verify(language) {
  const jobId = randomUUID();
  const child = fork(fileURLToPath(import.meta.url), ['--probe', language, jobId], {
    env: { ...process.env, EXECUTION_INSTANCE_ID: `console-recovery-${jobId}` },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    windowsHide: true,
  });
  let childError;
  child.on('error', (error) => {
    childError = error;
  });
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  try {
    await waitFor(
      () => {
        if (childError) throw childError;
        assert.equal(exited(), false, `${language} owner exited before the crash probe.`);
        return ownedContainers(jobId, false).length === 1;
      },
      8000,
      `Could not observe the ${language} container.`,
    );
    const killedAt = Date.now();
    assert.equal(child.kill('SIGKILL'), true, 'Could not terminate the disposable Node owner.');
    await waitFor(exited, 3000, 'Disposable Node owner did not exit.');
    await waitFor(() => !ownedContainers(jobId).length, 8000, `${language} container outlived its deadline.`);
    console.log(
      `${language}: container removed ${((Date.now() - killedAt) / 1000).toFixed(2)}s after owner termination.`,
    );
  } finally {
    if (!exited()) child.kill('SIGKILL');
    for (const id of ownedContainers(jobId)) docker(['rm', '--force', id]);
  }
}

if (process.argv[2] === '--probe') {
  const [, , , language, jobId] = process.argv;
  assert.ok(Object.hasOwn(probes, language));
  assert.match(jobId, /^[a-f0-9-]{36}$/);
  await executeCode(language, probes[language], '', { jobId });
} else {
  assert.equal(docker(['info', '--format', '{{.OSType}}']), 'linux', 'Docker Linux engine must be running.');
  for (const language of Object.keys(probes)) await verify(language);
}
