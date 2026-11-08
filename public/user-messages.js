// Shared wording for messages that affect saving, submission and recovery.
// Error codes remain available to callers; they are not part of the visible text.
export const savedAnswerRule = 'Answers save as you work. When you finish or time runs out, saved answers are submitted automatically. If you have used all tries for a question, your last submitted answer is kept.';

export function finishReviewMessage({ unanswered = 0, pending = 0, hasPreviousSubmissions = false } = {}) {
  const parts = [];
  if (pending) parts.push(`${pending} ${pending === 1 ? 'question has' : 'questions have'} changes that are not saved yet. Open ${pending === 1 ? 'that question' : 'those questions'} and wait for “Saved” before finishing.`);
  if (unanswered) parts.push(`${unanswered} ${unanswered === 1 ? 'question has' : 'questions have'} no saved answer. Unanswered questions receive no points.`);
  if (!pending && !unanswered) parts.push('All your answers are saved. You can finish when you are ready.');
  if (!pending && unanswered) parts.push('You can return to these questions or finish now.');
  if (hasPreviousSubmissions) parts.push('If you have used all tries for a question, your last submitted answer is kept. Otherwise, submitting a changed answer uses another try and any listed point or time deduction applies.');
  parts.push('You cannot change answers after finishing.');
  return parts.join(' ');
}

export function completionMessage(session) {
  if (session.failedCodingCount) return 'Your activity is finished, but some answers could not be processed. Your submitted work is saved. Tell your instructor so they can finish processing it.';
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
    SESSION_CLOSED: 'Your time to answer has ended. Open the results page to see your submission status.',
    LOCKED: 'This section is not open yet. Submit an answer to each question in the previous section first.',
    ATTEMPT_LIMIT: 'You have used all tries for this question. Your last submitted answer is kept.',
    DRAFT_CONFLICT: 'This answer was changed in another browser tab. Copy any changes you want to keep, then reload this page to see the latest saved answer.',
    DRAFT_CHANGED: 'This activity was changed in another tab. Keep a copy of your edits, then refresh the activity before saving again.',
    INVALID_IDEMPOTENCY_KEY: 'We could not confirm this submission. Keep a copy of your answer, reload the page and try again.',
    IDEMPOTENCY_CONFLICT: 'A different answer was already sent from another request. Keep a copy of your changes, then reload to check the latest submission before trying again.',
    INVALID_JSON: 'We could not read the information sent. Try again. If it still fails, reload the page.',
    INVALID_ORIGIN: `This page cannot connect securely. Open the activity using the link provided by ${contact}.`,
    INVALID_SESSION: 'Your sign-in could not be confirmed. Sign in again to continue.',
    CODE_RUNNER_BUSY: 'Code running is busy. Wait a moment and try again.',
    TERMINAL_BUSY: 'Code running is busy. Wait a moment and try again.',
    TERMINAL_RUNNING: 'Stop the program that is already running, then try again.',
    TERMINAL_ENDED: 'This program has stopped. Select Run code to start it again.',
    WEB_CAPACITY: 'Project previews are busy. Wait a moment, then open the preview again.',
    WEB_WORKSPACE_ENDED: 'This preview has ended. Open a new preview to continue.',
    WEB_RUNTIME_UNAVAILABLE: `Project previews are temporarily unavailable. You can keep writing your answer. Tell ${contact} if you need a preview.`,
    TERMINAL_UNAVAILABLE: `Code running is temporarily unavailable. You can keep writing your answer. Tell ${contact} if you need to run it.`,
    CODE_RUNNER_UNAVAILABLE: `Code running is temporarily unavailable. You can keep writing your answer. Tell ${contact} if you need to run it.`,
    TERMINAL_UPDATE_REQUIRED: `Code running needs an update. You can keep writing your answer. Ask ${contact} for help.`,
    INVALID_DRAFT: 'We could not save this answer. Check the answer and try saving again.',
    INVALID_CODE_CONFIG: role === 'faculty' ? 'This coding question has an incomplete setup. Edit or regenerate it before using it.' : 'This coding question is not ready to run. Tell your instructor.',
    TERMINAL_UNSUPPORTED: `Code running is not ready on this computer. Ask ${contact} for help.`,
    CODE_EXECUTION_REQUIRED: 'Use Run code to test this answer, then submit it for grading.',
    IMMUTABLE_VERSION: 'This activity is already published. Create an editable copy to make changes.',
    EXAM_NOT_PUBLISHED: 'Publish this activity before assigning it to a class.',
    REVIEW_PENDING: 'Some answers still need your grade. Open Review answers and save those grades before sharing scores.',
    GRADING_PENDING: 'Some answers are still being processed. Wait for them to finish before continuing.',
    AI_PAYMENT_REQUIRED: 'The selected AI service requires payment or prepaid credits. Ask your administrator to check the project billing balance, or choose another configured service. Retrying will not resolve this billing block.',
    AI_RATE_LIMITED: 'The selected AI service has reached its usage limit. Wait and try again, request fewer questions, or choose another service yourself.',
    AI_NOT_CONFIGURED: 'The selected AI service is not ready to use. Choose another service or ask your technical administrator to set it up.',
    AI_GATEWAY_ERROR: 'The AI request lost its connection to the application server or proxy. The provider may still be processing it. Check server availability and proxy timeouts before generating again.',
    INVALID_SERVER_RESPONSE: 'The application server returned an unreadable response. Ask your technical administrator to check the server.',
    INTERNAL_ERROR: 'The application encountered an internal error. Ask your technical administrator to check the server logs.',
    AI_REQUEST_REJECTED: 'The AI service rejected the request settings. Ask your administrator to check model and schema compatibility.',
    AI_MODEL_UNAVAILABLE: 'The selected AI model is unavailable. Choose another supported model.',
    AI_TIMEOUT: 'The AI service took too long to respond. Try again with fewer questions.',
    AI_PROVIDER_ERROR: 'The selected AI service could not complete this request. Try again or choose another service yourself.',
    AI_PROVIDER_BUSY: 'The selected AI service is busy. Wait a moment and try again, or choose another service yourself.',
    AI_OUTPUT_TRUNCATED: 'The AI stopped before completing all questions. Try generating fewer questions at a time.',
    AI_INVALID_JSON: 'The AI returned a question format we could not use. Try again or choose another model.',
    AI_EMPTY: 'The AI returned no questions. Try again or choose another model.',
    AI_BLOCKED: 'The AI could not create questions from this request. Review the source material and instructions, then try again.',
    AI_INPUT_TOO_LARGE: 'This source is too long for the selected AI model. Use a shorter source or choose another model.',
    RATE_LIMITED: 'Too many requests were sent in a short time. Wait a moment and try again.',
    TOO_LARGE: 'This file or answer is too large. Use a smaller file or shorten the answer, then try again.',
    DRAFT_TOO_LARGE: 'This answer is too large to save. Shorten it or remove unneeded project files, then try saving again.',
  };
  if (code === 'CODING_JOB_PENDING') return role === 'student' ? 'Your previous code submission is still being processed. Wait for it to finish before submitting again.' : 'Some submitted answers are still being processed. Wait a moment, then refresh the results.';
  if (code === 'RUN_CLOSED') return role === 'faculty' ? questionIssueText(message || 'This class activity has ended. Check its closing time before continuing.') : `This activity is not open now. Check its opening and closing times with ${contact}.`;
  if (code === 'RATE_LIMITED' && Number(error?.retryAfterSeconds) > 0) return `This account has reached the request limit. Try again in ${Math.ceil(Number(error.retryAfterSeconds) / 60)} minute(s).`;
  if (messages[code]) return messages[code];
  if (error?.status >= 500 || /Cannot read properties|is not a function|fetch failed|Failed to fetch|NetworkError|Unexpected (?:token|end)|Load failed/i.test(message))
    return `We could not complete this action. Check your connection and try again. If it still fails, tell ${contact}.`;
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
  if (!codeUnavailable && !previewUnavailable) return role === 'faculty' ? 'Code running and project previews are ready.' : '';
  const detail = codeUnavailable ? 'Code running is temporarily unavailable.' : 'Some project previews are temporarily unavailable.';
  return role === 'faculty' ? `${detail} Students can keep writing and saving answers. Ask your technical administrator to check the code-running service, then select Refresh service status.`
    : `${detail} You can keep writing and saving your answers. Tell your instructor if you need to run code or open a project preview.`;
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
