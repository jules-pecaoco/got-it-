import { spawn } from 'node:child_process';
import { loadConfig } from '../src/config.mjs';
import { migrationDatabase } from '../src/migration-database.mjs';

const { dataFile, root } = loadConfig();
const target = migrationDatabase(dataFile);
console.log(`Migration database: ${target}`);
console.log(`Original database preserved: ${dataFile}`);
const args = ['--import', 'tsx', '--experimental-sqlite'];
if (process.argv.includes('--watch')) args.push('--watch');
args.push('src/server.mjs');
const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, DATA_FILE: target, MIGRATION_ACTIVE: '1' } });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });
