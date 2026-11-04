import test from 'node:test';
import assert from 'node:assert/strict';
import { participationCounts, filterResultRows } from '../public/ui-model.js';

const rows = [
  { candidateId: 'A', displayName: 'Alex Rivera', section: 'K32', status: 'registered', sessionId: null, resultsReleased: false },
  { candidateId: 'B', displayName: 'Sam Lee', section: 'K32', status: 'in_progress', sessionId: 'b', resultsReleased: false },
  { candidateId: 'C', displayName: 'Jules Cruz', section: 'K33', status: 'submitted', sessionId: 'c', resultsReleased: false },
  { candidateId: 'D', displayName: 'Pat Quinn', section: 'K33', status: 'expired', sessionId: 'd', resultsReleased: false },
  { candidateId: 'E', displayName: 'Drew King', section: 'K33', status: 'submitted', sessionId: 'e', resultsReleased: true }
];

test('participation separates unfinished hidden scores from completed scores ready to publish', () => {
  assert.deepEqual(participationCounts(rows), {
    registered: 1, in_progress: 1, submitted: 2, expired: 1, hidden: 3, readyToPublish: 2
  });
  assert.equal(participationCounts(rows.map(row => ({ ...row, resultsReleased: true }))).readyToPublish, 0);
});

test('results filters combine identity, attempt and visibility without treating an unstarted attempt as a hidden score', () => {
  assert.deepEqual(filterResultRows(rows, { search: ' k33 ', visibility: 'hidden' }).map(row => row.candidateId), ['C', 'D']);
  assert.deepEqual(filterResultRows(rows, { status: 'submitted', visibility: 'published' }).map(row => row.candidateId), ['E']);
  assert.deepEqual(filterResultRows(rows, { search: 'aLeX' }).map(row => row.candidateId), ['A']);
  assert.deepEqual(filterResultRows(rows, { status: 'registered', visibility: 'hidden' }), []);
});
