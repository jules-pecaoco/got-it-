import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function configureRuntimeTemp(root = projectRoot, env = process.env) {
  const directory = resolve(root, env.RUNTIME_TEMP_DIR || 'data/tmp');
  mkdirSync(directory, { recursive: true });
  for (const key of ['TEMP', 'TMP', 'TMPDIR']) env[key] = directory;
  return directory;
}

// Loaded before application/build/test entry points; child processes inherit this.
configureRuntimeTemp();
