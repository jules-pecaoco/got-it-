import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.mjs';
import { backupDatabase } from '../src/backup.mjs';

const { dataFile } = loadConfig();
const destination = process.argv[2] || join(dirname(dataFile), 'backups', `studio-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}.sqlite`);
console.log(`Backing up: ${dataFile}`);
console.log(`Verified backup: ${backupDatabase(dataFile, destination)}`);
