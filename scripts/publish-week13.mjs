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
  if (!existing) store.importDraft(pub, priv, 'codex-review');
  else if (existing.status === 'draft') store.updateDraft(pub.examId, pub.version, pub, priv, 'codex-review');
  else throw new Error('Version 1 is already published; create a new version to change it.');
  let sources = store.listSources(pub.examId, pub.version);
  if (!sources.length) {
    store.addSource(pub.examId, pub.version, { filename: 'Week_13-2_extracted.md', content: source }, 'codex-review');
    sources = store.listSources(pub.examId, pub.version);
  }
  if (sources.length !== 1 || sources[0].filename !== 'Week_13-2_extracted.md' || sources[0].content !== source)
    throw new Error('Source in the studio differs from the reviewed slide extraction.');
  store.reviewSource(pub.examId, pub.version, sources[0].id, {
    topic: 'DataTables pagination, global and column search, and two-key ordering',
    learningOutcome: 'Configure and inspect a six-column queue with taught DataTables calls',
    proposedActivityType: 'data_inspection and datatable_code',
    evidence: 'Control settings and submitted code produce the reviewed first-page ticket sets'
  }, 'codex-review');
  const errors = store.validate(pub.examId, pub.version);
  if (errors.length) throw new Error(errors.join('\n'));
  const published = store.publish(pub.examId, pub.version, 'instructor-request');
  const run = store.createRun({ examId: pub.examId, version: pub.version, pin: '4242',
    opensAt: new Date(Date.now() - 60_000).toISOString(),
    closesAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    roster: [
      { candidateId: 'DEMO-001', displayName: 'Alex Rivera', section: 'Test' },
      { candidateId: 'DEMO-002', displayName: 'Sam Lee', section: 'Test' }
    ] }, 'instructor-request');
  console.log(JSON.stringify({ published, run }, null, 2));
} finally { store.close(); }
