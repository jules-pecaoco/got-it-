import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { loadConfig } from '../src/config.mjs';

const { root, dataFile } = loadConfig();
console.log(`Database: ${dataFile}`);
const folder = join(root, 'exam-packages', 'itp255-week13-draft');
const pub = JSON.parse(readFileSync(join(folder, 'public-exam.json'), 'utf8'));
const priv = JSON.parse(readFileSync(join(folder, 'private-grading.json'), 'utf8'));
const source = readFileSync(join(folder, 'Week_13-2_extracted.md'), 'utf8');
const store = new Store(dataFile);
try {
  const existing = store.listExams().find(item => item.examId === pub.examId && item.version === pub.version);
  if (existing) {
    console.log(`${pub.examId}@${pub.version} already exists as ${existing.status}; no changes made.`);
  } else {
    store.importDraft(pub, priv, 'local-import');
    store.addSource(pub.examId, pub.version, { filename: 'Week_13-2_extracted.md', content: source }, 'local-import');
    console.log(`Imported ${pub.examId}@${pub.version} as a draft with one source awaiting instructor review.`);
  }
} finally { store.close(); }
