import { parseTableCode } from './table-code.js';
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

installPasswordToggles();

const $ = id => document.getElementById(id);
const state = {
  candidateAccess: randomId(),
  session: null,
  mission: null,
  joining: false,
  finalizing: false,
  resultsRefreshing: false,
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

const message = text => {
  const box = $('notice');
  box.textContent = text;
  if (text) window.setTimeout(() => { if (box.textContent === text) box.textContent = ''; }, 7000);
};

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
      const response = await fetch(path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
      const result = await response.json();
      if (result.serverNow) state.serverClock = { at: Date.parse(result.serverNow), received: performance.now() };
      if (!response.ok) throw Object.assign(new Error(`${result.message} (${result.code})`), { status: response.status, code: result.code });
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
        if (value.error) throw Object.assign(new Error(value.error.message), { code: value.error.code });
        return value.result;
      }
      if (!silent) message(value.status === 'queued' ? (path.endsWith('/submit') ? 'Coding submission queued. Your on-time receipt is saved.' : 'Sample tests queued…') : 'Running coding tests…');
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(4000, delay + 500);
    }
  } finally { finishStatus(); }
}

const perform = async fn => {
  try { await fn(); } catch (error) { message(error.message); }
};

async function loadConfig() {
  try {
    const config = await request('/api/config');
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
    node('p', 'small', `Run closes ${localDateTime(details.closesAt)}. All attempts end by this time.`));
  const rules = $('readiness-rules'); clear(rules);
  for (const policy of details.retryPolicies)
    rules.append(node('li', '', `${details.retryPolicies.length > 1 ? `${policy.questionCount} questions: ` : ''}${retryPolicyText(policy)}`));
  rules.append(node('li', '', 'Drafts save automatically. Saved drafts are submitted when you finish or time expires, subject to remaining retries.'),
    node('li', '', details.feedbackMode === 'graded'
      ? 'Scores and correctness stay hidden until faculty publishes your score.'
      : 'Practice activity: you see correctness and scores after submitting each answer.'));
  const completed = details.resumed && details.status !== 'in_progress';
  $('begin-attempt').textContent = completed ? 'View attempt and results' : details.resumed ? 'Resume timed attempt' : 'Begin timed attempt';
  $('begin-attempt').dataset.allowFallback = 'false';
  $('readiness-error').textContent = '';
  $('readiness-timing').textContent = completed ? 'Your attempt has ended. Opening results does not start another attempt.'
    : details.resumed ? `Your existing timer is already running, with about ${Math.floor(details.availableSeconds / 60)} minutes remaining. Resuming keeps your original deadline.`
    : details.availableSeconds < details.durationMinutes * 60
      ? `The run closes soon. You will have at most ${Math.floor(details.availableSeconds / 60)} minutes, rather than the full ${details.durationMinutes} minutes. Your timer has not started.`
      : 'Your timer has not started. Begin when you are ready.';
  $('readiness-fullscreen').classList.toggle('hidden', completed);
  $('readiness-fullscreen').textContent = document.fullscreenEnabled
    ? 'The activity uses fullscreen. Your timer begins after you select Begin timed attempt and continues if you leave the page.'
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
    state.candidateAccess = randomId();
    state.session = joined.session;
    state.timerWarnings.clear();
    $('timer-warning').classList.add('hidden');
    $('readiness-panel').classList.add('hidden');
    message(joined.resumed ? 'Session resumed. Progress and deadline restored.' : 'Session started.');
    await showExam();
  } catch (error) {
    $('readiness-error').textContent = error.message;
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
window.addEventListener('online', () => { flushDrafts().catch(() => message('Reconnected. Some drafts still need saving.')); });

function updateSaveStatus() {
  const editors = [...state.draftEditors.values()];
  const failed = editors.filter(editor => editor.status === 'failed').length;
  const pending = editors.some(editor => ['unsaved', 'saving'].includes(editor.status));
  const drafts = editors.filter(editor => editor.status === 'draft').length;
  const submitted = editors.filter(editor => editor.status === 'submitted').length;
  $('save-status').textContent = failed ? `${failed} ${failed === 1 ? 'draft could' : 'drafts could'} not be saved. Retry beside the question.`
    : pending ? 'You have unsubmitted changes. Check the status beside each answer.'
    : drafts ? `This section: ${drafts} saved ${drafts === 1 ? 'draft' : 'drafts'}. Saved drafts are included when you finish or time expires.`
    : submitted ? `This section: ${submitted} ${submitted === 1 ? 'answer' : 'answers'} submitted${submitted === editors.length ? '. You can continue.' : ` · ${editors.length - submitted} not submitted.`}`
    : 'Drafts save automatically. Saved drafts are included when you finish or time expires.';
}

async function leaveSession() {
  if (!await flushDrafts()) { message('Some drafts could not be saved. Retry saving before leaving.'); return; }
  try { await request('/api/me/logout', { method: 'POST' }); }
  catch (error) { if (error.status !== 401) throw error; }
  if (document.fullscreenElement === document.documentElement) document.exitFullscreen().catch(() => {});
  clearLocalDrafts(state.session.id);
  state.candidateAccess = null;
  state.session = null;
  state.mission = null;
  clearDraftEditors();
  $('exam-panel').classList.add('hidden');
  $('join-panel').classList.remove('hidden');
  syncFullscreenGate();
}
$('candidate-exit').addEventListener('click', () => perform(leaveSession));
$('fullscreen-exit').addEventListener('click', () => perform(leaveSession));

async function finalizeAttempt() {
  if (state.finalizing || state.session?.status !== 'in_progress') return;
  if (!await flushDrafts()) { message('Some drafts could not be saved. Retry saving before finishing.'); return; }
  const remaining = state.session.order.filter(m => !m.completed).length;
  const word = state.session.kind === 'ctf' ? 'mission' : 'section';
  const unanswered = state.session.questionCount - state.session.submittedCount;
  const draftNote = ` Saved drafts will be submitted for grading, subject to remaining retries. ${unanswered} questions have no explicit submission.`;
  const prompt = (remaining
    ? `Finish now with ${remaining} unfinished ${word}${remaining === 1 ? '' : 's'}? You cannot submit more answers.`
    : 'Finish this attempt? You cannot submit more answers.') + draftNote;
  if (!window.confirm(prompt)) return;
  state.finalizing = true;
  $('finalize').disabled = true;
  $('finalize-early').disabled = true;
  try {
    state.session = await request('/api/me/finalize', { method: 'POST', data: {} });
    renderExamHeader();
    renderCompletion();
  } finally { state.finalizing = false; renderFlow(); }
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
    const wasReleased = state.session.resultsReleased;
    state.session = session;
    renderExamHeader();
    if (session.status !== 'in_progress') renderCompletion();
    else await showExam();
    if (session.resultsReleased && !wasReleased) message('Your score has been published.');
    else if (!background && !session.resultsReleased) message('Your score has not been published yet. This page checks automatically; you can also check again.');
  } finally {
    state.resultsRefreshing = false;
    $('check-results').disabled = false;
  }
}
$('check-results').addEventListener('click', () => perform(refreshResults));
$('refresh-score').addEventListener('click', () => perform(refreshResults));

function checkForPublishedResults() {
  if (document.hidden || (state.session?.feedbackMode !== 'graded' && !state.session?.pendingCodingCount)) return;
  // Keep the last known result on a background failure; manual checks report errors.
  refreshResults({ background: true }).catch(() => {});
}
window.setInterval(checkForPublishedResults, 15000);
window.setInterval(() => {
  if (!document.hidden && state.session?.status === 'in_progress') request('/api/me/heartbeat', { method: 'POST', silent: true }).catch(() => {});
}, 15000);
window.addEventListener('focus', checkForPublishedResults);
document.addEventListener('visibilitychange', checkForPublishedResults);
$('continue-mission').addEventListener('click', () => perform(async () => {
  const next = state.session?.order.find(item => item.unlocked && !item.completed);
  if (!next) return;
  await loadMission(next.id);
  $('mission-content').scrollIntoView({ block: 'start' });
}));

async function showExam() {
  state.session = await request('/api/me/session');
  $('join-panel').classList.add('hidden');
  $('exam-panel').classList.remove('hidden');
  renderExamHeader();
  if (state.session.status !== 'in_progress') { renderCompletion(); syncFullscreenGate(); return; }
  $('exam-grid').classList.remove('hidden');
  $('exam-footer').classList.remove('hidden');
  $('completion-panel').classList.add('hidden');
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
  $('score').textContent = s.resultsReleased ? `${s.score} / ${s.maxPoints} pts` : 'Score hidden';
  // Scores can only be published after an attempt ends; the completion screen provides refresh.
  $('refresh-score').classList.add('hidden');
  renderFlow();
  updateTimer();
}

function renderFlow() {
  if (!state.session) return;
  const s = state.session;
  const total = s.order.length, completed = s.order.filter(item => item.completed).length;
  const word = s.kind === 'ctf' ? 'mission' : 'section';
  $('exam-progress').textContent = `${completed} of ${total} ${word}${total === 1 ? '' : 's'} complete`;
  const active = s.status === 'in_progress';
  $('exam-panel').classList.toggle('attempt-active', active);
  const current = s.order.find(item => item.id === state.mission?.id);
  const next = s.order.find(item => item.unlocked && !item.completed);
  const canContinue = active && current?.completed && next && next.id !== current.id;
  $('continue-mission').classList.toggle('hidden', !canContinue);
  $('continue-mission').textContent = `Next ${word}`;
  $('finalize').classList.toggle('hidden', !active || completed !== total);
  $('finalize').disabled = !active || state.finalizing;
  $('finish-early').classList.toggle('hidden', !active || completed === total);
  if (!active || completed === total) $('finish-early').open = false;
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
      $('timer-warning').textContent = `${threshold === 60000 ? 'Less than 1 minute' : 'Less than 5 minutes'} remaining. Save your work; acknowledged drafts are graded at expiry, subject to remaining retries.`;
      $('timer-warning').classList.remove('hidden');
    }
  }
  if (remaining === 0 && state.session.status === 'in_progress') {
    state.session.status = 'expired';
    renderCompletion();
  }
}
window.setInterval(updateTimer, 1000);

function renderMissionList() {
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

async function loadMission(id) {
  if (state.mission && state.mission.id !== id) {
    if (!await flushDrafts()) { message('Some drafts could not be saved. Retry beside the question before switching sections.'); return; }
  }
  state.mission = await request(`/api/me/missions/${encodeURIComponent(id)}`);
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

  // Collapsible reference: only displayed if reference material exists
  const refDetails = $('collapsible-reference');
  refDetails.open = false;
  const context = $('context-content');
  clear(context);
  const reference = mission.activities.find(a => a.publicConfig?.apiReference || a.publicConfig?.columns)?.publicConfig;
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
      ...(secondColumn.value ? [{ column: secondColumn.value, direction: secondDirection.value }] : [])
    ]
  });

  const render = () => {
    const current = value();
    let rows = [...config.rows];
    const term = current.globalSearch.trim().toLocaleLowerCase('en');
    if (term) rows = rows.filter(row => config.columns.some(col => String(row[col.id]).toLocaleLowerCase('en').includes(term)));
    for (const [col, text] of Object.entries(current.columnSearch)) {
      rows = rows.filter(row => String(row[col]).toLocaleLowerCase('en').includes(text.trim().toLocaleLowerCase('en')));
    }
    rows.sort((left, right) => {
      for (const item of current.order) {
        const cmp = String(left[item.column]).localeCompare(String(right[item.column]), 'en', { numeric: true });
        if (cmp) return cmp * (item.direction === 'desc' ? -1 : 1);
      }
      return 0;
    });
    const pages = Math.max(1, Math.ceil(rows.length / current.pageLength));
    pageIndex = Math.min(pageIndex, pages - 1);
    summary.textContent = `Showing ${rows.length ? pageIndex * current.pageLength + 1 : 0} to ${Math.min((pageIndex + 1) * current.pageLength, rows.length)} of ${rows.length} matching records · page ${pageIndex + 1} of ${pages}`;
    clear(table);
    const head = node('thead');
    const headRow = node('tr');
    for (const col of config.columns) headRow.append(node('th', '', col.label));
    head.append(headRow);
    table.append(head);
    const body = node('tbody');
    for (const record of rows.slice(pageIndex * current.pageLength, (pageIndex + 1) * current.pageLength)) {
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
  back.addEventListener('click', () => { pageIndex--; render(); });
  next.addEventListener('click', () => { pageIndex++; render(); });
  render();

  return () => {
    if (secondColumn.value && secondColumn.value === firstColumn.value) {
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
    previewTable = new window.DataTable(table, {
      paging: state.flags.paging,
      searching: state.flags.searching,
      ordering: state.flags.ordering,
      pageLength: state.pageLength,
      lengthMenu: state.lengthMenu,
      order: state.order.map(item => [columnIndex(item.column), item.direction]),
      data: config.rows.map(row => config.columns.map(column => String(row[column.id] ?? ''))),
      columns: config.columns.map(column => ({ title: column.label }))
    });
    previewTable.search(state.globalSearch);
    for (const [column, term] of Object.entries(state.columnSearch)) {
      previewTable.column(columnIndex(column)).search(term);
    }
    previewTable.draw();
  };

  run.addEventListener('click', () => {
    try {
      render(parseTableCode(editor.value, config));
      messageEl.textContent = 'Code applied to DataTables preview.';
    } catch (error) {
      messageEl.textContent = error.message;
    }
  });
  try {
    render({ pageLength: 10, lengthMenu: [10, 25, 50], flags: { paging: true, searching: true, ordering: true }, globalSearch: '', columnSearch: {}, order: [{ column: config.columns[0].id, direction: 'asc' }] });
  } catch (error) {
    messageEl.textContent = error.message;
  }
  return () => {
    parseTableCode(editor.value, config);
    return editor.value;
  };
}

function renderActivity(a, preview = false) {
  const recovery = !preview ? localDraft(state.session.id, a.id) : null;
  const recovered = recovery?.read();
  if (recovered && recovered.baseRevision === (a.lastDraft?.updatedAt ?? '')) {
    a.lastDraft = { ...recovered.response, updatedAt: recovered.baseRevision };
  }
  const card = node('article', 'activity-card');
  if (recovered && recovered.baseRevision !== (a.lastDraft?.updatedAt ?? '')) {
    const download = node('button', '', 'Download unsynced local answer'); download.type = 'button';
    download.addEventListener('click', () => {
      const link = node('a'); link.href = URL.createObjectURL(new Blob([JSON.stringify(recovered.response, null, 2)], { type: 'application/json' }));
      link.download = `${a.id}-unsynced.json`; link.click(); URL.revokeObjectURL(link.href);
    });
    card.append(node('p', 'small', 'This browser has unsynced changes from an older server version. Review them before replacing the current answer.'), download);
  }
  card.append(renderPrompt(a.prompt, 'activity-prompt'));
  const policy = a.attemptPolicy;
  const attemptInfo = node('p', 'small');
  const showPolicy = !preview && policy && (policy.maxRetries !== null || policy.pointPenalty || policy.timePenaltySeconds);
  const updateAttemptInfo = () => {
    if (!showPolicy) return;
    const limit = policy.maxRetries === null ? 'unlimited' : String(policy.maxRetries + 1);
    attemptInfo.textContent = `Attempts: ${a.attemptsUsed}/${limit} · Each retry: −${policy.pointPenalty} pts, −${policy.timePenaltySeconds} sec`;
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
      preview: (value, reset) => request(`/api/me/activities/${encodeURIComponent(a.id)}/web-preview`, { method: 'POST', data: { value, reset } })
    });
    readValue = workspace.value; form._disposeWorkspace = workspace.unmount;
  } else if (a.type === 'code_writing') {
    readValue = renderCodingQuestion(form, a, value => request(preview ? '/api/instructor/code/preview'
      : `/api/me/activities/${encodeURIComponent(a.id)}/preview`, {
        method: 'POST', data: preview ? { config: cfg, value } : { value }
      }));
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
  const retrySave = node('button', 'text-button hidden', 'Retry saving draft'); retrySave.type = 'button';

  let draftTimer;
  let draftRequest = Promise.resolve();
  let draftDirty = false, draftRevision = 0, submitting = false;
  let serverRevision = a.lastDraft?.updatedAt ?? '';
  let saveState = a.lastDraft ? 'draft' : a.lastSubmission ? 'submitted' : 'empty';
  function setAnswerState(status, text) {
    saveState = status; answerState.dataset.state = status; answerState.textContent = text;
    retrySave.classList.toggle('hidden', status !== 'failed');
    updateSaveStatus();
  }
  const readDraftSubmission = () => {
    try {
      const read = readValue();
      return a.type === 'numeric_entry' ? { value: read.number, unit: read.unit } : { value: read };
    } catch {
      if (a.type === 'datatable_code') return { value: form.querySelector('textarea')?.value ?? '' };
      if (a.type === 'sequencing') return { value: [...form.querySelectorAll('select')].map(select => select.value) };
      if (a.type === 'single_choice' || a.type === 'multiple_choice' || a.type === 'true_false') {
        const selected = [...form.querySelectorAll('input:checked')].map(input => input.value);
        return { value: a.type === 'multiple_choice' ? selected : a.type === 'true_false'
          ? selected[0] === 'true' : selected[0] ?? '' };
      }
      return { value: form.querySelector('input,textarea')?.value ?? '' };
    }
  };
  if (!preview) {
    state.draftEditors.set(a.id, {
      get status() { return saveState; },
      dispose() { clearTimeout(draftTimer); form._disposeWorkspace?.(); },
      flush: saveDraft
    });
    form.addEventListener('input', scheduleDraft);
    form.addEventListener('change', scheduleDraft);
    setAnswerState(saveState, saveState === 'submitted' ? 'Answer submitted · Included in your attempt'
      : saveState === 'draft' ? 'Draft saved · Included when you finish or time expires' : 'No answer submitted');
  }
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftDirty = true; draftRevision++;
    const stored = recovery?.write(readDraftSubmission(), serverRevision);
    setAnswerState('unsaved', a.attemptsUsed > 0
      ? 'Changes not submitted · Your previous submission still counts'
      : 'Draft not saved yet · Not submitted');
    if (stored === false) answerState.textContent = 'Local recovery unavailable. Keep this page open until the server saves.';
    draftTimer = setTimeout(saveDraft, 800);
  }
  async function saveDraft() {
    clearTimeout(draftTimer);
    if (submitting || a.attemptsRemaining === 0) return true;
    if (!draftDirty) return draftRequest;
    const snapshot = readDraftSubmission(), revision = draftRevision;
    draftDirty = false;
    setAnswerState('saving', 'Saving draft… · Not submitted');
    draftRequest = draftRequest.then(async () => {
      try {
        const saved = await request(`/api/me/activities/${encodeURIComponent(a.id)}/draft`, { method: 'PUT', data: snapshot, headers: { 'If-Match': serverRevision }, silent: true });
        serverRevision = saved.updatedAt;
        if (revision === draftRevision) { recovery?.clear(); setAnswerState('draft', `Draft saved at ${new Date(saved.updatedAt).toLocaleTimeString()} · Included when you finish or time expires`); }
        else recovery?.write(readDraftSubmission(), serverRevision);
        return true;
      } catch {
        if (revision === draftRevision) {
          draftDirty = true;
          setAnswerState('failed', 'Draft could not be saved · Your answer is still on this page. Retry saving.');
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
      if (!preview && submit.disabled) return;
      let read;
      try { read = readValue(); }
      catch (error) { feedback.textContent = error.message; return; }
      const submittedRevision = draftRevision;
      if (preview) {
        feedback.textContent = 'Preview response captured.';
        return;
      }
      submit.disabled = true;
      clearTimeout(draftTimer);
      await draftRequest;
      const value = a.type === 'numeric_entry' ? read.number : read;
      const submission = a.type === 'numeric_entry' ? { value, unit: read.unit } : { value };
      await saveDraft();
      const retryStorageKey = `gotit:submission:${state.session.id}:${a.id}`;
      let retryRecord;
      try { retryRecord = JSON.parse(sessionStorage.getItem(retryStorageKey) || 'null'); } catch { retryRecord = null; }
      if (!retryRecord || retryRecord.payload !== JSON.stringify(submission)) {
        retryRecord = { key: randomId(), payload: JSON.stringify(submission) };
        sessionStorage.setItem(retryStorageKey, JSON.stringify(retryRecord));
      }
      submit.disabled = true;
      submitting = true;
      feedback.textContent = 'Submitting answer…';
      try {
        const result = await request(`/api/me/activities/${encodeURIComponent(a.id)}/submit`, {
          method: 'POST', data: submission, headers: { 'Idempotency-Key': retryRecord.key, ...(['code_writing', 'web_project'].includes(a.type) ? { Prefer: 'respond-async' } : {}) }
        });
        sessionStorage.removeItem(retryStorageKey);
        a.attemptsUsed = result.attemptNumber;
        a.attemptsRemaining = result.attemptsRemaining;
        updateAttemptInfo();
        const outcome = result.duplicate ? 'Answer was already submitted.'
          : state.session.feedbackMode === 'graded' ? 'Answer submitted.'
          : result.result === 'correct' ? 'Correct.' : result.result === 'partially_correct' ? 'Partially correct.' : 'Incorrect.';
        const cost = result.penaltyApplied && !result.duplicate
          ? ` Retry cost: ${result.penaltyApplied.points} points and ${result.penaltyApplied.seconds} seconds.` : '';
        feedback.textContent = `${outcome}${cost}${result.attemptsRemaining === 0 ? ' No attempts left.' : ''}`;
        state.session = await request('/api/me/session');
        renderExamHeader();
        renderMissionList();
        if (draftRevision === submittedRevision) {
          recovery?.clear(); serverRevision = '';
          draftDirty = false;
          setAnswerState('submitted', `Answer submitted at ${new Date().toLocaleTimeString()} · Included in your attempt`);
        } else setAnswerState('unsaved', 'Changes not submitted · Your previous submission still counts');
      } catch (error) {
        feedback.textContent = error.message;
        if (error.code === 'SESSION_CLOSED') {
          state.session = await request('/api/me/session');
          renderCompletion();
        }
      } finally {
        submitting = false;
        submit.disabled = state.session.status !== 'in_progress' || a.attemptsRemaining === 0;
      }
    })().catch(error => {
      feedback.textContent = error.message;
      submit.disabled = state.session?.status !== 'in_progress' || a.attemptsRemaining === 0;
    });
  });

  card.append(form, answerState, retrySave, feedback);
  return card;
}

function renderCompletion() {
  const s = state.session;
  $('exam-grid').classList.add('hidden');
  $('exam-footer').classList.add('hidden');
  $('completion-panel').classList.remove('hidden');
  $('completion-title').textContent = s.status === 'submitted' ? 'Attempt submitted' : 'Time ended';
  $('completion-summary').textContent = s.pendingCodingCount
    ? `${s.pendingCodingCount} coding submission is waiting for grading. Your on-time receipt is saved. This page checks for the result automatically.`
    : s.resultsReleased
    ? `Score: ${s.score} / ${s.maxPoints} points.`
    : `${s.submittedCount} of ${s.questionCount} answers submitted. Saved drafts are included, subject to remaining retries. Your score will appear automatically after faculty publishes it. You can also check below.`;
  $('save-status').textContent = 'Attempt finished. You cannot submit more answers.';
  $('timer-warning').classList.add('hidden');
  $('check-results').textContent = s.resultsReleased ? 'Refresh score' : 'Check for published score';
  $('check-results').classList.toggle('hidden', s.feedbackMode !== 'graded' && !s.pendingCodingCount);
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
    if (error.status !== 401) message('Sign in to resume this attempt.');
  }
}
