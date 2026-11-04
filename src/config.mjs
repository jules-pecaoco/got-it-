import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function loadConfig(root = projectRoot) {
  const envFile = join(root, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const configuredFile = process.env.DATA_FILE || join(root, 'data', 'studio.sqlite');
  return {
    root,
    dataFile: configuredFile === ':memory:' ? configuredFile : resolve(root, configuredFile),
    demoMode: process.env.DEMO_MODE !== '0',
    platformLabel: process.env.PLATFORM_LABEL || 'Got It!',
    platformTagline: process.env.PLATFORM_TAGLINE || 'Gotta Catch Ed All',
    instructorPassword: process.env.INSTRUCTOR_PASSWORD || (process.env.DEMO_MODE !== '0' ? 'demo-instructor' : ''),
    publicOrigin: process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).origin : null
  };
}
