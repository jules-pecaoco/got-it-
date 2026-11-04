import { readFileSync } from 'node:fs';

export function seedDemo(store) {
  for (const name of ['archives', 'garden']) {
    const pub = JSON.parse(readFileSync(new URL(`./${name}/public-exam.json`, import.meta.url)));
    const priv = JSON.parse(readFileSync(new URL(`./${name}/private-grading.json`, import.meta.url)));
    store.importDraft(pub, priv, 'test-fixture');
    store.publish(pub.examId, pub.version, 'test-fixture');
    store.createRun({
      examId: pub.examId, version: pub.version, pin: '4242', feedbackMode: 'practice',
      opensAt: new Date(Date.now() - 3600000).toISOString(), closesAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      roster: [{ candidateId: 'DEMO-001', displayName: 'Alex Rivera', section: 'Demo A' },
        { candidateId: 'DEMO-002', displayName: 'Sam Lee', section: 'Demo A' }]
    }, 'test-fixture');
  }
}
