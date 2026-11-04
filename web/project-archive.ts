import { zipSync, unzipSync, strToU8 } from 'fflate';
import { validateProject } from '../public/web-project.js';
import type { Project } from './contracts.js';
function base64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
export function exportProject(project: Project): Uint8Array {
  const files = Object.fromEntries(
    Object.entries(project.files).map(([name, content]) => [name, strToU8(content)]),
  );
  if (project.database)
    files['database.sqlite'] = Uint8Array.from(atob(project.database), (char) => char.charCodeAt(0));
  return zipSync(files);
}
export function importProject(bytes: Uint8Array): Project {
  let size = 0,
    count = 0;
  const entries = unzipSync(bytes, {
    filter(entry) {
      size += entry.originalSize;
      count++;
      if (size > 1700000 || count > 21) throw new Error('Project archive is too large.');
      return !entry.name.endsWith('/');
    },
  });
  const files: Record<string, string> = {};
  let database: string | undefined;
  for (const [name, content] of Object.entries(entries)) {
    if (name === 'database.sqlite') {
      if (new TextDecoder().decode(content.subarray(0, 16)) !== 'SQLite format 3\0')
        throw new Error('Invalid SQLite snapshot.');
      database = base64(content);
    } else files[name] = new TextDecoder('utf-8', { fatal: true }).decode(content);
  }
  const project: Project = { files, ...(database ? { database } : {}) };
  const errors = validateProject(project);
  if (errors.length) throw new Error(errors.join(' '));
  return project;
}
