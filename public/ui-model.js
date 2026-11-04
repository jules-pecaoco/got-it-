export const attemptLabels = Object.freeze({
  registered: 'Not started', in_progress: 'In progress', submitted: 'Submitted', expired: 'Time ended'
});

export function participationCounts(rows) {
  const counts = { registered: 0, in_progress: 0, submitted: 0, expired: 0, hidden: 0, readyToPublish: 0 };
  for (const row of rows) {
    if (Object.hasOwn(attemptLabels, row.status)) counts[row.status]++;
    if (row.sessionId && !row.resultsReleased) {
      counts.hidden++;
      if (['submitted', 'expired'].includes(row.status)) counts.readyToPublish++;
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
  const retries = policy.maxRetries === null ? 'Unlimited retries' : `${policy.maxRetries} ${policy.maxRetries === 1 ? 'retry' : 'retries'} per question`;
  const cost = policy.pointPenalty || policy.timePenaltySeconds
    ? `Each retry costs ${policy.pointPenalty} ${policy.pointPenalty === 1 ? 'point' : 'points'} and ${policy.timePenaltySeconds} seconds.`
    : 'Retries have no point or time cost.';
  return `${retries}. ${cost}`;
}

export function localDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  }).format(date);
}
