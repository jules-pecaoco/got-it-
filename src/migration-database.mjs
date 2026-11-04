import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { backupDatabase } from './backup.mjs';

export function migrationDatabase(source) {
  if (source === ':memory:') throw new Error('Migration hosting requires a persistent database.');
  const target = resolve(process.env.MIGRATION_DATA_FILE || source + '.migration.sqlite');
  const original = resolve(source);
  const normalized = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  if (normalized(target) === normalized(original)) throw new Error('Migration must use a separate database.');
  if (existsSync(source) && existsSync(target)) {
    const first = statSync(source),
      second = statSync(target);
    if (first.ino === second.ino && first.dev === second.dev)
      throw new Error('Migration target refers to the original database.');
  }
  if (!existsSync(target) && existsSync(source)) backupDatabase(source, target);
  return target;
}
