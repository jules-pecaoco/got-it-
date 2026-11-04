import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureRuntimeTemp } from '../src/runtime-temp.mjs';

test('runtime temp uses project storage and keeps all child-process temp variables consistent', () => {
  const root = mkdtempSync(join(tmpdir(), 'runtime-temp-'));
  try {
    const env = { TEMP: 'old-temp', TMP: 'old-tmp' };
    const directory = configureRuntimeTemp(root, env);
    assert.equal(directory, join(root, 'data', 'tmp'));
    assert.equal(existsSync(directory), true);
    for (const key of ['TEMP', 'TMP', 'TMPDIR']) assert.equal(env[key], directory);
    const custom = { RUNTIME_TEMP_DIR: 'custom-temp' };
    assert.equal(configureRuntimeTemp(root, custom), join(root, 'custom-temp'));
  } finally { rmSync(root, { recursive: true }); }
});
