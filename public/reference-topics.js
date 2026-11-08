export const referenceTopics = Object.freeze([
  { id: 'bootstrap5', label: 'Bootstrap 5' },
  { id: 'sql', label: 'SQL (SQLite)' },
  { id: 'python', label: 'Python' },
  { id: 'php', label: 'PHP' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
]);
export function validateReferenceSelection(value) {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > referenceTopics.length ||
    new Set(value).size !== value.length ||
    value.some((id) => !referenceTopics.some((topic) => topic.id === id))
  )
    return ['Choose only supported reference guides, without duplicates.'];
  return [];
}
