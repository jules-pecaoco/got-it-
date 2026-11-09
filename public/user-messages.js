// Shared wording for messages that affect saving, submission and recovery.
// Error codes remain available to callers; they are not part of the visible text.
export const savedAnswerRule = 'Answers save as you work and submit automatically when you finish or time runs out. If all tries are used, your last submitted answer is kept.';

export function finishReviewMessage({ unanswered = 0, pending = 0, hasPreviousSubmissions = false } = {}) {
  const parts = [];
  if (pending) parts.push(`${pending} ${pending === 1 ? 'question has' : 'questions have'} unsaved changes. Open ${pending === 1 ? 'that question' : 'those questions'} and wait for “Saved” before finishing.`);
  if (unanswered) parts.push(`${unanswered} ${unanswered === 1 ? 'question has' : 'questions have'} no saved answer. Unanswered questions receive no points.`);
  if (!pending && !unanswered) parts.push('All your answers are saved. You can finish now.');
  if (!pending && unanswered) parts.push('You can return to these questions or finish now.');
  if (hasPreviousSubmissions) parts.push('If all tries are used, your last submitted answer is kept. Otherwise, a changed answer uses another try and any listed point or time deduction applies.');
  parts.push('You cannot change answers after finishing.');
  return parts.join(' ');
}

export function completionMessage(session) {
  if (session.failedCodingCount) return 'Activity finished. Some answers could not be processed; your submitted work is saved. Tell your instructor to finish processing it.';
  if (session.pendingCodingCount) return `Your answers have been received. ${session.pendingCodingCount} ${session.pendingCodingCount === 1 ? 'answer is' : 'answers are'} still being processed. This page will update automatically.`;
  if (session.pendingReview) return 'Your answers have been submitted. Your instructor needs to grade some answers before sharing your score here.';
  if (session.resultsReleased) return `Your score: ${session.score} out of ${session.maxPoints} points.`;
  const missing = Math.max(0, session.questionCount - session.submittedCount);
  return `We received answers for ${session.submittedCount} of ${session.questionCount} questions. ${missing ? `${missing} unanswered ${missing === 1 ? 'question receives' : 'questions receive'} no points. ` : ''}Your score will appear here after your instructor shares it. This page checks automatically.`;
}

export function questionIssueText(value) {
  return String(value || 'This question needs to be checked before it can be used.')
    .replace(/table\.rows\[(\d+)\]\.id:/g, (_, index) => `Row ${Number(index) + 1} ID:`)
    .replace(/table\.rows\[(\d+)\]\.([^ :]+):/g, (_, index, column) => `Row ${Number(index) + 1}, column “${column}”:`)
    .replace(/table\.columns\[(\d+)\](?:\.id)?:/g, (_, index) => `Column ${Number(index) + 1}:`)
    .replace(/answer\.order\[(\d+)\]:/g, (_, index) => `Sort rule ${Number(index) + 1}:`)
    .replace(/table\.columns:/g, 'Table columns:')
    .replace(/table\.rows:/g, 'Table rows:')
    .replace(/table\.pageLengths:/g, 'Available page sizes:')
    .replace(/answer\.pageLength:/g, 'Rows per page:')
    .replace(/answer\.pageIndex: use a nonnegative integer, starting at zero\./g, 'Page number: enter a whole number starting at 1.')
    .replace(/answer\.pageIndex: DataTables coding requires page zero\./g, 'Page number: DataTables coding questions must use page 1.')
    .replace(/answer\.pageIndex:/g, 'Page number:')
    .replace(/answer\.globalSearch:/g, 'Search text:')
    .replace(/answer\.columnSearch:/g, 'Column filter:')
    .replace(/answer\.order:/g, 'Sort order:')
    .replace(/answer\.flags:/g, 'Table controls:')
    .replace(/answer\.lengthMenu:/g, 'Page-size choices:')
    .replace(/table\.selector:/g, 'Table name in the starter code:')
    .replace(/table\.scaffold:/g, 'Starter code:')
    .replace(/provide boolean paging, searching and ordering values; null is invalid/g, 'choose whether paging, searching and sorting are on or off')
    .replace(/use an object mapping a column ID to search text, or \{\} for no filter/g, 'choose a column and enter filter text, or leave the filter empty')
    .replace(/provide a string of up to 100 characters; use "" for no search/g, 'enter up to 100 characters, or leave blank for no search')
    .replace(/one or two \{column, direction\} objects, for example \[\{"column":"name","direction":"asc"\}\]/g, 'one or two sort rules, each with a column name and a direction (asc or desc)')
    .replace(/use an existing column ID and direction "asc" or "desc"; a direction string alone is invalid/g, 'choose a column and a direction (asc or desc). A direction alone is not enough')
    .replace(/a nonempty unique string ID/g, 'a different ID written as text')
    .replace(/nonempty string id and label/g, 'an ID and a label, both written as text')
    .replace(/string, finite number, boolean or null cell/g, 'cell value: text, a number, true, false or an empty value')
    .replace(/no column array/g, 'no columns')
    .replace(/no row array/g, 'no rows')
    .replace(/code_writing/g, 'coding questions')
    .replace(/web_project/g, 'web project questions')
    .replace(/data_inspection/g, 'table questions')
    .replace(/datatable_code/g, 'DataTables coding questions')
    .replace(/manualRationale/g, 'reason for adding the question')
    .replace(/sourceRefs/g, 'source references')
    .replace(/publicConfig/g, 'question settings')
    .replace(/gradingRuleId/g, 'answer key reference')
    .replace(/m(\d+)-q(\d+):/g, (_, section, question) => `Section ${section}, question ${question}:`)
    .replace(/single_choice/g, 'single-choice questions')
    .replace(/multiple_choice/g, 'multiple-answer questions')
    .replace(/true_false/g, 'true-or-false questions')
    .replace(/text_entry/g, 'short-answer questions')
    .replace(/numeric_entry/g, 'numeric questions')
    .replace(/criterion points/g, 'points for grading items')
    .replace(/grading criteria/g, 'grading instructions')
    .replace(/schemaVersion must be 1.0./g, 'This imported activity uses an unsupported file format. Ask your technical administrator for help.')
    .replace(/manual rubric criteria/g, 'grading instructions for faculty')
    .replace(/Database snapshot|database snapshot/g, 'saved database copy')
    .replace(/Run ID|run ID/g, 'activity code')
    .replace(/\brun closing time\b/g, 'activity closing time');
}

export function userErrorMessage(error, role = 'student') {
  const code = error?.code;
  const message = String(error?.technicalMessage ?? error?.message ?? '');
  const contact = role === 'faculty' ? 'your technical administrator' : role === 'proctor' ? 'the faculty member in charge' : 'your instructor';
  if (code === 'UNAUTHORIZED' || error?.status === 401) {
    if (/invalid|credentials/i.test(message)) return role === 'faculty' ? 'The username or password is incorrect. Check them and try again.' : role === 'proctor' ? 'The activity code or proctor code is incorrect. Check the details from faculty and try again.' : 'The activity code, school ID or PIN is incorrect. Check the details from your instructor and try again.';
    return 'Your sign-in has expired. Sign in again to continue.';
  }
  const messages = {
    SESSION_CLOSED: 'Answering time has ended. Open the results page to check your submission.',
    LOCKED: 'This section is locked. Submit an answer to each question in the previous section first.',
    ATTEMPT_LIMIT: 'All tries are used. Your last submitted answer is kept.',
    DRAFT_CONFLICT: 'This answer changed in another tab. Copy any changes you want to keep, then reload to see the latest saved answer.',
    DRAFT_CHANGED: 'This activity changed in another tab. Copy your edits, then refresh before saving again.',
    INVALID_IDEMPOTENCY_KEY: 'Submission could not be confirmed. Copy your answer, then reload and try again.',
    IDEMPOTENCY_CONFLICT: 'A different answer was already submitted. Copy your changes, then reload to check the latest submission before retrying.',
    INVALID_JSON: 'The information sent could not be read. Retry, or reload if it still fails.',
    INVALID_ORIGIN: `This page cannot connect securely. Open the activity using the link provided by ${contact}.`,
    INVALID_SESSION: 'Sign-in could not be confirmed. Sign in again.',
    CODE_RUNNER_BUSY: 'Code running is busy. Wait a moment, then retry.',
    TERMINAL_BUSY: 'Code running is busy. Wait a moment, then retry.',
    TERMINAL_RUNNING: 'Stop the program that is already running, then try again.',
    TERMINAL_ENDED: 'This program has stopped. Select Run code to start it again.',
    WEB_CAPACITY: 'Project previews are busy. Wait a moment, then open the preview again.',
    WEB_WORKSPACE_ENDED: 'This preview has ended. Open a new preview to continue.',
    WEB_RUNTIME_UNAVAILABLE: `Project previews are unavailable. Keep writing your answer; tell ${contact} if you need a preview.`,
    TERMINAL_UNAVAILABLE: `Code running is unavailable. Keep writing your answer; tell ${contact} if you need to run it.`,
    CODE_RUNNER_UNAVAILABLE: `Code running is unavailable. Keep writing your answer; tell ${contact} if you need to run it.`,
    TERMINAL_UPDATE_REQUIRED: `Code running needs an update. Keep writing your answer and ask ${contact} for help.`,
    INVALID_DRAFT: 'Answer not saved. Check it and try saving again.',
    INVALID_CODE_CONFIG: role === 'faculty' ? 'This coding question has an incomplete setup. Edit or regenerate it before using it.' : `This coding question is not ready to run. Tell ${contact}.`,
    TERMINAL_UNSUPPORTED: `Code running is not ready on this computer. Ask ${contact} for help.`,
    CODE_EXECUTION_REQUIRED: 'Use Run code to test this answer, then submit it for grading.',
    IMMUTABLE_VERSION: 'This activity is already published. Create an editable copy to make changes.',
    EXAM_NOT_PUBLISHED: 'Publish this activity before assigning it to a class.',
    REVIEW_PENDING: 'Some answers need grading. Open Review answers and save grades before sharing scores.',
    GRADING_PENDING: 'Answers are still being processed. Wait for them to finish.',
    AI_PAYMENT_REQUIRED: 'AI billing needs payment or credits. Check billing with your administrator, or choose another configured service. Retrying will not help.',
    AI_RATE_LIMITED: 'AI usage limit reached. Wait and retry, request fewer questions, or choose another service.',
    AI_NOT_CONFIGURED: 'This AI service is not set up. Choose another service or ask your technical administrator.',
    AI_GATEWAY_ERROR: 'Connection lost; generation may still be running. Check progress before retrying, or ask your technical administrator.',
    INVALID_SERVER_RESPONSE: role === 'faculty' ? 'The server response could not be read. Retry, or ask your technical administrator to check the server.' : `The response could not be read. Retry; if it still fails, tell ${contact}.`,
    INTERNAL_ERROR: role === 'faculty' ? 'Something went wrong. Ask your technical administrator to check server logs.' : `Something went wrong. Retry; if it still fails, tell ${contact}.`,
    AI_REQUEST_REJECTED: 'AI settings were rejected. Ask your administrator to check model and format compatibility.',
    AI_MODEL_UNAVAILABLE: 'This AI model is unavailable. Choose another supported model.',
    AI_TIMEOUT: 'AI response timed out. Retry with fewer questions.',
    AI_PROVIDER_ERROR: 'AI could not complete the request. Retry or choose another service.',
    AI_PROVIDER_BUSY: 'This AI service is busy. Wait and retry, or choose another service.',
    AI_OUTPUT_TRUNCATED: 'AI stopped before finishing. Generate fewer questions at a time.',
    AI_INVALID_JSON: 'AI returned an unusable question format. Retry or choose another model.',
    AI_EMPTY: 'AI returned no questions. Retry or choose another model.',
    AI_BLOCKED: 'AI could not create questions. Review the source and instructions, then retry.',
    AI_INPUT_TOO_LARGE: 'This source is too long for the AI model. Shorten it or choose another model.',
    AI_BUDGET_EXHAUSTED: 'Generation paused at its limit. Saved progress is kept. Select Resume generation to continue.',
    AI_ABORTED: 'Generation stopped. Saved progress is kept. Select Resume generation when ready.',
    AI_BUSY: 'Generation is busy. Wait a moment, then retry.',
    AI_DUPLICATE_QUESTION: 'This batch repeated a question. Earlier questions are saved. Select Resume generation to retry this batch.',
    AI_BATCH_REQUIRED: 'Select Generate preview to create this assessment in batches with saved progress.',
    RATE_LIMITED: 'Too many requests. Wait a moment, then retry.',
    TOO_LARGE: 'File or answer too large. Use a smaller file or shorten your answer, then retry.',
    DRAFT_TOO_LARGE: 'Answer too large to save. Shorten it or remove unneeded project files, then save again.',
  };
  if (typeof code === 'string' && code.startsWith('AI_') && role !== 'faculty') return `Question generation is unavailable. Ask ${contact} for help.`;
  if (code === 'AI_BUSY' && /current batch is stopping/i.test(message)) return 'The current batch is stopping. Wait a moment, then select Resume generation.';
  if (code === 'AI_BUSY' && /finish or pause your current generation/i.test(message)) return 'A generation is already running. Finish or pause it before starting another.';
  if (code === 'CODING_JOB_PENDING') return role === 'student' ? 'Your code submission is still being processed. Wait before submitting again.' : 'Submitted answers are still being processed. Wait, then refresh results.';
  if (code === 'RUN_CLOSED') return role === 'faculty' ? questionIssueText(message || 'This class activity has ended. Check its closing time before continuing.') : `This activity is not open now. Check its opening and closing times with ${contact}.`;
  if (code === 'RATE_LIMITED' && Number(error?.retryAfterSeconds) > 0) {
    const minutes = Math.ceil(Number(error.retryAfterSeconds) / 60);
    return `Request limit reached. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
  }
  if (messages[code]) return messages[code];
  if (error?.status >= 500 || /Cannot read properties|is not a function|fetch failed|Failed to fetch|NetworkError|Unexpected (?:token|end)|Load failed/i.test(message))
    return `Action failed. Check your connection and retry; if it still fails, tell ${contact}.`;
  // Keep specific input instructions (file types, required fields, ranges) useful.
  return questionIssueText(message || `We could not complete this action. Try again or contact ${contact}.`);
}

export function apiError(result, role, status) {
  const error = { code: result.code, message: result.message, status, retryAfterSeconds: result.retryAfterSeconds };
  return Object.assign(new Error(userErrorMessage(error, role)), { code: result.code, status, technicalMessage: result.message, retryAfterSeconds: result.retryAfterSeconds });
}

export function codeServiceMessage(status, { role = 'student', languages = [], webProject = false } = {}) {
  const missing = languages.filter(language => !status.languages?.includes(language));
  const codeUnavailable = status.docker !== 'ready' || missing.length > 0;
  const previewUnavailable = webProject && (!status.webPreviewConfigured || !status.languages?.includes('php'));
  if (!codeUnavailable && !previewUnavailable) return role === 'faculty' ? (webProject ? 'Code running and project previews are ready.' : 'Code running is ready.') : '';
  const detail = codeUnavailable ? 'Code running is temporarily unavailable.' : 'Some project previews are temporarily unavailable.';
  return role === 'faculty' ? `${detail} Students can keep writing and saving. Select Refresh service status.`
    : `${detail} You can keep writing and saving. Tell your instructor if needed.`;
}


export function tableTargetSummary(activity) {
  const answer = activity.answer || {};
  const columns = Array.isArray(activity.table?.columns) ? activity.table.columns : [];
  const label = id => columns.find(column => column?.id === id)?.label || id;
  const lines = [
    `Rows per page: ${answer.pageLength ?? 'not set'}`,
    `Page number: ${Number.isInteger(answer.pageIndex) ? answer.pageIndex + 1 : 'not set'}`,
    `Search all columns: ${typeof answer.globalSearch === 'string' && answer.globalSearch ? answer.globalSearch : 'none'}`,
  ];
  const filters = answer.columnSearch && typeof answer.columnSearch === 'object' && !Array.isArray(answer.columnSearch) ? Object.entries(answer.columnSearch) : [];
  lines.push(...(filters.length ? filters.map(([column, term]) => `Filter ${label(column)}: ${term || 'none'}`) : ['Column filter: none']));
  const order = Array.isArray(answer.order) ? answer.order : [];
  lines.push('Sort by: ' + (order.length && order.every(item => item && typeof item === 'object' && item.column && ['asc', 'desc'].includes(item.direction))
    ? order.map(item => `${label(item.column)} (${item.direction === 'asc' ? 'ascending' : 'descending'})`).join(', then ')
    : 'needs correction'));
  if (activity.type === 'datatable_code') {
    for (const [key, text] of [['paging', 'Split rows into pages'], ['searching', 'Allow searching'], ['ordering', 'Allow sorting']])
      lines.push(`${text}: ${typeof answer.flags?.[key] === 'boolean' ? answer.flags[key] ? 'yes' : 'no' : 'not set'}`);
    lines.push(`Page-size choices: ${Array.isArray(answer.lengthMenu) ? answer.lengthMenu.join(', ') : 'not set'}`);
  }
  return lines.join('\n');
}
