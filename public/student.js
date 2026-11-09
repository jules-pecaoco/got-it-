import { apiError, userErrorMessage, savedAnswerRule, finishReviewMessage, completionMessage, codeServiceMessage } from './user-messages.js';
import { parseTableCode } from './table-code.js';
import { inspectRows, filterTableRows, datatableColumnTypes, compareTableCells } from './table-state.js';
import { normalizeSyntax, syntaxLanguages, tokenizeCode } from './code-highlight.js';
import { renderPrompt } from './prompt-code.js';
import { renderCodingQuestion } from './code-task-ui.js';
import { beginRequestStatus } from './request-status.js';
import { studentRequestLabel } from './request-labels.js';
import { icon } from './icons.js';
import { installPasswordToggles } from './password-toggle.js';
import { retryPolicyText, localDateTime } from './ui-model.js';
import { browserSessionHeaders, randomId } from './browser-session.js';
import { localDraft, clearLocalDrafts } from './local-drafts.js';
import { mountWeb } from '/assets/workspaces.js';
import { createReferenceDictionary } from './reference-dictionary.js';
import { referenceTopics } from './reference-topics.js';

installPasswordToggles();

const $ = id => document.getElementById(id);
const dictionary = createReferenceDictionary($('open-reference-dictionary'), $('reference-dictionary'), request);
const state = {
  candidateAccess: randomId(),
  session: null,
  mission: null,
  joining: false,
  finalizing: false,
  resultsRefreshing: false,
  liveTerminalAvailable: false,
  fullscreenFallback: false,
  readiness: null, draftEditors: new Map(), timerWarnings: new Set(), serverClock: null
};

const node = (tag, className, content) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = String(content);
  return element;
};
const clear = element => element.replaceChildren();

function syncFullscreenGate() {
  const active = state.session?.status === 'in_progress' && !$('exam-panel').classList.contains('hidden');
  const gated = active && !state.fullscreenFallback && document.fullscreenElement !== document.documentElement;
  const gate = $('fullscreen-gate');
  const wasHidden = gate.classList.contains('hidden');
  if (gated) $('ibt-review-dialog').close();
  gate.classList.toggle('hidden', !gated);
  $('exam-grid').inert = gated;
  $('exam-footer').inert = gated;
  $('fullscreen-fallback').classList.toggle('hidden', !gated || document.fullscreenEnabled);
  if (gated && wasHidden) $('enter-fullscreen').focus();
}

$('enter-fullscreen').addEventListener('click', async () => {
  try {
    if (!document.fullscreenEnabled) throw new Error('Fullscreen is unavailable in this browser.');
    await document.documentElement.requestFullscreen();
    syncFullscreenGate();
  } catch {
    $('fullscreen-fallback').classList.remove('hidden');
    message('Fullscreen is unavailable here. You can continue without it.');
  }
});
$('fullscreen-fallback').addEventListener('click', () => {
  state.fullscreenFallback = true;
  syncFullscreenGate();
});
document.addEventListener('fullscreenchange', syncFullscreenGate);

let noticeTimer;
const message = (text, { persistent = false } = {}) => {
  clearTimeout(noticeTimer);
  const box = $('notice');
  box.textContent = text;
  if (text && !persistent) noticeTimer = window.setTimeout(() => { if (box.textContent === text) box.textContent = ''; }, 7000);
};
function statusNotice(id, text = '') {
  const box = $(id);
  if (box.textContent !== text) box.textContent = text;
  box.classList.toggle('hidden', !text);
}
let checkingRuntime = false;
async function refreshRuntimeStatus() {
  const session = state.session;
  if (checkingRuntime || !session || (session.status !== 'in_progress' && !session.pendingCodingCount)) return;
  const languages = session.codingLanguages ?? [];
  if (!languages.length && !session.webProject) return;
  checkingRuntime = true;
  try {
    const status = await request('/api/me/code/status', { silent: true });
    if (state.session?.id !== session.id) return;
    statusNotice('student-runtime-status', codeServiceMessage(status, { languages, webProject: session.webProject }));
  } catch {
    if (state.session?.id === session.id)
      statusNotice('student-runtime-status', 'We could not check whether code running is available. Try again shortly, or tell your instructor.');
  } finally { checkingRuntime = false; }
}

async function request(path, { method = 'GET', data, headers: extraHeaders = {}, silent = false } = {}) {
  const finishStatus = silent ? () => {} : beginRequestStatus(studentRequestLabel(path));
  const headers = { ...browserSessionHeaders('candidate'), ...extraHeaders };
  if (/^\/api\/me\/activities\/[^/]+\/preview$/.test(path)) headers.Prefer = 'respond-async';
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const storageKey = `gotit:job:${state.session?.id}:${path}`;
    let job;
    if (headers.Prefer === 'respond-async') {
      try { const saved = JSON.parse(sessionStorage.getItem(storageKey)); if (saved?.payload === JSON.stringify(data)) job = saved; } catch { /* Storage is optional. */ }
    }
    let value;
    if (!job) {
      const response = await fetch(path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(35000) })
        .catch(() => { throw new Error('We could not connect to the activity. Check your connection and try again.'); });
      const result = await response.json().catch(() => { throw new Error('We could not load the activity. Try again or tell your instructor.'); });
      if (result.serverNow) state.serverClock = { at: Date.parse(result.serverNow), received: performance.now() };
      if (!response.ok) {
        if (response.status === 401 && state.session) {
          flushLocalAnswers();
          $('join-panel').classList.remove('hidden');
          $('exam-panel').classList.add('hidden');
          document.body.classList.remove('ibt-active');
          statusNotice('connection-status', 'Sign in again below to recover your saved work.');
        }
        throw apiError(result, 'student', response.status);
      }
      value = result.data;
      if (!value?.jobId || headers.Prefer !== 'respond-async') return value;
      job = { jobId: value.jobId, payload: JSON.stringify(data) };
      if (path.endsWith('/submit') && state.session) state.session.pendingCodingCount = 1;
      try { sessionStorage.setItem(storageKey, JSON.stringify(job)); } catch { /* Optional. */ }
    }
    let delay = 1000;
    while (true) {
      value = await request(`/api/me/coding-jobs/${encodeURIComponent(job.jobId)}`, { silent: true });
      if (value.status === 'done' || value.status === 'failed') {
        try { sessionStorage.removeItem(storageKey); } catch { /* Optional. */ }
        if (value.error) throw apiError(value.error, 'student');
        return value.result;
      }
      if (!silent) message(value.status === 'queued' ? (path.endsWith('/submit') ? 'Your code was received before the deadline. We are processing it now.' : 'Your code is waiting to run…') : 'Running your code…');
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(4000, delay + 500);
    }
  } finally { finishStatus(); }
}

const perform = async fn => {
  try { await fn(); } catch (error) { message(userErrorMessage(error, 'student'), { persistent: true }); }
};

async function loadConfig() {
  try {
    const config = await request('/api/config');
    state.liveTerminalAvailable = config.features?.liveTerminal === true;
    document.title = `${config.platformLabel} · Student`;
    $('platform-label').textContent = config.platformLabel;
    $('platform-tagline').textContent = config.platformTagline || 'Gotta Catch Ed All';
  } catch { /* use default label */ }
}

$('join-form').addEventListener('submit', event => {
  event.preventDefault();
  perform(async () => {
    if (state.joining) return;
    state.joining = true;
    const button = $('join-form').querySelector('button[type="submit"]');
    button.disabled = true;
    try {
    const details = await request('/api/auth/student/preview', {
      method: 'POST',
      data: admissionCredentials()
    });
    state.readiness = details;
    renderReadiness(details);
    } finally { state.joining = false; button.disabled = false; }
  });
});

function admissionCredentials() {
  return { runId: $('join-run').value.trim(), candidateId: $('candidate-id').value.trim(), pin: $('run-pin').value };
}

function renderReadiness(details) {
  $('join-panel').classList.add('hidden');
  $('readiness-panel').classList.remove('hidden');
  $('readiness-title').textContent = details.title;
  $('readiness-candidate').textContent = `${details.displayName} · ${details.section} · ${details.runName}`;
  const summary = $('readiness-summary'); clear(summary);
  const word = details.kind === 'ctf' ? 'missions' : 'sections';
  summary.append(node('strong', '', `${details.durationMinutes} minutes · ${details.questionCount} questions · ${details.sectionCount} ${word}`),
    node('p', 'small', `Activity closes ${localDateTime(details.closesAt)}. All attempts end by this time.`));
  const rules = $('readiness-rules'); clear(rules);
  const guideNames = referenceTopics.filter(topic => details.referenceGuides?.includes(topic.id)).map(topic => topic.label);
  rules.append(node('li', '', guideNames.length ? `Allowed reference guides: ${guideNames.join(', ')}.` : 'No programming reference guides are allowed for this assessment.'));
  for (const policy of details.retryPolicies)
    rules.append(node('li', '', `${details.retryPolicies.length > 1 ? `${policy.questionCount} questions: ` : ''}${retryPolicyText(policy)}`));
  rules.append(node('li', '', savedAnswerRule),
    node('li', '', details.feedbackMode === 'graded'
      ? 'Your instructor will share your score after grading. Until then, you will not see which answers are correct.'
      : 'This is practice. You will see a score after each answer, except answers that your instructor needs to grade.'));
  const completed = details.resumed && details.status !== 'in_progress';
  $('begin-attempt').textContent = completed ? 'View submission and score' : details.resumed ? 'Continue activity' : 'Start activity';
  $('begin-attempt').dataset.allowFallback = 'false';
  $('readiness-error').textContent = '';
  $('readiness-timing').textContent = completed ? 'This activity is finished. You can view your submission and score without starting again.'
    : details.resumed ? `Your timer is still running. You have about ${Math.floor(details.availableSeconds / 60)} minutes left. Continuing does not add more time.`
    : details.availableSeconds < details.durationMinutes * 60
      ? `This activity closes soon. You will have at most ${Math.floor(details.availableSeconds / 60)} minutes, rather than the full ${details.durationMinutes} minutes. Your timer has not started.`
      : 'Your timer has not started. Begin when you are ready.';
  $('readiness-fullscreen').classList.toggle('hidden', completed);
  $('readiness-fullscreen').textContent = document.fullscreenEnabled
    ? 'The activity uses fullscreen. Your timer begins after you select Start activity and continues if you leave the page.'
    : 'Fullscreen is unavailable in this browser. You can continue here. Your timer begins when you start and continues if you leave the page.';
  $('readiness-title').focus();
}

$('readiness-back').addEventListener('click', () => {
  state.readiness = null;
  $('readiness-panel').classList.add('hidden'); $('join-panel').classList.remove('hidden');
  $('candidate-id').focus();
});

$('begin-attempt').addEventListener('click', () => perform(async () => {
  if (state.joining || !state.readiness) return;
  const button = $('begin-attempt');
  state.joining = true; button.disabled = true;
  try {
    const active = !state.readiness.resumed || state.readiness.status === 'in_progress';
    state.fullscreenFallback = false;
    if (active && !document.fullscreenElement) {
      if (document.fullscreenEnabled && button.dataset.allowFallback !== 'true') {
        try { await document.documentElement.requestFullscreen(); }
        catch {
          $('readiness-error').textContent = 'Fullscreen could not open. You may continue without fullscreen in this browser.';
          button.dataset.allowFallback = 'true';
          button.textContent = state.readiness.resumed ? 'Resume without fullscreen' : 'Begin without fullscreen';
          return;
        }
      } else state.fullscreenFallback = true;
    }
    const joined = await request('/api/auth/student/join', { method: 'POST', data: admissionCredentials() });
    if (state.session) { flushLocalAnswers(); clearDraftEditors(); clearIbtState(); }
    state.candidateAccess = randomId();
    state.session = joined.session;
    state.timerWarnings.clear();
    $('timer-warning').classList.add('hidden');
    message(joined.resumed ? 'Welcome back. Your saved answers and original time limit are still in place.' : 'Your activity has started. The timer is running.');
    await showExam(joined.session);
    $('readiness-panel').classList.add('hidden');
  } catch (error) {
    $('readiness-error').textContent = userErrorMessage(error, 'student');
    message(userErrorMessage(error, 'student'), { persistent: true });
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } finally { state.joining = false; button.disabled = false; }
}));

async function flushDrafts() {
  const results = await Promise.allSettled([...state.draftEditors.values()].map(editor => editor.flush()));
  return results.every(result => result.status === 'fulfilled' && result.value !== false);
}
function clearDraftEditors() {
  for (const editor of state.draftEditors.values()) editor.dispose?.();
  state.draftEditors.clear();
}
window.addEventListener('offline', () => {
  if (state.session) statusNotice('connection-status', 'You are offline. Keep this page open. When your connection returns, wait for “Saved” before leaving.');
});
window.addEventListener('online', async () => {
  if (!state.session || state.session.status !== 'in_progress') return;
  if (!await flushDrafts()) message('You are connected again, but some answers are not saved yet. Select Try saving again beside those questions.');
  checkConnection();
});

function updateSaveStatus() {
  if (state.session && state.session.status !== 'in_progress') {
    $('save-status').textContent = 'This activity is finished. You cannot change or submit answers now.';
    return;
  }
  const editors = [...state.draftEditors.values()];
  const failed = editors.filter(editor => editor.status === 'failed').length;
  const pending = editors.some(editor => ['unsaved', 'saving'].includes(editor.status));
  const drafts = editors.filter(editor => editor.status === 'draft').length;
  const submitted = editors.filter(editor => editor.status === 'submitted').length;
  if (state.ibt) {
    const local = editors.some(editor => editor.localPending);
    $('ibt-save-status').textContent = failed ? (local ? 'Saved on this device only. Try saving again.' : 'Answer not saved. Try saving again.')
      : pending && local ? 'Saved on this device. Waiting to save online…'
      : pending ? 'Saving your answer…' : drafts || submitted ? 'Saved' : 'Your answers will save as you work.';
    renderQuestionMatrix();
  }
  $('save-status').textContent = failed ? `${failed} ${failed === 1 ? 'answer could' : 'answers could'} not be saved. Select Try saving again beside ${failed === 1 ? 'the question' : 'those questions'}.`
    : pending ? 'Some changes are still being saved. Check the message beside each answer.'
    : drafts ? `This section has ${drafts} saved ${drafts === 1 ? 'answer' : 'answers'} ready to submit when you finish.`
    : submitted ? `This section: ${submitted} ${submitted === 1 ? 'answer' : 'answers'} submitted${submitted === editors.length ? '. You can continue to the next question.' : ` · ${editors.length - submitted} not submitted.`}`
    : 'Answers save as you work. Finish the activity to submit your saved answers.';
}

async function leaveSession() {
  if (state.ibt?.opening || [...state.draftEditors.values()].some(editor => editor.submitting)) {
    message('Please wait until your answer finishes saving or submitting before leaving.');
    return;
  }
  if (!await flushDrafts()) { message('Some answers are not saved. Select Try saving again beside those questions before leaving.'); return; }
  try { await request('/api/me/logout', { method: 'POST' }); }
  catch (error) { if (error.status !== 401) throw error; }
  if (document.fullscreenElement === document.documentElement) document.exitFullscreen().catch(() => {});
  clearLocalDrafts(state.session.id);
  clearIbtState();
  state.candidateAccess = null;
  state.session = null;
  statusNotice('connection-status');
  statusNotice('student-runtime-status');
  dictionary.configure([], '');
  state.mission = null;
  clearDraftEditors();
  $('exam-panel').classList.add('hidden');
  $('join-panel').classList.remove('hidden');
  syncFullscreenGate();
}
$('candidate-exit').addEventListener('click', () => perform(leaveSession));
$('fullscreen-exit').addEventListener('click', () => perform(leaveSession));

async function finalizeAttempt() {
  if (state.finalizing || state.ibt?.opening || state.session?.status !== 'in_progress') return;
  if ([...state.draftEditors.values()].some(editor => editor.submitting)) {
    message('Your answer is still being submitted. Wait for confirmation before finishing.');
    return;
  }
  const prompt = `Finish this activity now? ${savedAnswerRule} You cannot change answers after finishing.`;
  if (!state.ibt && !window.confirm(prompt)) return;
  state.finalizing = true;
  $('exam-grid').inert = true;
  $('finalize').disabled = true;
  $('finalize-early').disabled = true;
  try {
    if (!await flushDrafts()) { message('Some answers are not saved. Select Try saving again beside those questions before finishing.'); return; }
    state.session = await request('/api/me/finalize', { method: 'POST', data: {} });
    renderExamHeader();
    renderCompletion();
  } finally {
    $('exam-grid').inert = false;
    $('finalize-early').disabled = false;
    state.finalizing = false;
    renderFlow();
  }
}
$('finalize').addEventListener('click', () => perform(finalizeAttempt));
$('finalize-early').addEventListener('click', () => perform(finalizeAttempt));
async function refreshResults({ background = false } = {}) {
  if (!state.candidateAccess || !state.session || state.session.status === 'in_progress' || state.resultsRefreshing) return;
  const access = state.candidateAccess, sessionId = state.session.id;
  state.resultsRefreshing = true;
  $('check-results').disabled = true;
  try {
    const session = await request('/api/me/results', { silent: background });
    // A response from an attempt that the student has left must not reopen it.
    if (state.candidateAccess !== access || state.session?.id !== sessionId) return;
    statusNotice('connection-status');
    const wasReleased = state.session.resultsReleased;
    state.session = session;
    renderExamHeader();
    if (session.status !== 'in_progress') renderCompletion();
    else await showExam();
    if (session.resultsReleased && !wasReleased) message('Your score is ready to view.');
    else if (!background && !session.resultsReleased) message('Your instructor has not shared your score yet. This page will check again automatically.');
  } catch (error) {
    if (state.candidateAccess === access && state.session?.id === sessionId)
      statusNotice('connection-status', `Could not refresh your results. ${error.message}`);
    if (!background) throw error;
  } finally {
    state.resultsRefreshing = false;
    $('check-results').disabled = false;
  }
}
$('check-results').addEventListener('click', () => perform(refreshResults));
$('refresh-score').addEventListener('click', () => perform(refreshResults));

function checkForPublishedResults() {
  if (document.hidden || (state.session?.resultsReleased && !state.session.pendingCodingCount)) return;
  void refreshResults({ background: true });
}
window.setInterval(checkForPublishedResults, 15000);
let checkingConnection = false;
async function checkConnection() {
  const session = state.session;
  if (checkingConnection || document.hidden || session?.status !== 'in_progress') return;
  checkingConnection = true;
  try {
    const heartbeat = await request('/api/me/heartbeat', { method: 'POST', silent: true });
    if (state.session?.id === session.id && heartbeat.deadlineAt) { state.session.deadlineAt = heartbeat.deadlineAt; updateTimer(); }
    if (state.session?.id === session.id && state.session.status === 'in_progress') statusNotice('connection-status');
  } catch (error) {
    if (state.session?.id === session.id && state.session.status === 'in_progress')
      statusNotice('connection-status', error.status === 401
        ? 'Your sign-in expired. Keep this page open and tell your instructor so you can resume.'
        : 'Your connection was interrupted. Keep this page open. When it returns, wait for Saved before leaving.');
  } finally {
    checkingConnection = false;
  }
}
window.setInterval(checkConnection, 15000);
window.setInterval(() => { if (!document.hidden) refreshRuntimeStatus(); }, 30000);
window.addEventListener('focus', checkForPublishedResults);
document.addEventListener('visibilitychange', checkForPublishedResults);
$('continue-mission').addEventListener('click', () => perform(async () => {
  const next = state.session?.order.find(item => item.unlocked && !item.completed);
  if (!next) return;
  await loadMission(next.id);
  $('mission-content').scrollIntoView({ block: 'start' });
}));

async function showExam(session) {
  state.session = session ?? await request('/api/me/session');
  void refreshRuntimeStatus();
  $('join-panel').classList.add('hidden');
  $('exam-panel').classList.remove('hidden');
  renderExamHeader();
  if (state.session.status !== 'in_progress') { renderCompletion(); syncFullscreenGate(); return; }
  $('exam-grid').classList.remove('hidden');
  $('exam-footer').classList.remove('hidden');
  $('completion-panel').classList.add('hidden');
  if (Array.isArray(state.session.questions)) {
    startIbt();
    const current = state.session.questions.find(q => q.id === state.ibt.current);
    const saved = new Set(state.session.savedAnswers);
    const available = state.session.questions;
    const first = current || available.find(q => !saved.has(q.id)) || available[0];
    if (first) await openQuestion(first.id);
    else renderQuestionMatrix();
    syncFullscreenGate();
    return;
  }
  const first = state.session.order.find(x => x.unlocked && !x.completed) || state.session.order.findLast(x => x.unlocked);
  if (first) await loadMission(first.id);
  else renderMissionList();
  syncFullscreenGate();
}

function renderExamHeader() {
  const s = state.session;
  $('group-heading').textContent = s.kind === 'ctf' ? 'Missions' : 'Sections';
  $('exam-title').textContent = s.title;
  $('exam-description').textContent = s.description || '';
  $('candidate-name').textContent = `${s.displayName} (${s.section})`;
  $('score').textContent = s.resultsReleased ? `${s.score} / ${s.maxPoints} pts` : 'Your instructor has not shared your score yet.';
  // Scores can only be published after an attempt ends; the completion screen provides refresh.
  $('refresh-score').classList.add('hidden');
  renderFlow();
  updateTimer();
}

function renderFlow() {
  dictionary.configure(state.session?.status === 'in_progress' ? state.session.referenceGuides || [] : [], state.session ? `${state.session.examId}@${state.session.version}` : '');
  if (!state.session) return;
  const s = state.session;
  const total = s.order.length, completed = s.order.filter(item => item.completed).length;
  const word = s.kind === 'ctf' ? 'mission' : 'section';
  $('exam-progress').textContent = `${completed} of ${total} ${word}${total === 1 ? '' : 's'} complete`;
  const active = s.status === 'in_progress';
  $('exam-panel').classList.toggle('attempt-active', active);
  const current = s.order.find(item => item.id === state.mission?.id);
  const next = s.order.find(item => item.unlocked && !item.completed);
  const canContinue = !state.ibt && active && current?.completed && next && next.id !== current.id;
  $('continue-mission').classList.toggle('hidden', !canContinue);
  $('continue-mission').textContent = `Next ${word}`;
  $('finalize').classList.toggle('hidden', !!state.ibt || !active || completed !== total);
  $('finalize').disabled = !active || state.finalizing;
  $('finish-early').classList.toggle('hidden', !!state.ibt || !active || completed === total);
  if (!active || completed === total) $('finish-early').open = false;
  if (state.ibt && active) renderQuestionMatrix();
}

function updateTimer() {
  if (!state.session) return;
  if (state.session.status === 'submitted') {
    $('timer').textContent = 'Finished';
    return;
  }
  const now = state.serverClock ? state.serverClock.at + performance.now() - state.serverClock.received : Date.now();
  const remaining = Math.max(0, Date.parse(state.session.deadlineAt) - now);
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor(remaining / 1000) % 60;
  $('timer').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  $('timer').classList.toggle('timer-urgent', remaining > 0 && remaining <= 60000);
  for (const threshold of [300000, 60000]) {
    if (remaining > 0 && remaining <= threshold && !state.timerWarnings.has(threshold)) {
      state.timerWarnings.add(threshold);
      $('timer-warning').textContent = `${threshold === 60000 ? 'Less than 1 minute' : 'Less than 5 minutes'} remaining. Check that your answers say Saved. Saved answers are submitted automatically when time runs out. If you have used all tries for a question, your last submitted answer is kept.`;
      $('timer-warning').classList.remove('hidden');
    }
  }
  if (remaining === 0 && state.session.status === 'in_progress') {
    state.session.status = 'expired';
    state.session.resultsReleased = false;
    renderCompletion();
    checkForPublishedResults();
  }
}
window.setInterval(updateTimer, 1000);

function renderMissionList() {
  if (state.ibt) { renderQuestionMatrix(); return; }
  clear($('mission-list'));
  clear($('mobile-mission-select'));
  document.querySelector('.mobile-mission-nav').firstChild.textContent = state.session.kind === 'ctf' ? 'Current mission' : 'Current section';
  state.session.order.forEach((m, i) => {
    const button = node('button', 'mission-button', `${String(i + 1).padStart(2, '0')} · ${m.title}`);
    button.type = 'button';
    const active = state.mission?.id === m.id;
    button.disabled = !m.unlocked || active;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'step');
    const status = m.completed ? 'Completed' : active ? 'Current' : m.unlocked ? 'Available' : 'Locked';
    const option = node('option', '', `${i + 1} · ${m.title} · ${status}`);
    option.value = m.id; option.disabled = !m.unlocked; option.selected = active;
    $('mobile-mission-select').append(option);
    const stateLabel = node('small', 'mission-state');
    stateLabel.append(icon(m.completed ? 'complete' : active ? 'current' : m.unlocked ? 'available' : 'locked'), document.createTextNode(status));
    button.append(stateLabel);
    button.addEventListener('click', () => perform(() => loadMission(m.id)));
    $('mission-list').append(button);
  });
}

function startIbt() {
  const s = state.session;
  const key = `gotit:ibt:v1:${s.id}:${s.version}`;
  let saved;
  try { saved = JSON.parse(localStorage.getItem(key)); } catch { /* Optional storage. */ }
  state.ibt = {
    key, current: saved?.current, mounted: null, opening: false,
    visited: new Set(Array.isArray(saved?.visited) ? saved.visited : []),
    flagged: new Set(Array.isArray(saved?.flagged) ? saved.flagged : []), filter: saved?.filter || "all", groups: new Map(),
    split: Number.isFinite(saved?.split) ? saved.split : (s.codingLanguages?.length || s.webProject ? 25 : 40),
    collapsed: saved?.collapsed === true || (saved?.collapsed === undefined && matchMedia("(max-width: 850px)").matches)
  };
  document.body.classList.add('ibt-active');
  for (const id of ['ibt-matrix', 'ibt-context', 'ibt-divider', 'ibt-actions', 'ibt-save-status', 'ibt-progress']) $(id).classList.remove('hidden');
  $('mission-list').classList.add('hidden');
  $('group-heading').classList.add('hidden');
  setIbtSplit(state.ibt.split);
  renderFlow();
}

function persistIbtState() {
  const { key, current, visited, flagged, filter, split, collapsed } = state.ibt;
  try {
    localStorage.setItem(key, JSON.stringify({ current, visited: [...visited], flagged: [...flagged], filter, split, collapsed }));
  } catch { /* Answer saves and navigation still work. */ }
}

function clearIbtState() {
  if (!state.ibt) return;
  $('ibt-review-dialog').close();
  try { localStorage.removeItem(state.ibt.key); } catch { /* Optional storage. */ }
  state.ibt = null;
  document.body.classList.remove('ibt-active');
  for (const id of ['ibt-matrix', 'ibt-context', 'ibt-divider', 'ibt-actions', 'ibt-save-status', 'ibt-progress']) $(id).classList.add('hidden');
  $('mission-list').classList.remove('hidden');
  $('group-heading').classList.remove('hidden');
  const reference = $('collapsible-reference');
  if (reference.parentElement === $('ibt-context')) $('mission-content').after(reference);
}

function updateSavedAnswer(id, answered) {
  const saved = new Set(state.session.savedAnswers);
  if (answered) saved.add(id);
  else saved.delete(id);
  state.session.savedAnswers = [...saved];
}

function questionStatuses() {
  const acknowledged = new Set(state.session.savedAnswers);
  return state.session.questions.map((q, index) => {
    const editor = state.draftEditors.get(q.id);
    const pending = ['unsaved', 'saving', 'failed'].includes(editor?.status)
      || (!editor && !!localDraft(state.session.id, q.id).read());
    const answered = acknowledged.has(q.id);
    return { ...q, number: index + 1, answered, pending };
  });
}

function renderQuestionMatrix() {
  const ibt = state.ibt;
  if (!ibt) return;
  const questions = questionStatuses();
  const current = questions.findIndex(q => q.id === ibt.current);
  const answered = questions.filter(q => q.answered).length;
  $('exam-progress').textContent = `${answered} of ${questions.length} saved`;
  $('ibt-progress').max = questions.length || 1;
  $('ibt-progress').value = answered;
  $('ibt-matrix-body').classList.toggle('hidden', ibt.collapsed);
  $('exam-grid').classList.toggle('ibt-collapsed', ibt.collapsed);
  $('ibt-toggle-matrix').setAttribute('aria-expanded', String(!ibt.collapsed));
  $('ibt-toggle-matrix').replaceChildren(icon('panelLeft'));
  $('ibt-sidebar-title').classList.toggle('hidden', ibt.collapsed);
  $('ibt-toggle-matrix').setAttribute('aria-label', ibt.collapsed ? 'Show questions' : 'Hide questions');
  const list = $('ibt-question-list');
  const focused = list.contains(document.activeElement) ? document.activeElement.dataset.question : null;
  list.replaceChildren(...questions.map(q => {
    const status = q.answered ? 'answered' : ibt.visited.has(q.id) ? 'empty' : 'unvisited';
    const button = node('button', 'ibt-question', `Question ${q.number}${ibt.flagged.has(q.id) ? ' · Flagged' : ''}${q.pending ? ' · Saving' : q.answered ? ' · Saved' : ''}`);
    button.type = 'button';
    button.dataset.state = status;
    button.dataset.question = q.id;
    button.setAttribute('aria-label', `Question ${q.number}, ${q.answered ? 'answer saved' : status === 'unvisited' ? 'not opened yet' : 'no saved answer'}${q.pending ? ', latest changes not saved yet' : ''}${ibt.flagged.has(q.id) ? ', flagged for review' : ''}`);
    button.replaceChildren(icon(q.answered ? 'complete' : 'question'), node('span', 'ibt-question-label', `Question ${q.number}`));
    if (ibt.flagged.has(q.id)) button.append(icon('flag'));
    if (q.pending) button.append(node('span', 'ibt-question-state', 'Saving…'));
    if (q.id === ibt.current) {
      button.setAttribute('aria-current', 'step');
      button.append(node('span', 'ibt-current-badge', 'Current'));
    }
    button.addEventListener('click', () => perform(() => openQuestion(q.id)));
    return button;
  }));
  const buttons = [...list.children];
  list.replaceChildren();
  for (const mission of state.session.order) {
    const items = questions.filter(q => q.missionId === mission.id);
    const shown = items.filter(q => ibt.filter === 'flagged' ? ibt.flagged.has(q.id) : ibt.filter === 'unanswered' ? !q.answered : true);
    if (!shown.length) continue;
    const group = node('details', 'ibt-section');
    group.open = ibt.groups.get(mission.id) !== false;
    const summary = node('summary', 'ibt-section-heading');
    const copy = node('span', 'ibt-section-copy');
    copy.append(node('span', 'ibt-section-title', mission.title), node('span', 'ibt-section-meta', `${items.filter(q => q.answered).length} of ${items.length} saved`));
    summary.append(icon('chevronRight'), copy);
    const flaggedCount = items.filter(q => ibt.flagged.has(q.id)).length;
    if (flaggedCount) { const badge = node('span', 'ibt-section-flags', flaggedCount); badge.append(icon('flag')); badge.setAttribute('aria-label', `${flaggedCount} flagged`); summary.append(badge); }
    group.append(summary);
    for (const q of shown) group.append(buttons[questions.indexOf(q)]);
    group.addEventListener('toggle', () => { if (group.isConnected) ibt.groups.set(mission.id, group.open); });
    list.append(group);
  }
  if (!list.children.length) list.append(node('p', 'small', 'No questions match this filter.'));
  const progress = $('ibt-section-progress'); progress.replaceChildren();
  for (const [label, count, symbol] of [['Saved', answered, 'complete'], ['Remaining', questions.length - answered, 'question'], ['Flagged', questions.filter(q => ibt.flagged.has(q.id)).length, 'flag']]) {
    const item = node('div', 'ibt-progress-item'); item.append(icon(symbol), node('strong', '', count), node('span', '', label)); progress.append(item);
  }
  $('ibt-filter').value = ibt.filter;
  if (focused) list.querySelector(`[data-question="${focused}"]`)?.focus({ preventScroll: true });
  $('ibt-previous').disabled = current <= 0;
  $('ibt-next').disabled = current >= questions.length - 1;
}

function flushLocalAnswers() {
  for (const editor of state.draftEditors.values()) editor.flushLocal?.();
}
window.addEventListener('pagehide', flushLocalAnswers);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushLocalAnswers(); });

async function openQuestion(id) {
  const ibt = state.ibt;
  const question = state.session.questions.find(q => q.id === id);
  if (!ibt || !question || ibt.opening || ibt.mounted === id || state.finalizing) return;
  if ([...state.draftEditors.values()].some(editor => editor.submitting)) {
    message('Your answer is still being submitted. Wait for confirmation before opening another question.');
    return;
  }
  ibt.opening = true;
  try {
    flushLocalAnswers();
    if (!await flushDrafts()) { message('Select Try saving again before opening another question.'); return; }
    const mission = await request(`/api/me/missions/${encodeURIComponent(question.missionId)}`);
    const activity = mission.activities.find(a => a.id === id);
    if (!activity || state.ibt !== ibt || state.session.status !== 'in_progress') return;
    if ([...state.draftEditors.values()].some(editor => editor.submitting)) return;
    // A candidate can continue typing while the next question is loading.
    flushLocalAnswers();
    if (!await flushDrafts() || state.ibt !== ibt || state.session.status !== 'in_progress') return;
    if ([...state.draftEditors.values()].some(editor => ['unsaved', 'saving', 'failed'].includes(editor.status) || editor.submitting)) return;
    clearDraftEditors();
    state.mission = mission;
    ibt.current = ibt.mounted = id;
    ibt.visited.add(id);
    persistIbtState();
    const number = state.session.questions.indexOf(question) + 1;
    const heading = node('h2', '', `Question ${number} · ${mission.title}`);
    heading.tabIndex = -1;
    const context = $('ibt-context');
    const reference = $('collapsible-reference');
    const flagLabel = node('label', 'ibt-flag');
    const flag = node('input'); flag.type = 'checkbox'; flag.checked = ibt.flagged.has(id);
    flag.addEventListener('change', () => { if (flag.checked) ibt.flagged.add(id); else ibt.flagged.delete(id); persistIbtState(); renderQuestionMatrix(); });
    flagLabel.append(flag, document.createTextNode('Flag for review'));
    context.replaceChildren(heading, flagLabel);
    if (mission.story) context.append(node('p', '', mission.story));
    context.append(renderPrompt(activity.prompt, 'activity-prompt'), reference);
    renderActivityReference(activity);
    const workspaceLabel = ['code_writing', 'web_project', 'datatable_code'].includes(activity.type) ? 'Your code' : 'Your answer';
    $('mission-content').replaceChildren(node('h2', 'ibt-workspace-heading', workspaceLabel), renderActivity(activity, false, true));
    context.scrollTop = 0;
    $('mission-content').closest('.activity-area').scrollTop = 0;
    updateSaveStatus();
    heading.focus({ preventScroll: true });
  } finally {
    ibt.opening = false;
  }
}

$('ibt-filter').addEventListener('change', () => { state.ibt.filter = $('ibt-filter').value; persistIbtState(); renderQuestionMatrix(); });
$('ibt-toggle-matrix').addEventListener('click', () => {
  state.ibt.collapsed = !state.ibt.collapsed;
  persistIbtState();
  renderQuestionMatrix();
});

const ibtDivider = $('ibt-divider');
const ibtStacked = matchMedia('(max-width: 850px)');
function setIbtSplit(value) {
  const split = Math.round(Math.max(20, Math.min(75, value)));
  state.ibt.split = split;
  $('exam-grid').style.setProperty('--ibt-context-size', `${split}fr`);
  $('exam-grid').style.setProperty('--ibt-workspace-size', `${100 - split}fr`);
  ibtDivider.setAttribute('aria-valuenow', String(split));
  ibtDivider.setAttribute('aria-valuetext', `Question pane ${split}%`);
}
function updateIbtDividerOrientation() {
  ibtDivider.setAttribute('aria-orientation', 'horizontal');
}
ibtStacked.addEventListener('change', updateIbtDividerOrientation);
updateIbtDividerOrientation();

ibtDivider.addEventListener('pointerdown', event => {
  if (!state.ibt || !event.isPrimary || event.button !== 0) return;
  ibtDivider.focus({ preventScroll: true });
  ibtDivider.setPointerCapture(event.pointerId);
});
ibtDivider.addEventListener('pointermove', event => {
  if (!state.ibt || !ibtDivider.hasPointerCapture(event.pointerId)) return;
  const context = $('ibt-context').getBoundingClientRect();
  const workspace = $('exam-workspace').getBoundingClientRect();
  const divider = ibtDivider.getBoundingClientRect();
  const vertical = true;
  const start = vertical ? context.top : context.left;
  const end = vertical ? workspace.bottom : workspace.right;
  const thickness = vertical ? divider.height : divider.width;
  const position = vertical ? event.clientY : event.clientX;
  const available = end - start - thickness;
  if (available > 0) setIbtSplit((position - start - thickness / 2) * 100 / available);
});
ibtDivider.addEventListener('lostpointercapture', () => {
  if (state.ibt) persistIbtState();
});
ibtDivider.addEventListener('keydown', event => {
  if (!state.ibt) return;
  const decrease = 'ArrowUp';
  const increase = 'ArrowDown';
  const step = event.shiftKey ? 10 : 2;
  const sizes = { [decrease]: state.ibt.split - step, [increase]: state.ibt.split + step, Home: 20, End: 75 };
  if (!Object.hasOwn(sizes, event.key)) return;
  event.preventDefault();
  setIbtSplit(sizes[event.key]);
  persistIbtState();
});

for (const [button, offset] of [['ibt-previous', -1], ['ibt-next', 1]]) {
  $(button).addEventListener('click', () => perform(async () => {
    const available = state.session.questions;
    const index = available.findIndex(q => q.id === state.ibt.current);
    if (available[index + offset]) await openQuestion(available[index + offset].id);
  }));
}
$('ibt-review').addEventListener('click', () => {
  const questions = questionStatuses();
  const unsaved = questions.filter(q => !q.answered).length;
  const pending = questions.filter(q => q.pending).length;
  $('ibt-review-summary').textContent = finishReviewMessage({ unanswered: unsaved, pending, hasPreviousSubmissions: state.session.submittedCount > 0 });
  $('ibt-review-questions').replaceChildren(...questions.filter(q => !q.answered || q.pending || state.ibt.flagged.has(q.id)).map(q => {
    const button = node('button', '', `Question ${q.number}${state.ibt.flagged.has(q.id) ? ' · Flagged' : ''}${q.pending ? ' · Not saved yet' : ''}`);
    button.type = 'button';
    button.addEventListener('click', () => {
      $('ibt-review-dialog').close();
      perform(() => openQuestion(q.id));
    });
    return button;
  }));
  $('ibt-review-dialog').showModal();
});
$('ibt-confirm-finish').addEventListener('click', () => {
  $('ibt-review-dialog').close();
  perform(finalizeAttempt);
});

let missionLoad = 0;
async function loadMission(id) {
  if (state.finalizing || [...state.draftEditors.values()].some(editor => editor.submitting)) return;
  const access = state.candidateAccess;
  const load = ++missionLoad;
  const current = () => load === missionLoad && state.candidateAccess === access && state.session?.status === 'in_progress' && !state.finalizing;
  if (!await flushDrafts() || !current()) return;
  const mission = await request(`/api/me/missions/${encodeURIComponent(id)}`);
  if (!current() || [...state.draftEditors.values()].some(editor => editor.submitting)) return;
  if (!await flushDrafts() || !current()) return;
  if ([...state.draftEditors.values()].some(editor => ['unsaved', 'saving', 'failed'].includes(editor.status) || editor.submitting)) return;
  state.mission = mission;
  clearDraftEditors();
  renderMissionList();
  renderMission();
  renderFlow();
  updateSaveStatus();
  syncFullscreenGate();
}

$('mobile-mission-select').addEventListener('change', () => perform(() => loadMission($('mobile-mission-select').value)));

window.addEventListener('beforeunload', event => {
  if (state.session?.status !== 'in_progress') return;
  if ([...state.draftEditors.values()].some(editor => ['unsaved', 'saving', 'failed'].includes(editor.status))) {
    event.preventDefault(); event.returnValue = '';
  }
});

function renderMission() {
  const mission = state.mission;
  if (!mission) return;
  const area = $('mission-content');
  clear(area);
  area.append(node('h2', '', mission.title));
  if (mission.story) area.append(node('p', '', mission.story));
  for (const activity of mission.activities) area.append(renderActivity(activity));

  renderActivityReference(mission.activities.find(a => a.publicConfig?.apiReference || a.publicConfig?.columns));
}

function renderActivityReference(activity) {
  const refDetails = $('collapsible-reference');
  refDetails.open = false;
  const context = $('context-content');
  clear(context);
  const reference = activity?.publicConfig;
  if (reference && (reference.apiReference || reference.columns)) {
    refDetails.classList.remove('hidden');
    if (reference.columns) {
      context.append(node('h3', '', 'Table Columns'));
      const columns = node('table'), body = node('tbody');
      reference.columns.forEach((column, index) => {
        const row = node('tr');
        row.append(node('td', '', `Index ${index}`), node('td', '', column.label));
        body.append(row);
      });
      columns.append(body);
      context.append(columns);
    }
    if (reference.apiReference) {
      context.append(node('h3', '', 'API Reference'));
      const api = node('table'), apiBody = node('tbody');
      for (const item of reference.apiReference) {
        const row = node('tr');
        row.append(node('td', '', item.api), node('td', '', item.use));
        apiBody.append(row);
      }
      api.append(apiBody);
      context.append(api);
    }
  } else {
    refDetails.classList.add('hidden');
  }
}

function renderInspection(form, activity) {
  const config = activity.publicConfig;
  const saved = activity.lastDraft?.value ?? activity.lastSubmission?.value;
  const controls = node('div', 'inspection-controls');
  const field = (labelText, control) => {
    const label = node('label', '', labelText);
    label.append(control);
    controls.append(label);
    return control;
  };
  const makeSelect = (options, chosen) => {
    const select = node('select');
    for (const [val, lab] of options) {
      const opt = node('option', '', lab);
      opt.value = String(val);
      select.append(opt);
    }
    select.value = String(chosen);
    return select;
  };
  const pageLength = field('Rows per page', makeSelect(config.pageLengths.map(x => [x, String(x)]), saved?.pageLength ?? config.pageLengths[0]));
  const globalSearch = node('input');
  globalSearch.type = 'search';
  globalSearch.value = saved?.globalSearch ?? '';
  globalSearch.placeholder = 'Search all columns';
  field('Global search', globalSearch);

  const columns = config.columns.map(x => [x.id, x.label]);
  const savedColumn = Object.entries(saved?.columnSearch ?? {})[0];
  const searchColumn = field('Column filter', makeSelect([['', 'None'], ...columns], savedColumn?.[0] ?? ''));
  const searchColumnTerm = node('input');
  searchColumnTerm.type = 'search';
  searchColumnTerm.value = savedColumn?.[1] ?? '';
  field('Column term', searchColumnTerm);

  const firstColumn = field('Primary sort', makeSelect(columns, saved?.order?.[0]?.column ?? columns[0][0]));
  const firstDirection = field('Direction', makeSelect([['asc', 'Ascending'], ['desc', 'Descending']], saved?.order?.[0]?.direction ?? 'asc'));
  const secondColumn = field('Secondary sort', makeSelect([['', 'None'], ...columns], saved?.order?.[1]?.column ?? ''));
  const secondDirection = field('Direction', makeSelect([['asc', 'Ascending'], ['desc', 'Descending']], saved?.order?.[1]?.direction ?? 'asc'));
  form.append(controls);

  const summary = node('p', 'small');
  const wrap = node('div', 'table-wrap');
  const table = node('table');
  const pager = node('div', 'button-row');
  const back = node('button', '', '← Previous');
  const next = node('button', '', 'Next →');
  back.type = next.type = 'button';
  pager.append(back, next);
  form.append(summary, wrap, pager);

  let pageIndex = saved?.pageIndex ?? 0;
  const value = () => ({
    pageLength: Number(pageLength.value),
    globalSearch: globalSearch.value,
    pageIndex,
    columnSearch: searchColumn.value && searchColumnTerm.value ? { [searchColumn.value]: searchColumnTerm.value } : {},
    order: [
      { column: firstColumn.value, direction: firstDirection.value },
      ...(secondColumn.value && secondColumn.value !== firstColumn.value ? [{ column: secondColumn.value, direction: secondDirection.value }] : [])
    ]
  });

  const render = () => {
    const current = value();
    const filteredCount = inspectRows(config, current).filteredCount;
    const pages = Math.max(1, Math.ceil(filteredCount / current.pageLength));
    pageIndex = Math.min(pageIndex, pages - 1);
    const rows = inspectRows(config, { ...current, pageIndex }).visible;
    summary.textContent = `${filteredCount} matching records · page ${pageIndex + 1} of ${pages}`;
    clear(table);
    const head = node('thead');
    const headRow = node('tr');
    for (const col of config.columns) headRow.append(node('th', '', col.label));
    head.append(headRow);
    table.append(head);
    const body = node('tbody');
    for (const record of rows) {
      const tr = node('tr');
      for (const col of config.columns) tr.append(node('td', '', record[col.id]));
      body.append(tr);
    }
    table.append(body);
    wrap.replaceChildren(table);
    back.disabled = pageIndex === 0;
    next.disabled = pageIndex >= pages - 1;
  };

  for (const control of [pageLength, globalSearch, searchColumn, searchColumnTerm, firstColumn, firstDirection, secondColumn, secondDirection]) {
    control.addEventListener([globalSearch, searchColumnTerm].includes(control) ? 'input' : 'change', () => {
      pageIndex = 0;
      render();
    });
  }
  const turnPage = step => {
    pageIndex += step;
    render();
    form.dispatchEvent(new Event('change'));
  };
  back.addEventListener('click', () => turnPage(-1));
  next.addEventListener('click', () => turnPage(1));
  render();

  return (draft = false) => {
    if (!draft && secondColumn.value && secondColumn.value === firstColumn.value) {
      throw new Error('Choose different primary and secondary sort columns.');
    }
    return value();
  };
}

function renderCode(form, activity) {
  const config = activity.publicConfig;
  const syntaxLabel = node('label', 'code-syntax-label', 'Syntax colors (display only)');
  const syntax = node('select');
  for (const [value, label] of syntaxLanguages) {
    const option = node('option', '', label);
    option.value = value;
    syntax.append(option);
  }
  syntax.value = normalizeSyntax(config.language);
  syntaxLabel.append(syntax);
  form.append(syntaxLabel);
  const editorShell = node('div', 'code-editor');
  const highlight = node('pre', 'code-highlight');
  highlight.setAttribute('aria-hidden', 'true');
  const editor = node('textarea');
  editor.rows = 16;
  editor.wrap = 'off';
  editor.spellcheck = false;
  editor.setAttribute('aria-label', 'DataTables JavaScript');
  editor.placeholder = 'Write DataTables JavaScript code here.';
  editor.value = activity.lastDraft?.value ?? activity.lastSubmission?.value ?? config.scaffold ?? '';
  const paintCode = () => {
    const value = editor.value;
    const fragment = document.createDocumentFragment();
    for (const part of tokenizeCode(value, syntax.value)) {
      fragment.append(part.type ? node('span', `code-${part.type}`, part.text)
        : document.createTextNode(part.text));
    }
    if (value.endsWith('\n')) fragment.append(document.createTextNode(' '));
    highlight.replaceChildren(fragment);
    highlight.scrollTop = editor.scrollTop;
    highlight.scrollLeft = editor.scrollLeft;
  };
  editor.addEventListener('input', paintCode);
  syntax.addEventListener('change', paintCode);
  editor.addEventListener('scroll', () => {
    highlight.scrollTop = editor.scrollTop;
    highlight.scrollLeft = editor.scrollLeft;
  });
  editorShell.append(highlight, editor);
  form.append(editorShell);
  paintCode();

  const run = node('button', '', 'Run code in preview');
  run.type = 'button';
  form.append(run);

  const messageEl = node('p', 'small');
  messageEl.setAttribute('role', 'status');
  form.append(messageEl);

  const wrap = node('div', 'table-wrap code-preview');
  form.append(wrap);

  let previewTable;
  const render = state => {
    if (typeof window.DataTable !== 'function') throw new Error('DataTables could not load. Refresh the page and try again.');
    if (previewTable) previewTable.destroy();
    wrap.replaceChildren();
    const table = node('table');
    table.className = 'display';
    table.id = 'studentTable';
    wrap.append(table);
    const columnIndex = id => config.columns.findIndex(column => column.id === id);
    const columnTypes = datatableColumnTypes(config);
    for (const type of ['numeric', 'string']) {
      window.DataTable.ext.type.order[`gotit-${type}-asc`] = (a, b) => compareTableCells(a, b, type);
      window.DataTable.ext.type.order[`gotit-${type}-desc`] = (a, b) => -compareTableCells(a, b, type);
    }
    previewTable = new window.DataTable(table, {
      paging: state.flags.paging,
      searching: state.flags.searching,
      ordering: state.flags.ordering,
      pageLength: state.pageLength,
      lengthMenu: state.lengthMenu,
      order: state.order.map(item => [columnIndex(item.column), item.direction]),
      data: config.rows.map(row => config.columns.map(column => String(row[column.id] ?? ''))),
      columns: config.columns.map(column => ({ title: node('span', '', column.label).innerHTML,
        type: `gotit-${columnTypes.get(column.id)}`, render: window.DataTable.render.text() }))
    });
    const visible = new Set(filterTableRows(config, state, { mode: 'datatable' }).map(row => row.id));
    previewTable.search((_search, _row, index) => visible.has(config.rows[index].id));
    previewTable.draw();
  };

  run.addEventListener('click', () => {
    try {
      render(parseTableCode(editor.value, config));
      messageEl.textContent = 'Code applied to DataTables preview.';
    } catch (error) {
      messageEl.textContent = userErrorMessage(error, 'student');
    }
  });
  try {
    render({ pageLength: 10, lengthMenu: [10, 25, 50], flags: { paging: true, searching: true, ordering: true }, globalSearch: '', columnSearch: {}, order: [{ column: config.columns[0].id, direction: 'asc' }] });
  } catch (error) {
    messageEl.textContent = userErrorMessage(error, 'student');
  }
  return () => {
    parseTableCode(editor.value, config);
    return editor.value;
  };
}

function renderActivity(a, preview = false, separatePrompt = false) {
  const recovery = !preview ? localDraft(state.session.id, a.id) : null;
  const recovered = recovery?.read();
  if (recovered && recovered.baseRevision === (a.lastDraft?.updatedAt ?? '')) {
    a.lastDraft = { ...recovered.response, updatedAt: recovered.baseRevision };
  }
  const card = node('article', 'activity-card');
  if (recovered && recovered.baseRevision !== (a.lastDraft?.updatedAt ?? '')) {
    const download = node('button', '', 'Download answer saved on this device'); download.type = 'button';
    download.addEventListener('click', () => {
      const link = node('a'); link.href = URL.createObjectURL(new Blob([JSON.stringify(recovered.response, null, 2)], { type: 'application/json' }));
      link.download = `${a.id}-unsynced.json`; link.click(); URL.revokeObjectURL(link.href);
    });
    card.append(node('p', 'small', 'There are changes saved only on this device, and they differ from the latest online answer. Download a copy before reloading or replacing your answer.'), download);
  }
  if (!separatePrompt) card.append(renderPrompt(a.prompt, 'activity-prompt'));
  const policy = a.attemptPolicy;
  const attemptInfo = node('p', 'small');
  const showPolicy = !preview && policy && (policy.maxRetries !== null || policy.pointPenalty || policy.timePenaltySeconds);
  const updateAttemptInfo = () => {
    if (!showPolicy) return;
    const limit = policy.maxRetries === null ? 'unlimited' : String(policy.maxRetries + 1);
    attemptInfo.textContent = `Submissions used: ${a.attemptsUsed}${policy.maxRetries === null ? ' (no limit)' : ` of ${limit}`}. ${retryPolicyText(policy)}`;
  };
  if (showPolicy) { updateAttemptInfo(); card.append(attemptInfo); }
  const form = node('form', 'activity-form');
  const cfg = a.publicConfig || {};
  const saved = a.lastDraft?.value ?? a.lastSubmission?.value;
  let readValue;

  if (a.type === 'single_choice' || a.type === 'multiple_choice' || a.type === 'true_false') {
    const options = a.type === 'true_false' ? [{ id: 'true', label: 'True' }, { id: 'false', label: 'False' }] : cfg.options;
    const type = a.type === 'multiple_choice' ? 'checkbox' : 'radio';
    for (const option of options) {
      const label = node('label', 'choice-row');
      const input = node('input');
      input.type = type;
      input.name = a.id;
      input.value = option.id;
      input.checked = Array.isArray(saved) ? saved.includes(option.id)
        : a.type === 'true_false' ? String(saved) === option.id : saved === option.id;
      label.append(input, node('span', '', option.label));
      form.append(label);
    }
    readValue = () => {
      const values = [...form.querySelectorAll('input:checked')].map(x => x.value);
      if (!values.length) throw new Error('Choose an answer before submitting.');
      return a.type === 'multiple_choice' ? values : a.type === 'true_false' ? values[0] === 'true' : values[0];
    };
  } else if (a.type === 'text_entry') {
    const input = node('input');
    input.type = 'text';
    input.placeholder = cfg.placeholder || 'Your answer';
    input.setAttribute('aria-label', a.prompt);
    input.value = typeof saved === 'string' ? saved : '';
    form.append(input);
    readValue = () => input.value;
  } else if (a.type === 'numeric_entry') {
    const row = node('div', 'matching-row');
    const input = node('input');
    input.type = 'number';
    input.step = 'any';
    input.required = true;
    input.setAttribute('aria-label', 'Numeric answer');
    if (typeof saved === 'number') input.value = String(saved);
    const unit = node('input');
    unit.value = a.lastDraft?.unit ?? a.lastSubmission?.unit ?? cfg.unitLabel ?? '';
    unit.setAttribute('aria-label', 'Unit');
    row.append(input, unit);
    form.append(row);
    readValue = () => {
      if (input.value === '') throw new Error('Enter a number.');
      return { number: Number(input.value), unit: unit.value };
    };
  } else if (a.type === 'matching') {
    const selects = [];
    for (const left of cfg.left) {
      const row = node('div', 'matching-row');
      row.append(node('span', '', left.label));
      const select = node('select');
      select.setAttribute('aria-label', `Match for ${left.label}`);
      const blank = node('option', '', 'Select match');
      blank.value = '';
      select.append(blank);
      for (const right of cfg.right) {
        const option = node('option', '', right.label);
        option.value = right.id;
        select.append(option);
      }
      row.append(select);
      form.append(row);
      select.value = saved?.[left.id] || '';
      selects.push([left.id, select]);
    }
    readValue = () => Object.fromEntries(selects.map(([id, select]) => [id, select.value]));
  } else if (a.type === 'sequencing') {
    const selects = [];
    for (let i = 0; i < cfg.items.length; i++) {
      const row = node('div', 'sequence-row');
      row.append(node('span', '', `Step ${i + 1}`));
      const select = node('select');
      select.setAttribute('aria-label', `Step ${i + 1}`);
      const blank = node('option', '', 'Select item');
      blank.value = '';
      select.append(blank);
      for (const item of cfg.items) {
        const option = node('option', '', item.label);
        option.value = item.id;
        select.append(option);
      }
      row.append(select);
      form.append(row);
      select.value = Array.isArray(saved) ? saved[i] || '' : '';
      selects.push(select);
    }
    readValue = () => {
      const values = selects.map(x => x.value);
      if (values.some(x => !x) || new Set(values).size !== values.length) {
        throw new Error('Choose each sequence item once.');
      }
      return values;
    };
  } else if (a.type === 'data_inspection') {
    readValue = renderInspection(form, a);
  } else if (a.type === 'web_project') {
    const target = node('div'); form.append(target);
    const workspace = mountWeb(target, a, {
      changed: () => form.dispatchEvent(new Event('input', { bubbles: true })),
      snapshot: () => request(`/api/me/activities/${encodeURIComponent(a.id)}/web-preview`, { silent: true }),
      discardPreview: () => request(`/api/me/activities/${encodeURIComponent(a.id)}/web-preview`, { method: 'DELETE' }),
      preview: (value, reset) => request(`/api/me/activities/${encodeURIComponent(a.id)}/web-preview`, { method: 'POST', data: { value, reset } })
    });
    readValue = workspace.value; form._disposeWorkspace = workspace.unmount;
  } else if (a.type === 'code_writing') {
    readValue = renderCodingQuestion(form, a, (value, input) => request(preview ? '/api/instructor/code/preview'
      : `/api/me/activities/${encodeURIComponent(a.id)}/preview`, {
        method: 'POST', data: preview ? { config: cfg, value, input } : { value, input }
      }), preview || cfg.language === 'sql' || !state.liveTerminalAvailable ? undefined : {
        open: value => request(`/api/me/activities/${encodeURIComponent(a.id)}/terminal`, { method: 'POST', data: { value } }),
        read: id => request(`/api/me/activities/${encodeURIComponent(a.id)}/terminal/${id}`, { silent: true }),
        write: (id, input) => request(`/api/me/activities/${encodeURIComponent(a.id)}/terminal/${id}`, { method: 'POST', data: input, silent: true }),
        stop: id => request(`/api/me/activities/${encodeURIComponent(a.id)}/terminal/${id}`, { method: 'DELETE', silent: true }),
      }, !preview && cfg.language !== 'sql' && !state.liveTerminalAvailable);
  } else if (a.type === 'datatable_code') {
    readValue = renderCode(form, a);
  }

  const submit = node('button', 'primary', preview ? 'Test interaction'
    : state.session.feedbackMode === 'graded' ? 'Submit answer' : `Submit · ${a.maxPoints} pts`);
  submit.type = 'submit';
  submit.disabled = !preview && (state.session.status !== 'in_progress' || a.attemptsRemaining === 0);
  form.append(submit);

  const feedback = node('div', 'activity-feedback');
  feedback.setAttribute('role', 'status');
  const answerState = node('p', 'answer-state');
  answerState.setAttribute('role', 'status');
  const retrySave = node('button', 'text-button hidden', 'Try saving again'); retrySave.type = 'button';

  let draftTimer;
  let localTimer;
  let localDirty = false;
  let localPending = false;
  let draftRequest = Promise.resolve(true);
  let draftDirty = false, draftRevision = 0, submitting = false;
  let retryRecord;
  let serverRevision = a.lastDraft?.updatedAt ?? '';
  let saveState = a.lastDraft?.gradable ? 'draft' : a.lastSubmission ? 'submitted' : 'empty';
  function setAnswerState(status, text) {
    saveState = status; answerState.dataset.state = status; answerState.textContent = text;
    retrySave.classList.toggle('hidden', status !== 'failed');
    updateSaveStatus();
  }
  const readDraftSubmission = () => {
    try {
      const read = readValue(true);
      return a.type === 'numeric_entry' ? { value: read.number, unit: read.unit } : { value: read };
    } catch {
      if (a.type === 'datatable_code') return { value: form.querySelector('textarea')?.value ?? '' };
      if (a.type === 'sequencing') return { value: [...form.querySelectorAll('select')].map(select => select.value) };
      if (a.type === 'single_choice' || a.type === 'multiple_choice' || a.type === 'true_false') {
        const selected = [...form.querySelectorAll('input:checked')].map(input => input.value);
        return { value: a.type === 'multiple_choice' ? selected : a.type === 'true_false'
          ? selected.length ? selected[0] === 'true' : null : selected[0] ?? '' };
      }
      return { value: form.querySelector('input,textarea')?.value ?? '' };
    }
  };
  function showAcknowledgedDraft(saved) {
    if (a.attemptsRemaining === 0) {
      setAnswerState('submitted', 'You have used all tries for this question. Your last submitted answer is kept.');
    } else if (saved?.warning) {
      setAnswerState('draft', saved.warning);
    } else if (saved?.gradable) {
      setAnswerState('draft', `Saved at ${new Date(saved.updatedAt).toLocaleTimeString()}. ${a.attemptsUsed ? 'Submitting this changed answer uses another try. Any listed point or time deduction applies.' : 'This answer will be submitted when you finish or time runs out.'}`);
    } else if (a.attemptsUsed > 0) {
      setAnswerState('submitted', 'Your last submitted answer is kept.');
    } else {
      setAnswerState('empty', 'No answer saved yet.');
    }
  }
  if (!preview) {
    state.draftEditors.set(a.id, {
      get status() { return saveState; },
      get submitting() { return submitting; },
      get localPending() { return localPending && !localDirty; },
      flushLocal,
      dispose() { clearTimeout(draftTimer); clearTimeout(localTimer); form._disposeWorkspace?.(); },
      flush: saveDraft
    });
    const answerChanged = event => {
      if (['code_writing', 'web_project'].includes(a.type) && event.target !== form) return;
      if (a.type === 'datatable_code' && event.target.tagName !== 'TEXTAREA') return;
      scheduleDraft();
    };
    form.addEventListener('input', answerChanged);
    form.addEventListener('change', answerChanged);
    showAcknowledgedDraft(a.lastDraft);
  }
  function flushLocal() {
    clearTimeout(localTimer);
    localTimer = undefined;
    if (!localDirty) return;
    localDirty = false;
    localPending = recovery?.write(readDraftSubmission(), serverRevision) === true;
    if (!localPending) {
      answerState.textContent = 'We could not save a backup on this device. Keep this page open until the message says Saved.';
    }
    if (separatePrompt && !document.hidden) updateSaveStatus();
  }
  function scheduleDraft() {
    if (a.attemptsRemaining === 0) {
      setAnswerState('submitted', 'You have used all tries for this question. Changes you make here will not be submitted. Your last submitted answer is kept.');
      return;
    }
    clearTimeout(draftTimer);
    draftDirty = true; draftRevision++;
    localDirty = true;
    setAnswerState('unsaved', a.attemptsUsed > 0
      ? 'Your latest changes are not submitted. Your last submitted answer is kept until the new answer is submitted.'
      : 'Your answer has not been saved yet.');
    if (!separatePrompt) flushLocal();
    else localTimer ??= setTimeout(flushLocal, 2000);
    draftTimer = setTimeout(saveDraft, 800);
  }
  async function saveDraft() {
    clearTimeout(draftTimer);
    if (submitting || a.attemptsRemaining === 0) return true;
    if (!draftDirty) return draftRequest;
    const snapshot = readDraftSubmission(), revision = draftRevision;
    draftDirty = false;
    setAnswerState('saving', 'Saving your answer…');
    draftRequest = draftRequest.then(async () => {
      try {
        const saved = await request(`/api/me/activities/${encodeURIComponent(a.id)}/draft`, { method: 'PUT', data: snapshot, headers: { 'If-Match': serverRevision }, silent: true });
        serverRevision = saved.updatedAt;
        if (revision === draftRevision) {
          localDirty = localPending = false;
          recovery?.clear();
          if (separatePrompt && state.ibt) updateSavedAnswer(a.id, a.attemptsUsed > 0 || saved.gradable);
          showAcknowledgedDraft(saved);
        }
        else {
          localDirty = true;
          flushLocal();
        }
        return true;
      } catch (error) {
        flushLocal();
        if (revision === draftRevision) {
          draftDirty = true;
          setAnswerState('failed', error.code
            ? `Answer not saved. ${userErrorMessage(error, 'student')}`
            : 'We could not save your answer. It is still on this page. Select Try saving again.');
        }
        return false;
      }
    });
    return draftRequest;
  }
  retrySave.addEventListener('click', () => perform(saveDraft));
  if (recovered && recovered.baseRevision === serverRevision) scheduleDraft();

  form.addEventListener('submit', event => {
    event.preventDefault();
    (async () => {
      if (!preview && (submit.disabled || state.finalizing)) return;
      let read;
      try { read = readValue(); }
      catch (error) { feedback.textContent = userErrorMessage(error, 'student'); return; }
      if (typeof read === 'string' && !read.trim()) { feedback.textContent = 'Enter an answer before submitting.'; return; }
      const submittedRevision = draftRevision;
      if (preview) {
        feedback.textContent = 'This is a preview. Your answer has not been submitted for grading.';
        return;
      }
      submit.disabled = true;
      submitting = true;
      form.inert = true;
      clearTimeout(draftTimer);
      await draftRequest;
      const value = a.type === 'numeric_entry' ? read.number : read;
      const submission = a.type === 'numeric_entry' ? { value, unit: read.unit } : { value };
      if (draftRevision === submittedRevision) {
        submitting = false;
        const saving = saveDraft();
        submitting = true;
        if (!await saving) {
          submitting = false;
          form.inert = false;
          submit.disabled = false;
          feedback.textContent = 'Your answer could not be saved. Select Try saving again before submitting.';
          return;
        }
      }
      const retryStorageKey = `gotit:submission:${state.session.id}:${a.id}`;
      if (!retryRecord) {
        try { retryRecord = JSON.parse(sessionStorage.getItem(retryStorageKey) || 'null'); } catch { /* Use the in-memory key. */ }
      }
      if (!retryRecord || retryRecord.payload !== JSON.stringify(submission)) {
        retryRecord = { key: randomId(), payload: JSON.stringify(submission) };
        try { sessionStorage.setItem(retryStorageKey, JSON.stringify(retryRecord)); } catch { /* Use the in-memory key. */ }
      }
      submit.disabled = true;
      submitting = true;
      feedback.textContent = 'Submitting answer…';
      try {
        const result = await request(`/api/me/activities/${encodeURIComponent(a.id)}/submit`, {
          method: 'POST', data: submission, headers: { 'Idempotency-Key': retryRecord.key, 'If-Match': serverRevision, ...(['code_writing', 'web_project'].includes(a.type) ? { Prefer: 'respond-async' } : {}) }
        });
        retryRecord = null;
        try { sessionStorage.removeItem(retryStorageKey); } catch { /* Storage is optional. */ }
        a.attemptsUsed = result.attemptNumber;
        a.attemptsRemaining = result.attemptsRemaining;
        updateAttemptInfo();
        const outcome = result.duplicate ? 'This answer has already been submitted. It was not submitted a second time.'
          : state.session.feedbackMode === 'graded' ? 'Answer submitted.'
          : result.result === 'pending_review' ? 'Your code has been submitted. Your instructor will grade it.' : result.result === 'correct' ? 'Correct.' : result.result === 'partially_correct' ? 'Partially correct.' : 'Incorrect.';
        const deductions = [];
        if (result.penaltyApplied?.points) deductions.push(`${result.penaltyApplied.points} ${result.penaltyApplied.points === 1 ? 'point' : 'points'}`);
        if (result.penaltyApplied?.seconds) deductions.push(`${result.penaltyApplied.seconds} seconds from your remaining time`);
        const cost = deductions.length && !result.duplicate ? ` This extra try deducted ${deductions.join(' and ')}.` : '';
        feedback.textContent = `${outcome}${cost}${result.attemptsRemaining === 0 ? ' You have used all tries for this question.' : ''}`;
        serverRevision = '';
        if (draftRevision === submittedRevision) {
          localDirty = localPending = false;
          recovery?.clear();
          draftDirty = false;
          setAnswerState('submitted', `Submitted at ${new Date().toLocaleTimeString()}. This answer has been received.`);
        } else {
          localDirty = true;
          flushLocal();
          setAnswerState('unsaved', 'Your latest changes are not submitted. Your last submitted answer is kept until the new answer is submitted.');
        }
        state.session = await request('/api/me/session');
        renderExamHeader();
        renderMissionList();
      } catch (error) {
        feedback.textContent = userErrorMessage(error, 'student');
        if (error.code === 'SESSION_CLOSED') {
          state.session = await request('/api/me/session');
          renderCompletion();
        }
      } finally {
        submitting = false;
        form.inert = false;
        submit.disabled = state.session.status !== 'in_progress' || a.attemptsRemaining === 0;
        if (!submit.disabled && draftDirty && saveState === 'unsaved') draftTimer = setTimeout(saveDraft, 800);
      }
    })().catch(error => {
      submitting = false;
      form.inert = false;
      feedback.textContent = userErrorMessage(error, 'student');
      submit.disabled = state.session?.status !== 'in_progress' || a.attemptsRemaining === 0;
    });
  });

  card.append(form, answerState, retrySave, feedback);
  return card;
}

function renderCompletion() {
  $('ibt-review-dialog').close();
  const s = state.session;
  if (state.ibt) {
    flushLocalAnswers();
    clearDraftEditors();
    clearIbtState();
  }
  $('exam-grid').classList.add('hidden');
  $('exam-footer').classList.add('hidden');
  $('completion-panel').classList.remove('hidden');
  $('completion-title').textContent = s.status === 'submitted' ? 'Activity submitted' : 'Time ended';
  if (!s.pendingCodingCount) statusNotice('student-runtime-status');
  $('completion-summary').textContent = completionMessage(s);
  $('save-status').textContent = 'This activity is finished. You cannot change or submit answers now.';
  $('timer-warning').classList.add('hidden');
  $('check-results').textContent = s.resultsReleased ? 'Refresh score' : 'Check my score';
  $('check-results').classList.toggle('hidden', s.feedbackMode !== 'graded' && !s.pendingCodingCount && !s.pendingReview);
  renderFlow();
  syncFullscreenGate();
}

await perform(loadConfig);
const runFromLink = new URLSearchParams(location.search).get('run');
if (runFromLink && /^[a-f0-9-]{36}$/.test(runFromLink)) $('join-run').value = runFromLink;
if (state.candidateAccess) {
  try { await showExam(); }
  catch (error) {
    state.candidateAccess = null;
    if (error.status !== 401) message(userErrorMessage(error, 'student'), { persistent: true });
  }
}
