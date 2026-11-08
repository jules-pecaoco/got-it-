import test from 'node:test';
import assert from 'node:assert/strict';
import { apiError, userErrorMessage, finishReviewMessage, completionMessage, questionIssueText, tableTargetSummary, codeServiceMessage } from '../public/user-messages.js';
import { retryPolicyText } from '../public/ui-model.js';

test('finish review distinguishes all-saved, unanswered and unsaved changes without zero warnings', () => {
  const ready = finishReviewMessage();
  assert.match(ready, /All your answers are saved/);
  assert.doesNotMatch(ready, /0 |pending|server|retries/);
  const pending = finishReviewMessage({ unanswered: 0, pending: 2 });
  assert.match(pending, /2 questions have changes that are not saved yet/);
  assert.doesNotMatch(pending, /All your answers are saved/);
  const missing = finishReviewMessage({ unanswered: 1, pending: 0 });
  assert.match(missing, /1 question has no saved answer/);
  assert.match(missing, /no points/);
  assert.doesNotMatch(missing, /0 |All your answers are saved/);
  const previous = finishReviewMessage({ hasPreviousSubmissions: true });
  assert.match(previous, /last submitted answer is kept/);
  assert.match(previous, /point or time deduction applies/);
});

test('completion reports actual submissions and separates processing, grading and shared scores', () => {
  const session = { submittedCount: 3, questionCount: 4, pendingReview: false, resultsReleased: false };
  const finished = completionMessage(session);
  assert.match(finished, /3 of 4/);
  assert.match(finished, /1 unanswered question receives no points/);
  assert.doesNotMatch(finished, /remaining retries|drafts|0 unanswered/);
  assert.doesNotMatch(completionMessage({ ...session, submittedCount: 4 }), /unanswered/);
  assert.match(completionMessage({ ...session, pendingReview: true }), /instructor needs to grade/);
  assert.match(completionMessage({ ...session, pendingCodingCount: 2 }), /2 answers are still being processed/);
  assert.match(completionMessage({ ...session, failedCodingCount: 1 }), /Tell your instructor/);
  assert.match(completionMessage({ ...session, resultsReleased: true, score: 12, maxPoints: 20 }), /12 out of 20/);
});

test('submission limits include the first try and only show deductions that apply', () => {
  assert.match(retryPolicyText({ maxRetries: 0, pointPenalty: 1, timePenaltySeconds: 5 }), /submit each answer once/);
  assert.match(retryPolicyText({ maxRetries: 2, pointPenalty: 1, timePenaltySeconds: 0 }), /up to 3 times/);
  assert.doesNotMatch(retryPolicyText({ maxRetries: 2, pointPenalty: 1, timePenaltySeconds: 0 }), /0 seconds/);
  assert.match(retryPolicyText({ maxRetries: null, pointPenalty: 0, timePenaltySeconds: 10 }), /as many times as you need/);
  assert.doesNotMatch(retryPolicyText({ maxRetries: null, pointPenalty: 0, timePenaltySeconds: 10 }), /0 points/);
});

test('friendly errors retain machine codes and stay correct when handled more than once', () => {
  for (const [role, expected] of [['student', /school ID or PIN/], ['faculty', /username or password/], ['proctor', /activity code or proctor code/]]) {
    const error = apiError({ code: 'UNAUTHORIZED', message: 'Invalid credentials.' }, role, 401);
    assert.equal(error.code, 'UNAUTHORIZED');
    assert.equal(error.status, 401);
    assert.match(error.message, expected);
    assert.equal(userErrorMessage(error, role), error.message);
    assert.doesNotMatch(error.message, /UNAUTHORIZED/);
  }
  const conflict = apiError({ code: 'DRAFT_CONFLICT', message: 'revision mismatch' }, 'student', 409);
  assert.match(conflict.message, /Copy any changes.*reload/);
  assert.doesNotMatch(conflict.message, /revision|DRAFT_CONFLICT/);
  assert.match(userErrorMessage({ code: 'CODE_RUNNER_UNAVAILABLE' }), /instructor/);
  assert.match(userErrorMessage({ code: 'AI_NOT_CONFIGURED' }, 'faculty'), /technical administrator/);
});

test('code status describes the user action without exposing hosting details', () => {
  const unavailable = codeServiceMessage({ docker: 'unreachable', languages: [], message: 'Docker daemon missing', webPreviewConfigured: false }, { languages: ['php'] });
  assert.match(unavailable, /keep writing and saving/);
  assert.match(unavailable, /Tell your instructor/);
  assert.doesNotMatch(unavailable, /Docker|daemon|runtime|worker/);
  assert.equal(codeServiceMessage({ docker: 'ready', languages: ['python'], webPreviewConfigured: false }, { languages: ['python'] }), '');
});

test('faculty table messages identify rows from one and use readable labels for target settings', () => {
  assert.match(questionIssueText('table.rows[0].id: provide a nonempty unique string ID.'), /Row 1 ID: provide a different ID written as text/);
  assert.match(questionIssueText('answer.order[0]: choose a column.'), /Sort rule 1/);
  assert.match(questionIssueText('answer.pageIndex: use a nonnegative integer, starting at zero.'), /starting at 1/);
  assert.match(questionIssueText('answer.pageIndex: DataTables coding requires page zero.'), /page 1/);
  const text = tableTargetSummary({ type: 'datatable_code', table: { columns: [{ id: 'score', label: 'Score' }] }, answer: {
    pageLength: 2, pageIndex: 0, globalSearch: '', columnSearch: {}, order: [{ column: 'score', direction: 'desc' }], flags: { paging: true, searching: false, ordering: true }, lengthMenu: [2, 5],
  } });
  assert.match(text, /Page number: 1/);
  assert.match(text, /Score \(descending\)/);
  assert.match(text, /Allow searching: no/);
  assert.doesNotMatch(text, /pageIndex|globalSearch|flags|columnSearch/);
  assert.match(tableTargetSummary({ answer: { order: ['asc'] } }), /needs correction/);
});
