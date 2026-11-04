import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config.mjs';

const config = loadConfig(), file = join(config.root, '.env');
let content = existsSync(file) ? readFileSync(file, 'utf8') : '';
const values = { DEMO_MODE: '0', HOST: '127.0.0.1' };
if (config.instructorPassword.length < 16 || config.instructorPassword === 'demo-instructor') values.INSTRUCTOR_PASSWORD = randomBytes(24).toString('base64url');
for (const [key, value] of Object.entries(values)) {
  const line = new RegExp(`^${key}=.*$`, 'gm');
  content = line.test(content) ? content.replace(line, `${key}=${value}`) : content.trimEnd() + `\n${key}=${value}\n`;
}
writeFileSync(file, content, { mode: 0o600 }); chmodSync(file, 0o600);
console.log(`Local configuration prepared: ${file}`);
console.log('Demo mode disabled; loopback binding selected; database selection and other secrets preserved.');
console.log(values.INSTRUCTOR_PASSWORD ? 'A strong faculty password was generated in .env. It is not printed in logs.' : 'Existing strong faculty password preserved.');
