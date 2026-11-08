export function hasAnswerValue(value) {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === 'boolean' || Number.isFinite(item) || (typeof item === 'string' && item.trim())) return true;
    if (item !== null && typeof item === 'object') {
      for (const child of Object.values(item)) pending.push(child);
    }
  }
  return false;
}
