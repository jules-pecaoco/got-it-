import { statfsSync, existsSync } from 'node:fs';
import { dirname, parse } from 'node:path';
import os from 'node:os';
import { loadConfig } from '../src/config.mjs';
import { codingStatus } from '../src/code-runner.mjs';

const config = loadConfig();
let failed = false;
function check(ok, message) { console.log(`${ok ? 'PASS' : 'FAIL'} ${message}`); if (!ok) failed = true; }
check(!config.demoMode, 'Demo mode is disabled.');
check(config.instructorPassword.length >= 16 && config.instructorPassword !== 'demo-instructor', 'Faculty password has at least 16 characters.');
check(config.publicOrigin?.startsWith('https://'), 'PUBLIC_ORIGIN is the actual public HTTPS address.');
console.log(`Database: ${config.dataFile}`);
console.log(`Runtime temp: ${config.tempDirectory}`);
console.log(`RAM: ${(os.freemem()/2**30).toFixed(1)} GB currently free / ${(os.totalmem()/2**30).toFixed(1)} GB total`);
const roots = new Set([parse(os.tmpdir()).root, parse(config.root).root, parse(config.dataFile).root]);
for (const root of roots) {
  if (!root || !existsSync(root)) continue;
  const disk = statfsSync(root), free = disk.bavail * disk.bsize / 2**30;
  check(free >= 10, `${root} has ${free.toFixed(1)} GB free (minimum preparation target: 10 GB).`);
}
check(config.dataFile !== ':memory:' && existsSync(config.dataFile), 'Persistent database exists.');
const coding = await codingStatus(); check(coding.available, coding.message);
process.exitCode = failed ? 1 : 0;
