import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, chmodSync, statfsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function backupDatabase(source, destination) {
  if (source === ':memory:' || !existsSync(source)) throw new Error('Backup source must be an existing database file.');
  if (resolve(source) === resolve(destination) || existsSync(destination)) throw new Error('Backup destination must be a new file.');
  mkdirSync(dirname(destination), { recursive: true });
  const disk = statfsSync(dirname(destination));
  if (disk.bavail * disk.bsize < statSync(source).size * 1.2 + 2**30) throw new Error('Insufficient space for a verified backup plus 1 GB headroom.');
  const db = new DatabaseSync(source, { readOnly: true });
  try { db.exec('PRAGMA busy_timeout=5000'); db.prepare('VACUUM INTO ?').run(resolve(destination)); }
  finally { db.close(); }
  chmodSync(destination, 0o600);
  const copy = new DatabaseSync(destination, { readOnly: true });
  try {
    const check = copy.prepare('PRAGMA integrity_check').all();
    if (check.length !== 1 || Object.values(check[0])[0] !== 'ok') throw new Error('Backup failed integrity verification.');
  } finally { copy.close(); }
  return resolve(destination);
}
