import { createWorkspace } from './workspace-client.mts';
import type { Project } from '../web/contracts.js';
interface Criterion {
  id: string;
  points: number;
  answer: {
    kind: 'manual' | 'http';
    path: string;
    method?: string;
    body?: string;
    status: number;
    contains: string;
  };
}
export async function evaluateWeb(
  config: { seedSql?: string },
  rule: { criteria: Criterion[] },
  submission: { value: Project },
) {
  // Student database state is evidence; tests start with a clean faculty fixture.
  const workspace = createWorkspace();
  const awarded: { id: string; points: number }[] = [];
  try {
    await workspace.start({ files: submission.value.files }, config.seedSql);
    let cookie = '';
    for (const criterion of rule.criteria) {
      if (criterion.answer.kind === 'manual') continue;
      const check = criterion.answer;
      const result = await workspace.request(check.method || 'GET', check.path, check.body || '', cookie);
      const cookies = result.headers['set-cookie'];
      if (Array.isArray(cookies)) cookie = cookies.map((value) => value.split(';')[0]).join('; ');
      if (result.status === check.status && result.body.toString('utf8').includes(check.contains))
        awarded.push({ id: criterion.id, points: criterion.points });
    }
    return {
      result:
        awarded.length === rule.criteria.length
          ? 'correct'
          : awarded.length
            ? 'partially_correct'
            : 'incorrect',
      awarded,
      feedbackCode: rule.criteria.some((item) => item.answer.kind === 'manual')
        ? 'FACULTY_REVIEW_REQUIRED'
        : 'WEB_TESTS_COMPLETE',
    };
  } finally {
    await workspace.close();
  }
}
