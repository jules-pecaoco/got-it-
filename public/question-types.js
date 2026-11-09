import { assessmentLimits } from './assessment-limits.js';

export const questionTypes = Object.freeze([
  { id: 'single_choice', label: 'Single choice' },
  { id: 'multiple_choice', label: 'Multiple answers' },
  { id: 'true_false', label: 'True / false' },
  { id: 'text_entry', label: 'Short answer / flag' },
  { id: 'numeric_entry', label: 'Numeric answer' },
  { id: 'matching', label: 'Matching pairs' },
  { id: 'sequencing', label: 'Put in order' },
  { id: 'data_inspection', label: 'Table inspection' },
  { id: 'datatable_code', label: 'DataTables JavaScript' },
  { id: 'web_project', label: 'Build a web project (HTML/CSS/JS or PHP)' },
  { id: 'code_writing', label: 'Write code (PHP, Python, SQL, JavaScript)' }
]);
export const questionTypeIds = new Set(questionTypes.map(type => type.id));
export function positiveTypeCounts(counts = {}) {
  return Object.fromEntries(questionTypes.filter(type => Number(counts?.[type.id]) > 0).map(type => [type.id, Number(counts[type.id])]));
}
export const typeCountTotal = counts => Object.values(positiveTypeCounts(counts)).reduce((sum, count) => sum + count, 0);
export function validateQuestionMix(counts, total) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts) ||
    Object.entries(counts).some(([type, count]) => !questionTypeIds.has(type) || !Number.isInteger(count) || count < 0 || count > assessmentLimits.questions))
    return [`Choose supported types and counts from 0 to ${assessmentLimits.questions}.`];
  const sum = typeCountTotal(counts);
  return sum < 1 || sum > assessmentLimits.questions || sum !== total ? [`The mix must total 1–${assessmentLimits.questions} questions and match the question count.`] : [];
}
