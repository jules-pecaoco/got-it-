export const attemptLabels = Object.freeze({
  registered: 'Not started', in_progress: 'In progress', submitted: 'Submitted', expired: 'Time ended'
});

export function participationCounts(rows) {
  const counts = { registered: 0, in_progress: 0, submitted: 0, expired: 0, hidden: 0, readyToPublish: 0 };
  for (const row of rows) {
    if (Object.hasOwn(attemptLabels, row.status)) counts[row.status]++;
    if (row.sessionId && !row.resultsReleased) {
      counts.hidden++;
      if (['submitted', 'expired'].includes(row.status) && !row.finalizationPending && !row.pendingCoding && !row.pendingReview) counts.readyToPublish++;
    }
  }
  return counts;
}

export function filterResultRows(rows, { search = '', status = 'all', visibility = 'all' } = {}) {
  const term = search.trim().toLocaleLowerCase();
  return rows.filter(row => (status === 'all' || row.status === status) &&
    (visibility === 'all' || !!row.sessionId && (visibility === 'published' ? row.resultsReleased : !row.resultsReleased)) &&
    (!term || `${row.displayName} ${row.candidateId} ${row.section}`.toLocaleLowerCase().includes(term)));
}

export function retryPolicyText(policy) {
  if (policy.maxRetries === 0) return 'You can submit each answer once. You cannot change it after submitting.';
  const limit = policy.maxRetries === null ? 'You can submit each answer as many times as you need while time remains.' : `You can submit each answer up to ${policy.maxRetries + 1} times.`;
  const deductions = [];
  if (policy.pointPenalty) deductions.push(`${policy.pointPenalty} ${policy.pointPenalty === 1 ? 'point' : 'points'}`);
  if (policy.timePenaltySeconds) deductions.push(`${policy.timePenaltySeconds} seconds from your remaining time`);
  return `${limit} ${deductions.length ? `Each submission after the first deducts ${deductions.join(' and ')}.` : 'Extra submissions do not deduct points or time.'}`;
}

export function localDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  }).format(date);
}
