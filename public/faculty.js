import { parseTableCode } from './table-code.js';
import { parseRoster } from './roster-import.js';
import { answerText } from './answer-key.js';
import { renderPrompt } from './prompt-code.js';
import { appendCodeExamples, createCodeQuestionEditor } from './code-task-ui.js';
import { questionTypes, positiveTypeCounts, typeCountTotal, validateQuestionMix } from './question-types.js';
import { createMatchingEditor, createTableQuestionEditor } from './question-type-editors.js';
import { beginRequestStatus } from './request-status.js';
import { facultyRequestLabel } from './request-labels.js';
import { icon } from './icons.js';
import { appendPaperInput, distributePaperPoints } from './paper-copy.js';
import { installPasswordToggles } from './password-toggle.js';
import { attemptLabels, participationCounts, filterResultRows, localDateTime } from './ui-model.js';
import { browserSessionHeaders, createRunAccessStore, clearLegacyCredentials } from './browser-session.js';

installPasswordToggles();

const $ = id => document.getElementById(id);
const workflowIcons = { exams: 'activity', rules: 'rules', sources: 'source', review: 'review', classes: 'people', run: 'run', results: 'results' };
for (const button of document.querySelectorAll('[data-step-link]')) button.prepend(icon(workflowIcons[button.dataset.stepLink]));
const state = {
  instructorAuthenticated: false,
  step: sessionStorage.getItem('facultyStep') || 'exams',
  activityMode: 'library', validatedKey: null, validationErrors: [], validationBusy: false,
  validationEpoch: 0, publishBusy: false, runBusy: false,
  proctorBusy: false,
  selectedExam: null, libraryReady: false,
  examDetail: null, policyEditors: [], rulesDirty: false, packageBaseline: '',
  sources: [], runs: [], classes: [], selectedClassId: '', classDetail: null,
  editingClassId: '', pendingClassRoster: null, classBusy: false,
  classTable: null, editingStudentId: '',
  aiProposal: null, aiInput: null, aiEditors: [], aiReady: false, aiBusy: false,
  aiSaveQueue: Promise.resolve(), exams: [], results: null, resultsEpoch: 0, aiReviewCursor: -1
};

const node = (tag, className, content) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = String(content);
  return element;
};
const clear = element => element.replaceChildren();
const mixInputs = new Map();
for (const type of questionTypes) {
  const label = node('label', '', type.label), input = node('input');
  input.type = 'number'; input.min = '0'; input.max = '20'; input.step = '1';
  input.value = ['single_choice', 'true_false', 'matching', 'code_writing'].includes(type.id) ? '2' : '0';
  label.append(input); $('ai-question-type-counts').append(label); mixInputs.set(type.id, input);
  input.addEventListener('input', () => { syncQuestionMix(); updateAiApprovals(); renderWorkflowState(); });
}
const readQuestionMix = () => Object.fromEntries([...mixInputs].map(([type, input]) => [type, Number(input.value)]));
function syncQuestionMix() {
  const mixed = $('ai-question-mode').value === 'mixed';
  $('ai-question-mix').hidden = !mixed; $('ai-questions').readOnly = mixed;
  if (mixed) {
    const total = typeCountTotal(readQuestionMix()); $('ai-questions').value = String(total);
    $('ai-mix-total').textContent = `${total} questions selected · Total limit: 20.`;
  }
}
const runAccess = createRunAccessStore();
function loadSelectedRun() {
  try { return localStorage.getItem('gotItSelectedRun') || ''; }
  catch { return ''; }
}
function saveSelectedRun(runId) {
  try { localStorage.setItem('gotItSelectedRun', runId); }
  catch { /* Keep the current tab usable if browser storage is blocked. */ }
}
function loadRunAccess(runId) {
  return runAccess.get(runId);
}
function saveRunAccess(runId, details) {
  return runAccess.set(runId, details);
}
function renderRunAccess(runId) {
  const run = state.runs.find(item => item.id === runId);
  const panel = $('saved-run-access');
  panel.classList.toggle('hidden', !run);
  if (!run) return;
  const saved = loadRunAccess(runId);
  const studentUrl = new URL('/app/student', window.location.href);
  studentUrl.searchParams.set('run', runId);
  const linkLabel = ['localhost', '127.0.0.1'].includes(studentUrl.hostname)
    ? 'Student activity (this computer only)' : 'Student activity';
  $('saved-run-access-text').value = `${linkLabel}: ${saved?.url || studentUrl.href}\nRun ID: ${runId}${saved?.pin ? `\nRun PIN: ${saved.pin}` : ''}\nSign in with your School ID from the class roster.`;
  $('saved-run-access-note').textContent = saved?.pin
    ? 'Access details are available in this tab until you refresh or sign out. Copy them now.'
    : 'This tab does not have the PIN. The server stores only its hash; enter a new PIN below if needed.';
  $('run-pin-recovery').classList.toggle('hidden', !!saved?.pin);
}

const message = text => {
  const box = $('notice');
  box.textContent = text;
  if (text) window.setTimeout(() => { if (box.textContent === text) box.textContent = ''; }, 7000);
};

async function request(path, { method = 'GET', data, raw = false, silent = false } = {}) {
  const finishStatus = silent ? () => {} : beginRequestStatus(facultyRequestLabel(path, method));
  const headers = browserSessionHeaders('instructor');
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetch(path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
    if (raw && response.ok) return await response.blob();
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(`${result.message} (${result.code})`), { status: response.status, code: result.code });
    return result.data;
  } finally { finishStatus(); }
}

async function extractFile(file) {
  if (!file || !/\.(txt|md|pdf|pptx)$/i.test(file.name))
    throw new Error('Choose a .txt, .md, .pdf or .pptx file. Older .ppt files need to be saved as .pptx.');
  if (file.size > 10_000_000) throw new Error('Source files must be 10 MB or smaller.');
  const finishStatus = beginRequestStatus('Reading source file…');
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read the source file.'));
    reader.readAsDataURL(file);
  }).finally(finishStatus);
  return request('/api/instructor/materials/extract', { method: 'POST', data: { filename: file.name, base64 } });
}

const perform = async fn => {
  try { await fn(); } catch (error) { message(error.message); }
};

const examKey = exam => exam ? `${exam.examId}@${exam.version}` : '';
const kindOf = exam => exam?.kind || 'activity';
const groupWord = exam => kindOf(exam) === 'ctf' ? 'mission' : 'section';
const kindLabel = exam => kindOf(exam) === 'ctf' ? 'CTF' : kindOf(exam)[0].toUpperCase() + kindOf(exam).slice(1);
const difficultyLabel = exam => exam?.difficulty ? ` · ${exam.difficulty[0].toUpperCase()}${exam.difficulty.slice(1)}` : '';
const materialFileReady = file => !!file && /\.(txt|md|pdf|pptx)$/i.test(file.name) && file.size <= 10_000_000;
const aiGroupCount = () => $('ai-kind').value === 'ctf' ? Number($('ai-missions').value)
  : Math.ceil(Number($('ai-questions').value) / 4);
const aiConfigMatches = () => state.aiInput && state.aiInput.title === $('ai-title').value.trim()
  && state.aiInput.subject === $('ai-subject').value.trim() && state.aiInput.kind === $('ai-kind').value
  && state.aiInput.difficulty === $('ai-difficulty').value
  && (state.aiInput.questionMode || 'auto') === $('ai-question-mode').value
  && (state.aiInput.programmingLanguage || 'auto') === $('ai-programming-language').value
  && ($('ai-question-mode').value !== 'mixed' || JSON.stringify(positiveTypeCounts(state.aiInput.questionTypeCounts)) === JSON.stringify(positiveTypeCounts(readQuestionMix())))
  && state.aiInput.durationMinutes === Number($('ai-duration').value)
  && state.aiInput.questionCount === Number($('ai-questions').value)
  && state.aiInput.missionCount === aiGroupCount()
  && (state.aiInput.customPrompt || '') === $('ai-custom-prompt').value.trim()
  && state.aiInput.source.filename === ($('ai-source').files[0]?.name || state.aiInput.source.filename);
const titleChanged = () => state.selectedExam?.status === 'draft' &&
  $('exam-title-input').value.trim() !== (state.examDetail?.public.title || '');

function invalidateValidation() {
  state.validationEpoch++;
  state.validatedKey = null;
  state.validationErrors = [];
  $('validation-output').textContent = '';
  clear($('ai-check-results'));
}

function setActivityMode(mode) {
  state.activityMode = mode;
  $('activity-create-view').classList.toggle('hidden', mode !== 'create');
  $('activity-library-view').classList.toggle('hidden', mode !== 'library');
  renderWorkflowState();
}

function stepAllowed(step) {
  if (step === 'exams') return true;
  if (step === 'classes') return true;
  if (step === 'results') return true;
  if (state.activityMode === 'create' && ['rules', 'sources', 'review', 'run'].includes(step)) return false;
  if (step === 'run') return state.selectedExam?.status === 'published' && state.classes.length > 0;
  if (step === 'rules') return state.selectedExam?.status === 'draft' && !titleChanged();
  if (step === 'sources') return state.selectedExam?.status === 'draft' && !titleChanged() && !state.rulesDirty;
  if (step === 'review') return state.selectedExam?.status === 'published' ||
    (state.selectedExam?.status === 'draft' && !titleChanged() && !state.rulesDirty);
  return false;
}

function showStep(step) {
  const section = document.querySelector(`.faculty-step[data-step="${step}"]`);
  if (!section) return;
  if (state.libraryReady && !stepAllowed(step)) return;
  state.step = step;
  sessionStorage.setItem('facultyStep', step);
  for (const item of document.querySelectorAll('.faculty-step')) item.classList.toggle('hidden', item !== section);
  for (const button of document.querySelectorAll('[data-step-link]')) {
    if (button.dataset.stepLink === step) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
  document.querySelector('[data-step-link][aria-current="step"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  $('faculty-mobile-nav').value = step;
  if (['rules', 'sources'].includes(step)) document.querySelector('.activity-settings').open = true;
  if (state.libraryReady) {
    renderWorkflowState();
    if (step === 'review') {
      renderReview();
      if (state.selectedExam?.status === 'draft' && !state.validatedKey && !state.validationBusy)
        perform(validateCurrentDraft);
    }
    if (step === 'results') perform(loadResults);
  }
}

function renderWorkflowState() {
  const exam = state.selectedExam;
  const draft = exam?.status === 'draft';
  const published = exam?.status === 'published';
  if (state.libraryReady && !stepAllowed(state.step)) showStep('exams');
  for (const button of document.querySelectorAll('[data-step-link], [data-go-step]')) {
    const target = button.dataset.stepLink || button.dataset.goStep;
    button.disabled = !state.libraryReady || !stepAllowed(target);
    button.title = button.disabled ? target === 'run' ? state.classes.length ? 'Publish an activity to create a run.' : 'Add a class first.'
      : target === 'results' ? 'Create a run to view results.'
      : titleChanged() ? 'Save the activity name first.'
      : state.rulesDirty ? 'Save rule changes first.' : 'Select a draft activity first.' : '';
  }
  const contextualRun = state.runs.find(run => run.id === $('results-run').value);
  $('selected-exam-title').textContent = state.step === 'classes' ? 'Class workspace'
    : state.step === 'results' ? contextualRun?.name || 'Run results'
    : state.step === 'exams' && state.activityMode === 'create'
    ? 'New activity' : exam?.title || 'Select an activity';
  $('step-exams-title').textContent = state.activityMode === 'create' ? 'Create activity' : 'Activities';
  $('selected-exam-meta').textContent = ['classes', 'results'].includes(state.step) ? ''
    : state.step === 'exams' && state.activityMode === 'create'
    ? '' : exam ? `${kindLabel(exam)}${difficultyLabel(exam)} · v${exam.version} · ${exam.status}` : '';
  $('clone-package').classList.toggle('hidden', !published);
  $('clone-package').disabled = !published;
  document.querySelector('.faculty-step[data-step="exams"] [data-go-step="review"]').classList.toggle('hidden', !draft);
  document.querySelector('.faculty-step[data-step="exams"] [data-go-step="run"]').classList.toggle('hidden', !published);
  const title = $('exam-title-input').value.trim();
  const titleDirty = titleChanged();
  const name = $('results-run-name').value.trim();
  const selectedRun = state.runs.find(run => run.id === $('results-run').value);
  const packageDirty = $('package-json').value.trim() !== state.packageBaseline;
  const coverage = ['cov-topic', 'cov-outcome', 'cov-type', 'cov-evidence'].map(id => $(id).value.trim());
  const source = state.sources.find(item => item.id === $('source-select').value);
  const originalCoverage = source?.coverage || {};
  const coverageDirty = coverage.some((value, i) => value !== [originalCoverage.topic, originalCoverage.learningOutcome, originalCoverage.proposedActivityType, originalCoverage.evidence][i]);
  const pin = $('run-pin-field').value.trim();
  const days = Number($('run-duration-days').value);
  const chosenClass = state.classes.find(item => item.id === $('run-class').value);
  const runIssue = !published ? 'Publish an activity first.'
    : !state.classes.length ? 'Add a class in Classes first.'
    : !chosenClass ? 'Choose a saved class.'
    : !chosenClass.studentCount ? 'Add students to this class before creating a run.'
    : !$('run-name-field').value.trim() ? 'Name this run for your class.'
    : pin.length < 4 ? 'Enter an admission PIN of at least 4 characters.'
    : !Number.isInteger(days) || days < 1 || days > 365 ? 'Enter a joining window from 1 to 365 days.' : '';
  $('workflow-guidance').textContent = state.step === 'exams' && state.activityMode === 'create'
    ? state.aiProposal ? 'Review the generated questions and save your selection.' : 'Set up the activity and choose teaching material.'
    : state.step === 'classes'
    ? state.classes.length ? 'Select a class or edit its roster.' : 'Upload a roster to add your first class.'
    : !exam ? 'Choose a draft or create an activity.'
    : state.step === 'exams' ? draft ? titleDirty ? 'Save the activity name to continue.' : 'Continue this draft or create an activity.' : state.classes.length ? 'Create an editable copy or create a run.' : 'Add a class before creating a run.'
    : state.step === 'rules' ? state.rulesDirty ? 'Save rule changes to continue.' : 'Review retry rules, then continue.'
    : state.step === 'sources' ? 'Source notes are optional. Continue to review when ready.'
    : state.step === 'review' ? published ? 'This version is published and locked.'
      : state.validationErrors.length ? 'Fix the issues shown with the questions.'
      : state.validatedKey === examKey(exam) ? 'Ready to publish.' : 'Checking this draft…'
    : state.step === 'run' ? runIssue || 'Ready to create a run.' : state.runs.length
      ? 'Track participation, review answers, and control score visibility.' : 'Create a run to begin tracking results.';
  $('exam-title-input').disabled = !draft;
  $('exam-title-editor').classList.toggle('hidden', !draft);
  $('published-activity-summary').classList.toggle('hidden', !published);
  if (published) {
    const summary = $('published-activity-summary');
    clear(summary);
    summary.append(node('strong', '', exam.title), node('span', 'status-badge status-published', `Published · v${exam.version}`),
      node('p', 'small', 'This version is ready to run. Create an editable copy to make changes.'));
  }
  $('save-exam-title').disabled = !titleDirty || !title || title.length > 120;
  $('exam-title-help').textContent = !exam ? 'Select an activity first.'
    : draft ? 'This name appears to students and in Faculty.' : 'Published versions are locked. Create an editable copy to change the name.';
  $('import-package').disabled = !$('new-package-json').value.trim();
  $('update-package').disabled = !draft || !packageDirty;
  $('save-policies').disabled = !draft || !state.rulesDirty ||
    [...$('policy-editor').querySelectorAll('input[type="number"]')].some(input => !input.checkValidity());
  $('upload-source').disabled = !draft || !materialFileReady($('source-file').files[0]);
  $('save-coverage').disabled = !draft || !source || coverage.some(value => !value) || !coverageDirty;
  $('source-select').disabled = !state.sources.length;
  $('load-sources').disabled = !exam;
  $('source-file').disabled = !draft;
  $('source-upload-help').textContent = !exam ? 'Select a draft activity first.'
    : draft ? 'Upload a file to add material to this draft.' : 'Create an editable copy of this version to add material.';
  for (const id of ['cov-topic', 'cov-outcome', 'cov-type', 'cov-evidence', 'coverage-json']) $(id).disabled = !draft;
  const canPublish = draft && !state.rulesDirty && !titleDirty && state.validatedKey === examKey(exam);
  $('publish-package').classList.toggle('hidden', !draft);
  $('publish-package').disabled = !canPublish || state.publishBusy || state.validationBusy;
  $('step-review-title').textContent = published ? 'Review published activity' : 'Review and publish';
  $('review-intro').textContent = published ? 'View questions and the faculty answer key.'
    : 'Check each question, answer, and source before publishing.';
  $('validate-package').disabled = !draft || state.validationBusy;
  $('validate-package').classList.toggle('hidden', !draft || (!state.validationErrors.length && !!state.validatedKey));
  $('review-edit-rules').classList.toggle('hidden', !draft);
  $('review-edit-rules').disabled = !draft;
  $('ai-check').disabled = !exam || !state.sources.length || !state.aiReady;
  $('source-check-details').classList.toggle('hidden', !state.sources.length);
  $('create-run').disabled = !!runIssue || state.runBusy;
  $('run-setup-status').textContent = runIssue || 'Ready to create a run.';
  $('run-class-status').textContent = chosenClass ? `${chosenClass.studentCount} students · ${chosenClass.section}` : 'Choose a saved class.';
  const className = $('class-name').value.trim(), classSection = $('class-section').value.trim();
  const classFileSelected = $('class-file').files.length > 0;
  $('class-form-title').textContent = state.editingClassId ? 'Edit class' : 'Add class';
  $('class-save').textContent = state.editingClassId ? 'Save changes' : 'Save class';
  $('class-save').disabled = state.classBusy || !className || className.length > 80 || !classSection || classSection.length > 40 ||
    (!state.editingClassId && !state.pendingClassRoster?.length) || (classFileSelected && !state.pendingClassRoster?.length);
  $('class-cancel').classList.toggle('hidden', !state.editingClassId);
  $('run-exam-label').textContent = !exam ? 'Select an activity first.'
    : published ? `${exam.title} · v${exam.version}` : 'Publish this version before creating a run.';
  $('load-results').disabled = !$('results-run').value;
  $('export-results').disabled = !$('results-run').value;
  $('save-run-name').disabled = !selectedRun || !name || name === selectedRun.name;
  const aiDuration = Number($('ai-duration').value), aiMissions = aiGroupCount();
  const aiQuestions = Number($('ai-questions').value);
  const isCtf = $('ai-kind').value === 'ctf';
  $('ai-missions-wrap').classList.toggle('hidden', !isCtf);
  $('ai-count-help').textContent = isCtf
    ? Number.isInteger(aiMissions) && aiMissions >= 1 && aiMissions <= 5
      ? `${aiMissions} missions need ${aiMissions}–${aiMissions * 4} questions total.` : 'Choose 1–5 missions.'
    : Number.isInteger(aiQuestions) && aiQuestions >= 1 && aiQuestions <= 20
      ? `${Math.ceil(aiQuestions / 4)} section${aiQuestions > 4 ? 's' : ''} for ${aiQuestions} questions.` : 'Choose 1–20 questions.';
  $('ai-rules-summary').textContent = `${aiDuration || 40} minutes · Default: 2 retries, 1 point and 10 seconds off per retry. Edit rules before publishing if needed.`;
  let generateHelp = '';
  if (state.aiBusy) generateHelp = 'Generating your preview…';
  else if (!state.aiReady) generateHelp = 'Preview is unavailable because the server AI key is missing or AI status could not be loaded.';
  else if (!$('ai-title').value.trim()) generateHelp = 'Enter an activity name.';
  else if (!$('ai-subject').value.trim()) generateHelp = 'Enter a subject.';
  else if (!materialFileReady($('ai-source').files[0])) generateHelp = 'Choose a supported teaching source (PDF, PPTX, TXT, or MD, up to 10 MB).';
  else if (!Number.isInteger(aiDuration) || aiDuration < 5 || aiDuration > 180) generateHelp = 'Set a duration from 5 to 180 minutes.';
  else if (!Number.isInteger(aiQuestions) || aiQuestions < 1 || aiQuestions > 20) generateHelp = 'Set 1–20 questions.';
  else if ($('ai-question-mode').value === 'mixed' && validateQuestionMix(readQuestionMix(), aiQuestions).length) generateHelp = validateQuestionMix(readQuestionMix(), aiQuestions)[0];
  else if (!Number.isInteger(aiMissions) || aiMissions < 1 || aiMissions > 5) generateHelp = 'Set 1–5 missions.';
  else if (isCtf && aiQuestions < aiMissions) generateHelp = `You set ${aiMissions} missions, so choose at least ${aiMissions} questions (one per mission).`;
  else if (isCtf && aiQuestions > aiMissions * 4) generateHelp = `${aiMissions} missions can contain up to ${aiMissions * 4} questions total.`;
  $('ai-generate').disabled = !!generateHelp;
  $('ai-generate-help').textContent = generateHelp || 'Ready to generate preview.';
  if (state.aiProposal && !aiConfigMatches()) $('ai-save').disabled = true;
  if (state.aiBusy) $('ai-save').disabled = true;
  $('ai-save-row').classList.toggle('hidden', !state.aiProposal);
  $('ai-discard').classList.toggle('hidden', !state.aiProposal);
  for (const option of $('faculty-mobile-nav').options) option.disabled = !state.libraryReady || !stepAllowed(option.value);
  renderActivityWorkflow();
  renderRunSummary();
  $('results-empty').classList.toggle('hidden', state.runs.length > 0);
  $('results-settings').classList.toggle('hidden', !state.runs.length);
}

function renderActivityWorkflow() {
  const target = $('activity-workflow');
  clear(target);
  const creating = state.step === 'exams' && state.activityMode === 'create';
  target.classList.toggle('hidden', ['classes', 'results'].includes(state.step) || (!state.selectedExam && !creating));
  const published = !creating && state.selectedExam?.status === 'published';
  const current = creating || state.step === 'exams' ? 0 : state.step === 'run' ? 3
    : published || state.validatedKey ? 2 : 1;
  for (const [index, [label, step]] of [['Draft', 'exams'], ['Review', 'review'], [published ? 'Published' : 'Publish', 'review'], ['Run', 'run']].entries()) {
    const item = node('li', index < current || published && index < 3 ? 'is-complete' : '');
    const button = node('button', '', `${index + 1} · ${label}`);
    button.type = 'button'; button.disabled = !stepAllowed(step);
    if (index === current) button.setAttribute('aria-current', 'step');
    button.addEventListener('click', () => showStep(step));
    item.append(button); target.append(item);
  }
}

function renderRunSummary() {
  const target = $('run-summary');
  clear(target);
  if (!state.examDetail || state.selectedExam?.status !== 'published') return;
  const exam = state.examDetail.public;
  const chosenClass = state.classes.find(item => item.id === $('run-class').value);
  const days = Number($('run-duration-days').value);
  target.append(node('h2', '', 'Before you create this run'),
    node('strong', '', `${exam.title} · v${exam.version}`),
    node('p', '', `${exam.settings.durationMinutes} minutes per student · ${chosenClass ? `${chosenClass.name} · ${chosenClass.studentCount} students` : 'Choose a class'}`));
  if (Number.isInteger(days) && days >= 1 && days <= 365)
    target.append(node('p', '', `Students may join until ${localDateTime(Date.now() + days * 86400_000)}. All attempts end by this time.`));
  target.append(node('p', 'small', $('run-feedback-mode').value === 'graded'
    ? 'Graded: scores stay hidden until you publish them or the run closes.'
    : 'Practice: students see correctness and scores immediately.'),
    node('p', 'small', $('run-shuffle-questions').checked ? 'Questions shuffled within each section or mission.' : 'Questions shown in the authored order.'));
}

$('faculty-mobile-nav').addEventListener('change', () => {
  showStep($('faculty-mobile-nav').value);
  $('faculty-mobile-nav').value = state.step;
});

for (const button of document.querySelectorAll('[data-step-link], [data-go-step]')) {
  button.addEventListener('click', () => showStep(button.dataset.stepLink || button.dataset.goStep));
}

async function loadConfig() {
  try {
    const config = await request('/api/config');
    document.title = `${config.platformLabel} · Faculty Studio`;
    $('platform-label').textContent = config.platformLabel;
    $('platform-tagline').textContent = config.platformTagline || 'Gotta Catch Ed All';
  } catch { /* use default label */ }
}

function showInstructor() {
  const hasToken = state.instructorAuthenticated;
  $('instructor-login-panel').classList.toggle('hidden', hasToken);
  $('instructor-workspace').classList.toggle('hidden', !hasToken);
  $('instructor-logout').classList.toggle('hidden', !hasToken);
  if (hasToken) {
    state.libraryReady = false;
    showStep(state.step);
    loadAiStatus();
    refreshLibrary().then(async () => {
      if (state.selectedExam) await loadSources();
      await loadAiWork();
      state.libraryReady = true;
      showStep(stepAllowed(state.step) ? state.step : 'exams');
      renderWorkflowState();
    }).catch(error => {
      if (error.message.includes('UNAUTHORIZED')) {
        state.instructorAuthenticated = false;
        runAccess.clear();
        showInstructor();
        message('Faculty session expired. Please sign in again.');
      } else {
        message(error.message);
      }
    });
  }
}

$('instructor-login').addEventListener('submit', event => {
  event.preventDefault();
  perform(async () => {
    await request('/api/instructor/login', {
      method: 'POST',
      data: { password: $('instructor-password').value }
    });
    state.instructorAuthenticated = true;
    $('instructor-password').value = '';
    showInstructor();
    message('Faculty session authenticated.');
  });
});

$('instructor-logout').addEventListener('click', () => perform(async () => {
  await state.aiSaveQueue.catch(() => {});
  try { await request('/api/instructor/logout', { method: 'POST' }); }
  catch (error) { if (error.status !== 401) throw error; }
  state.instructorAuthenticated = false;
  runAccess.clear();
  clearLegacyCredentials();
  state.pendingClassRoster = null;
  state.classes = [];
  state.selectedClassId = '';
  state.classDetail = null;
  state.editingClassId = '';
  state.examDetail = null;
  state.selectedExam = null;
  state.libraryReady = false;
  state.aiProposal = null;
  state.aiInput = null;
  state.aiEditors = [];
  setActivityMode('library');
  clear($('ai-preview'));
  $('ai-selection').textContent = '';
  $('ai-save').disabled = true;
  invalidateValidation();
  state.policyEditors = [];
  $('created-run').textContent = '';
  $('package-json').value = '';
  clear($('policy-editor'));
  clear($('answer-key'));
  $('run-access-text').value = '';
  $('run-access').classList.add('hidden');
  $('proctor-share-text').value = '';
  $('proctor-share').classList.add('hidden');
  $('proctor-access').classList.add('hidden');
  showStep('exams');
  window.location.reload();
}));

$('new-activity').addEventListener('click', () => {
  setActivityMode('create');
  $('ai-title').focus();
});
$('manage-activities').addEventListener('click', () => setActivityMode('library'));
$('ai-discard').addEventListener('click', () => perform(async () => {
  await state.aiSaveQueue.catch(() => {});
  await request('/api/instructor/ai/proposal', { method: 'DELETE' });
  state.aiProposal = null; state.aiInput = null; state.aiEditors = [];
  clear($('ai-preview')); $('ai-selection').textContent = '';
  $('ai-recovery-status').textContent = '';
  $('ai-status').textContent = 'Preview discarded. Change the setup or generate again.';
  renderWorkflowState();
}));

$('copy-run-access').addEventListener('click', async () => {
  const field = $('run-access-text');
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(field.value);
    message('Student access details copied.');
  } catch {
    field.focus();
    field.select();
    message('Details selected. Press Ctrl+C to copy.');
  }
});

$('refresh-library').addEventListener('click', () => perform(refreshLibrary));

async function loadAiStatus() {
  request('/api/instructor/code/status', { silent: true }).then(result => {
    $('coding-runtime-status').textContent = `${result.message} Coding questions show sample input and expected output.`;
  }).catch(() => { $('coding-runtime-status').textContent = 'Coding runtime status unavailable. Coding questions include sample input and expected output.'; });
  try {
    const result = await request('/api/instructor/ai/status');
    state.aiReady = result.available;
    $('ai-status').textContent = result.available
      ? 'AI ready. Review answers before publishing.'
      : 'AI needs a server key.';
    renderWorkflowState();
  } catch { $('ai-status').textContent = 'AI status is unavailable.'; }
}

function answerPreview(answer) {
  if (typeof answer === 'boolean') return answer ? 'True' : 'False';
  if (Array.isArray(answer)) return answer.join(' → ');
  if (answer && typeof answer === 'object')
    return `${answer.value} ${answer.unit || ''} (tolerance ±${answer.tolerance})`;
  return String(answer ?? 'Missing');
}

const selectedAiQuestions = () => state.aiEditors.flatMap((editor, missionIndex) =>
  editor.questions.flatMap((question, questionIndex) => question.checkbox.checked ? [`${missionIndex}:${questionIndex}`] : []));

function queueAiWorkSave() {
  if (!state.aiProposal || !state.aiInput) return;
  const snapshot = { input: state.aiInput, proposal: state.aiProposal, selected: selectedAiQuestions() };
  state.aiSaveQueue = state.aiSaveQueue.catch(() => {}).then(() =>
    request('/api/instructor/ai/proposal', { method: 'PUT', data: snapshot }));
  state.aiSaveQueue.catch(() => { $('ai-recovery-status').textContent = 'Preview could not be saved for recovery.'; });
}

async function loadAiWork() {
  const saved = await request('/api/instructor/ai/proposal');
  if (!saved) return;
  state.aiInput = saved.input;
  state.aiProposal = saved.proposal;
  for (const [id, value] of Object.entries({
    'ai-title': saved.input.title, 'ai-subject': saved.input.subject,
    'ai-kind': saved.input.kind, 'ai-difficulty': saved.input.difficulty,
    'ai-duration': saved.input.durationMinutes, 'ai-questions': saved.input.questionCount,
    'ai-missions': saved.input.missionCount, 'ai-custom-prompt': saved.input.customPrompt || '',
    'ai-question-mode': saved.input.questionMode || 'auto', 'ai-programming-language': saved.input.programmingLanguage || 'auto'
  })) $(id).value = String(value ?? '');
  if (saved.input.questionMode === 'mixed') for (const [type, input] of mixInputs) input.value = String(saved.input.questionTypeCounts?.[type] ?? 0);
  syncQuestionMix();
  $('ai-recovery-status').textContent = `Recovered preview · ${saved.input.source.filename}`;
  $('ai-status').textContent = 'Review answers and approve questions.';
  renderAiPreview(saved.proposal, new Set(saved.selected));
  setActivityMode('create');
}

function questionEditor(activity, saveEdited) {
  const details = node('details', 'ai-evidence');
  details.append(node('summary', '', 'Edit question'));
  const form = node('form', 'stack ai-edit-form');
  const field = (labelText, tag = 'input') => {
    const label = node('label', '', labelText), input = node(tag);
    if (tag === 'input') input.type = 'text';
    label.append(input); form.append(label);
    return { label, input };
  };
  const type = field('Question type', 'select');
  for (const { id, label } of questionTypes) {
    const option = node('option', '', label); option.value = id; type.input.append(option);
  }
  type.input.value = [...type.input.options].some(option => option.value === activity.type) ? activity.type : 'single_choice';
  const prompt = field('Question · fence code with ```python, ```php, ```sql, or ```javascript', 'textarea'); prompt.input.value = activity.prompt || ''; prompt.input.required = true;
  const options = field('Options · one per line', 'textarea'); options.input.value = (activity.options || []).join('\n');
  const answer = field('Correct answer · one per line for multiple answers', 'textarea');
  answer.input.value = Array.isArray(activity.answer) ? activity.answer.join('\n') : String(activity.answer ?? '');
  const truth = field('Correct answer', 'select');
  for (const value of ['true', 'false']) { const option = node('option', '', value); option.value = value; truth.input.append(option); }
  truth.input.value = String(activity.answer === true);
  const numericValue = field('Number'); numericValue.input.type = 'number'; numericValue.input.step = 'any';
  numericValue.input.value = activity.answer?.value ?? '';
  const tolerance = field('Tolerance'); tolerance.input.type = 'number'; tolerance.input.min = '0'; tolerance.input.step = 'any';
  tolerance.input.value = activity.answer?.tolerance ?? '0';
  const unit = field('Unit'); unit.input.value = activity.answer?.unit ?? '';
  const quote = field('Source quote · optional', 'textarea'); quote.input.value = activity.evidenceQuote || '';
  const location = field('Slide or page · optional'); location.input.value = activity.location || '';
  const coding = createCodeQuestionEditor(activity); form.append(coding.element);
  const matching = createMatchingEditor(activity); form.append(matching.element);
  const table = createTableQuestionEditor(activity); form.append(table.element);
  const sync = () => {
    const value = type.input.value;
    options.label.hidden = !['single_choice', 'multiple_choice', 'sequencing'].includes(value);
    options.input.required = !options.label.hidden;
    coding.element.hidden = value !== 'code_writing';
    matching.element.hidden = value !== 'matching';
    table.element.hidden = !['data_inspection', 'datatable_code'].includes(value); table.setType(value);
    for (const editor of [coding, matching, table]) for (const control of editor.element.querySelectorAll('input,select,textarea,button')) control.disabled = editor.element.hidden;
    answer.label.hidden = ['true_false', 'numeric_entry', 'code_writing', 'matching', 'data_inspection', 'datatable_code'].includes(value);
    answer.input.required = !answer.label.hidden;
    truth.label.hidden = value !== 'true_false';
    for (const item of [numericValue, tolerance, unit]) {
      item.label.hidden = value !== 'numeric_entry';
      item.input.required = value === 'numeric_entry' && item !== unit;
      item.input.disabled = value !== 'numeric_entry';
    }
    answer.label.firstChild.textContent = value === 'single_choice'
      ? 'Correct option text · match one option exactly' : 'Correct answer · one per line for multiple answers';
  };
  type.input.addEventListener('change', sync); sync();
  const actions = node('div', 'button-row'), save = node('button', 'primary', 'Save question');
  save.type = 'submit'; actions.append(save);
  const cancel = node('button', '', 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', () => { details.open = false; });
  actions.append(cancel); form.append(actions);
  form.addEventListener('submit', event => {
    event.preventDefault();
    perform(async () => {
      const value = type.input.value;
      const lines = text => text.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
      const edited = { ...activity, type: value, prompt: prompt.input.value.trim(),
        evidenceQuote: quote.input.value.trim(), location: location.input.value.trim(),
        sourceMatchPercent: null, sourceMatchReason: 'Edited by faculty; source match was not re-estimated.' };
      if (['single_choice', 'multiple_choice', 'sequencing'].includes(value)) edited.options = lines(options.input.value);
      else delete edited.options;
      edited.answer = value === 'true_false' ? truth.input.value === 'true'
        : value === 'numeric_entry' ? { value: Number(numericValue.input.value),
          tolerance: Number(tolerance.input.value), unit: unit.input.value.trim() }
          : value === 'single_choice' ? answer.input.value.trim() : lines(answer.input.value);
      if (value === 'code_writing') {
        Object.assign(edited, coding.value());
        delete edited.answer;
      }
      if (value === 'matching') { Object.assign(edited, matching.value()); delete edited.answer; }
      if (['data_inspection', 'datatable_code'].includes(value)) Object.assign(edited, table.value(value));
      save.disabled = true;
      try { await saveEdited(edited); } finally { save.disabled = false; }
    });
  });
  details.append(form);
  return details;
}

function updateAiApprovals() {
  let approvedMissions = 0;
  let approvedQuestions = 0;
  let overLimit = false;
  const selectedScores = [];
  for (const editor of state.aiEditors) {
    let selected = 0;
    const available = editor.questions.filter(question => question.ready);
    for (const question of editor.questions) {
      question.checkbox.disabled = !question.eligible;
      if (question.checkbox.checked) {
        selected++;
        if (question.sourceMatchPercent !== null) selectedScores.push(question.sourceMatchPercent);
      }
    }
    editor.mission.checked = available.length > 0 && available.every(question => question.checkbox.checked);
    editor.mission.indeterminate = !editor.mission.checked && available.some(question => question.checkbox.checked);
    editor.mission.disabled = available.length === 0;
    editor.summary.textContent = `${editor.heading} · ${selected}/${editor.questions.length} approved`;
    if (selected) approvedMissions++;
    approvedQuestions += selected;
    if (selected > 4) overLimit = true;
  }
  const word = groupWord(state.aiInput || { kind: $('ai-kind').value });
  const totalQuestions = state.aiEditors.reduce((sum, editor) => sum + editor.questions.length, 0);
  const count = `${approvedQuestions} of ${totalQuestions} questions approved · ${approvedMissions} ${word}${approvedMissions === 1 ? '' : 's'}`;
  const average = selectedScores.length === approvedQuestions && selectedScores.length
    ? ` · ${Math.round(selectedScores.reduce((sum, score) => sum + score, 0) / selectedScores.length)}% source match (AI estimate)` : '';
  $('ai-selection').textContent = !state.aiProposal ? '' : overLimit ? `${count}. Limit: 4 questions per ${word}.`
    : approvedMissions > 5 ? `${count}. Limit: 5 ${word}s.`
      : count + average;
  const setupMatches = aiConfigMatches();
  if (state.aiProposal && !setupMatches)
    $('ai-selection').textContent = `Setup changed. Generate a new preview before saving. ${count}${average}.`;
  $('ai-save').disabled = !approvedQuestions || overLimit || approvedMissions > 5 || !setupMatches;
  $('ai-next-unreviewed').disabled = approvedQuestions === totalQuestions;
  for (const editor of state.aiEditors) for (const question of editor.questions)
    question.card.classList.toggle('is-approved', question.checkbox.checked);
}

$('ai-next-unreviewed').addEventListener('click', () => {
  const questions = state.aiEditors.flatMap(editor => editor.questions);
  for (let offset = 1; offset <= questions.length; offset++) {
    const index = (state.aiReviewCursor + offset) % questions.length;
    const question = questions[index];
    if (question.checkbox.checked) continue;
    state.aiReviewCursor = index;
    question.section.open = true;
    question.card.focus({ preventScroll: true });
    question.card.scrollIntoView({ block: 'start', behavior: 'auto' });
    break;
  }
});

async function mutateAiDesign(change, openMissionIndex) {
  if (state.aiBusy) return;
  const design = { ...structuredClone(state.aiProposal.design), missions: (Array.isArray(state.aiProposal.design?.missions) ? state.aiProposal.design.missions : []).map(mission =>
    ({ ...structuredClone(mission), activities: structuredClone(Array.isArray(mission?.activities) ? mission.activities : []) })) };
  const approved = new Set([...selectedAiQuestions()].map(key => {
    const [mission, question] = key.split(':').map(Number); return design.missions[mission]?.activities[question];
  }));
  change(design);
  const selected = new Set(design.missions.flatMap((mission, mi) => mission.activities.flatMap((question, qi) => approved.has(question) ? [`${mi}:${qi}`] : [])));
  state.aiBusy = true;
  const controls = [...$('ai-preview').querySelectorAll('button,input,select,textarea')].map(control => [control, control.disabled]);
  for (const [control] of controls) control.disabled = true;
  try {
    state.aiProposal = await request('/api/instructor/ai/inspect', { method: 'POST', data: { ...state.aiInput, design } });
    renderAiPreview(state.aiProposal, selected, openMissionIndex); queueAiWorkSave();
  } finally {
    for (const [control, disabled] of controls) if (control.isConnected) control.disabled = disabled;
    state.aiBusy = false; updateAiApprovals(); renderWorkflowState();
  }
}

function renderAiPreview(proposal, selected = new Set(), openMissionIndex = 0) {
  const target = $('ai-preview');
  clear(target);
  state.aiEditors = [];
  state.aiReviewCursor = -1;
  target.append(node('h2', '', 'Review questions'));
  target.append(node('p', 'ai-score', `Source match: ${proposal.sourceMatchPercent === null ? 'unavailable' : `${proposal.sourceMatchPercent}%`} · AI estimate`));
  target.append(node('p', 'small', 'Change any question type, add your own questions, or rearrange the draft. Approve the questions you want to keep.'));
  const word = groupWord(state.aiInput);
  if (proposal.missions.length !== state.aiInput.missionCount)
    target.append(node('p', 'small', `Preview: ${proposal.missions.length} ${word}s. Originally requested: ${state.aiInput.missionCount}. You may keep your edited layout.`));
  const generatedQuestions = proposal.missions.reduce((total, group) => total + group.questions.length, 0);
  if (generatedQuestions !== state.aiInput.questionCount)
    target.append(node('p', 'small', `Preview: ${generatedQuestions} questions. Originally requested: ${state.aiInput.questionCount}. You may approve a different count.`));
  for (const [missionIndex, rawMission] of (Array.isArray(proposal.design?.missions) ? proposal.design.missions : []).entries()) {
    const mission = { ...(rawMission && typeof rawMission === 'object' ? rawMission : {}), activities: Array.isArray(rawMission?.activities) ? rawMission.activities : [] };
    const inspection = proposal.missions[missionIndex];
    const section = node('details', 'ai-mission');
    section.open = missionIndex === openMissionIndex;
    const heading = `${missionIndex + 1}. ${inspection.title}`;
    const summary = node('summary', '', heading);
    section.append(summary);
    const approval = node('label', 'ai-approval');
    const missionCheckbox = document.createElement('input');
    missionCheckbox.type = 'checkbox';
    approval.append(missionCheckbox, node('span', '', 'Approve all questions'));
    section.append(approval);
    const groupActions = node('div', 'button-row');
    const addQuestion = node('button', '', 'Add question'); addQuestion.type = 'button'; addQuestion.disabled = mission.activities.length >= 4;
    addQuestion.addEventListener('click', () => perform(() => mutateAiDesign(design => {
      design.missions[missionIndex].activities.push({ type: 'single_choice', prompt: '', options: ['Option A', 'Option B'], answer: 'Option A',
        sourceMatchPercent: null, sourceMatchReason: 'Added by faculty.' });
    }, missionIndex)));
    const removeSection = node('button', 'text-button', `Remove ${word}`); removeSection.type = 'button';
    removeSection.addEventListener('click', () => perform(() => mutateAiDesign(design => { design.missions.splice(missionIndex, 1); }, Math.max(0, missionIndex - 1))));
    groupActions.append(addQuestion, removeSection); section.append(groupActions);
    if (mission.story) section.append(node('p', 'small', mission.story));
    const editor = { mission: missionCheckbox, summary, heading, questions: [] };
    for (const [questionIndex, rawActivity] of (Array.isArray(mission.activities) ? mission.activities : []).entries()) {
      const activity = rawActivity && typeof rawActivity === 'object' ? rawActivity : {};
      const result = inspection.questions[questionIndex];
      const card = node('div', 'ai-question');
      card.tabIndex = -1;
      const questionApproval = node('label', 'ai-approval');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      const eligible = result.ready;
      checkbox.disabled = !eligible;
      checkbox.checked = eligible && selected.has(`${missionIndex}:${questionIndex}`);
      questionApproval.append(checkbox, node('span', '', `Approve question ${questionIndex + 1}`));
      card.append(questionApproval);
      card.append(node('p', 'small', questionTypes.find(type => type.id === activity.type)?.label || activity.type || 'Choose a type'));
      card.append(renderPrompt(activity.prompt || 'No question prompt', 'ai-prompt'));
      if (Array.isArray(activity.options) && activity.options.length) {
        const options = node('ol', 'ai-options');
        for (const option of activity.options) options.append(node('li', '', option));
        card.append(options);
      }
      if (activity.type === 'code_writing' && result.ready) {
        appendCodeExamples(card, activity);
        const reference = node('details', 'ai-evidence'); reference.append(node('summary', '', 'Reference solution and grading tests'));
        reference.append(renderPrompt(`\`\`\`${activity.language}\n${activity.referenceCode || ''}\n\`\`\``));
        activity.tests.forEach((test, index) => {
          reference.append(node('p', 'small', `Grading test ${index + 1} · Input`), node('pre', '', test.input || '(no input)'),
            node('p', 'small', 'Expected output'), node('pre', '', test.output || '(empty output)'));
        });
        card.append(reference);
        const check = node('button', '', 'Check reference solution'); check.type = 'button';
        const checked = node('p', 'small'); checked.setAttribute('role', 'status');
        check.addEventListener('click', () => perform(async () => {
          check.disabled = true; checked.textContent = 'Checking reference solution…';
          try {
            const samples = [];
            for (let offset = 0; offset < activity.tests.length; offset += 3) {
              const config = { language: activity.language, starterCode: '', samples: activity.tests.slice(offset, offset + 3), comparison: activity.comparison };
              const result = await request('/api/instructor/code/preview', { method: 'POST', data: { config, value: activity.referenceCode } });
              samples.push(...result.samples);
            }
            checked.textContent = samples.every(sample => sample.matches) ? 'Reference solution passes all tests.'
              : samples.map((sample, index) => `Test ${index + 1}: ${sample.matches ? 'passed' : `failed. ${sample.error || sample.output}`}`).join('\n');
          } finally { check.disabled = false; }
        }));
        card.append(check, checked);
      } else if (activity.type === 'matching') {
        card.append(node('p', 'ai-answer', 'Correct matching pairs · faculty only'));
        for (const pair of activity.pairs || []) card.append(node('p', 'small', `${pair.left} → ${pair.right}`));
      } else if (['data_inspection', 'datatable_code'].includes(activity.type)) {
        card.append(node('p', 'small', 'Table data'), node('pre', 'table-question-preview', (activity.table?.rows || []).map(row =>
          (activity.table?.columns || []).map(column => `${column.label}: ${row[column.id]}`).join(' · ')).join('\n')));
        card.append(node('p', 'ai-answer', 'Target settings · faculty only'), node('pre', 'table-question-preview',
          Object.entries(activity.answer || {}).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join('\n')));
      } else card.append(node('p', 'ai-answer', `Correct answer: ${answerPreview(activity.answer)}`));
      card.append(node('p', 'ai-score', `Source match: ${result.sourceMatchPercent === null ? 'unavailable' : `${result.sourceMatchPercent}%`} · AI estimate`));
      if (!result.ready) card.append(node('p', 'ai-issue', result.issue));
      if (result.sourceMatchReason || result.evidence?.quote) {
        const evidence = node('details', 'ai-evidence');
        evidence.append(node('summary', '', 'Source detail'));
        if (result.sourceMatchReason) evidence.append(node('p', 'small', result.sourceMatchReason));
        if (result.evidence?.quote) {
          evidence.append(node('p', 'small', `${result.evidence.file} · ${result.evidence.location}`));
          evidence.append(node('blockquote', '', result.evidence.quote));
        }
        card.append(evidence);
      }
      if (!eligible) card.append(node('p', 'small', 'Question format needs correction before saving.'));
      card.append(questionEditor(activity, async edited => {
        await mutateAiDesign(design => { design.missions[missionIndex].activities[questionIndex] = edited; }, missionIndex);
        message('Question updated. Check its format and answer before approval.');
      }));
      const questionActions = node('div', 'button-row');
      for (const [label, transform, disabled] of [
        ['Move up', items => { [items[questionIndex - 1], items[questionIndex]] = [items[questionIndex], items[questionIndex - 1]]; }, questionIndex === 0],
        ['Move down', items => { [items[questionIndex + 1], items[questionIndex]] = [items[questionIndex], items[questionIndex + 1]]; }, questionIndex === mission.activities.length - 1],
        ['Duplicate question', items => items.splice(questionIndex + 1, 0, structuredClone(items[questionIndex])), mission.activities.length >= 4],
        ['Remove question', items => items.splice(questionIndex, 1), false]
      ]) {
        const button = node('button', 'text-button', label); button.type = 'button'; button.disabled = disabled;
        button.addEventListener('click', () => perform(() => mutateAiDesign(design => transform(design.missions[missionIndex].activities), missionIndex)));
        questionActions.append(button);
      }
      card.append(questionActions);
      editor.questions.push({ checkbox, card, section, eligible, ready: result.ready, sourceMatchPercent: result.sourceMatchPercent, activity });
      checkbox.addEventListener('change', () => { updateAiApprovals(); queueAiWorkSave(); });
      section.append(card);
    }
    missionCheckbox.addEventListener('change', () => {
      for (const question of editor.questions) if (question.eligible) question.checkbox.checked = missionCheckbox.checked;
      updateAiApprovals();
      queueAiWorkSave();
    });
    state.aiEditors.push(editor);
    target.append(section);
  }
  const addSection = node('button', '', `Add ${word}`); addSection.type = 'button'; addSection.disabled = (proposal.design?.missions?.length ?? 0) >= 5;
  addSection.addEventListener('click', () => perform(() => mutateAiDesign(design => { design.missions.push({ title: `New ${word}`, activities: [] }); }, proposal.design.missions.length)));
  target.append(addSection);
  updateAiApprovals();
}

$('ai-generate').addEventListener('click', () => perform(async () => {
  const file = $('ai-source').files[0];
  if (!file) throw new Error('Choose a teaching source first.');
  $('ai-save').disabled = true;
  state.aiBusy = true;
  renderWorkflowState();
  $('ai-status').textContent = 'Extracting material…';
  try {
    const source = await extractFile(file);
    if (source.content.length > 60000) throw new Error('This material has more than 60,000 text characters. Use a shorter source for AI drafting.');
    $('ai-status').textContent = `Extracted ${source.sections} ${source.sectionLabel}. Generating draft…`;
    const input = {
      title: $('ai-title').value.trim(), subject: $('ai-subject').value.trim(),
      kind: $('ai-kind').value, difficulty: $('ai-difficulty').value,
      questionMode: $('ai-question-mode').value, programmingLanguage: $('ai-programming-language').value,
      ...($('ai-question-mode').value === 'mixed' ? { questionTypeCounts: positiveTypeCounts(readQuestionMix()) } : {}),
      durationMinutes: Number($('ai-duration').value), questionCount: Number($('ai-questions').value),
      missionCount: aiGroupCount(), customPrompt: $('ai-custom-prompt').value.trim(), source
    };
    const proposal = await request('/api/instructor/ai/propose', { method: 'POST', data: input });
    state.aiInput = input;
    state.aiProposal = proposal;
    renderAiPreview(proposal);
    $('ai-recovery-status').textContent = `Preview saved for this faculty session · ${source.filename}`;
    queueAiWorkSave();
    $('ai-status').textContent = 'Preview ready. Review answers and approve questions.';
  } catch (error) {
    $('ai-status').textContent = error.message;
  } finally {
    state.aiBusy = false;
    if (state.aiProposal) updateAiApprovals();
    renderWorkflowState();
  }
}));

$('ai-save').addEventListener('click', () => perform(async () => {
  if (state.aiBusy || $('ai-save').disabled) return;
  if (!state.aiProposal || !state.aiInput) throw new Error('Generate a preview first.');
  state.aiBusy = true;
  renderWorkflowState();
  try {
    const missions = state.aiEditors.flatMap((editor, missionIndex) => {
      const activities = editor.questions.flatMap(question => {
        if (!question.checkbox.checked) return [];
        const activity = { ...question.activity };
        delete activity.manualRationale;
        return [activity];
      });
      if (!activities.length) return [];
      if (activities.length > 4) throw new Error(`${groupWord(state.aiInput)} ${missionIndex + 1} can have at most four approved questions.`);
      return [{ ...state.aiProposal.design.missions[missionIndex], activities }];
    });
    if (!missions.length) throw new Error(`Approve at least one ${groupWord(state.aiInput)} and question.`);
    const created = await request('/api/instructor/ai/approved-draft', { method: 'POST',
      data: { ...state.aiInput, missions } });
    await state.aiSaveQueue.catch(() => {});
    await request('/api/instructor/ai/proposal', { method: 'DELETE' }).catch(() => {});
    state.selectedExam = created;
    state.sources = [];
    state.aiProposal = null;
    state.aiInput = null;
    state.aiEditors = [];
    $('ai-save').disabled = true;
    clear($('ai-preview'));
    $('ai-selection').textContent = '';
    $('ai-recovery-status').textContent = '';
    invalidateValidation();
    await refreshLibrary();
    setActivityMode('library');
    await loadSources();
    showStep('review');
    message('Draft saved. Review the questions and publish when ready.');
  } finally {
    state.aiBusy = false;
    if (state.aiProposal) updateAiApprovals();
    renderWorkflowState();
  }
}));

function resetClassForm() {
  state.editingClassId = '';
  state.pendingClassRoster = null;
  $('class-form').reset();
  $('class-roster-status').textContent = 'Choose a roster file.';
  renderWorkflowState();
}

function renderClassDetail() {
  const target = $('class-detail');
  if (state.classTable) { state.classTable.destroy(); state.classTable = null; }
  clear(target);
  const selectedClass = state.classDetail;
  if (!selectedClass) return;
  const details = node('details', 'json-collapse');
  details.open = true;
  details.append(node('summary', '', `Students · ${selectedClass.studentCount}`));
  const form = node('form', 'student-editor');
  form.id = 'student-editor';
  const heading = node('h3', '', 'Add student');
  form.append(heading);
  const fields = node('div', 'student-fields');
  const columns = [
    ['candidateId', 'School ID', 40, true], ['displayName', 'Name', 120, true],
    ['gender', 'Gender', 120, false], ['yearLevel', 'Year', 120, false],
    ['programShortName', 'Program', 120, false]
  ];
  for (const [key, label, maxLength, required] of columns) {
    const field = node('label', '', label), input = node('input');
    input.name = key; input.type = 'text'; input.maxLength = maxLength; input.required = required;
    if (key === 'candidateId') input.pattern = '[A-Za-z0-9-]{1,40}';
    field.append(input); fields.append(field);
  }
  form.append(fields);
  const formActions = node('div', 'button-row');
  const save = node('button', 'primary', 'Add student'); save.type = 'submit';
  const cancel = node('button', 'hidden', 'Cancel'); cancel.type = 'button';
  const resetEditor = () => {
    state.editingStudentId = '';
    form.reset(); heading.textContent = 'Add student'; save.textContent = 'Add student';
    cancel.classList.add('hidden');
  };
  cancel.addEventListener('click', resetEditor);
  formActions.append(save, cancel); form.append(formActions);
  form.addEventListener('submit', event => {
    event.preventDefault();
    perform(async () => {
      const student = Object.fromEntries(columns.map(([key]) => [key, form.elements.namedItem(key).value.trim()]));
      const originalId = state.editingStudentId;
      save.disabled = true;
      try {
        await request(`/api/instructor/classes/${selectedClass.id}/students${originalId ? `/${originalId}` : ''}`,
          { method: originalId ? 'PUT' : 'POST', data: student });
        state.editingStudentId = '';
        await loadClasses();
        message(originalId ? 'Student updated.' : 'Student added.');
      } finally { save.disabled = false; }
    });
  });
  details.append(form);
  const wrap = node('div', 'table-wrap class-students');
  const table = node('table'), head = node('thead'), header = node('tr');
  table.className = 'display';
  for (const label of ['School ID', 'Name', 'Gender', 'Year', 'Program', 'Actions']) header.append(node('th', '', label));
  head.append(header); table.append(head);
  const body = node('tbody');
  for (const student of selectedClass.roster) {
    const row = node('tr');
    for (const value of [student.candidateId, student.displayName, student.gender, student.yearLevel, student.programShortName])
      row.append(node('td', '', value || ''));
    const actionCell = node('td');
    const actions = node('div', 'button-row');
    const edit = node('button', '', 'Edit'); edit.type = 'button';
    edit.addEventListener('click', () => {
      state.editingStudentId = student.candidateId;
      for (const [key] of columns) form.elements.namedItem(key).value = student[key] || '';
      heading.textContent = `Edit ${student.displayName}`;
      save.textContent = 'Save student'; cancel.classList.remove('hidden');
      details.open = true;
      form.scrollIntoView({ block: 'nearest' });
      form.elements.namedItem('candidateId').focus();
    });
    const remove = node('button', '', 'Delete'); remove.type = 'button';
    remove.addEventListener('click', () => perform(async () => {
      if (!window.confirm(`Remove ${student.displayName} from ${selectedClass.name}?`)) return;
      await request(`/api/instructor/classes/${selectedClass.id}/students/${student.candidateId}`, { method: 'DELETE' });
      state.editingStudentId = '';
      await loadClasses();
      message('Student removed.');
    }));
    actions.append(edit, remove); actionCell.append(actions); row.append(actionCell);
    body.append(row);
  }
  table.append(body); wrap.append(table); details.append(wrap); target.append(details);
  if (typeof window.DataTable === 'function') state.classTable = new window.DataTable(table, {
    pageLength: 10, lengthMenu: [10, 25, 50, 100],
    columnDefs: [{ targets: 5, orderable: false, searchable: false }],
    language: { emptyTable: 'No students yet. Add one above.' }
  });
  else message('DataTables could not load. Refresh the page.');
}

async function loadClasses() {
  state.classes = await request('/api/instructor/classes');
  if (!state.classes.some(item => item.id === state.selectedClassId)) state.selectedClassId = '';
  const select = $('run-class');
  clear(select);
  const blank = node('option', '', 'Choose a class'); blank.value = ''; select.append(blank);
  for (const item of state.classes) {
    const option = node('option', '', `${item.name} · ${item.section} · ${item.studentCount} students`);
    option.value = item.id; select.append(option);
  }
  select.value = state.selectedClassId;
  const list = $('class-library'); clear(list);
  if (!state.classes.length) list.append(node('p', 'small', 'No classes yet.'));
  for (const item of state.classes) {
    const row = node('div', 'list-row');
    row.classList.toggle('selected', item.id === state.selectedClassId);
    const label = node('div');
    label.append(node('strong', '', item.name), node('span', '', `${item.section} · ${item.studentCount} students`));
    const actions = node('div', 'button-row');
    const view = node('button', '', item.id === state.selectedClassId ? 'Selected' : 'Select');
    view.type = 'button'; view.disabled = item.id === state.selectedClassId;
    view.addEventListener('click', () => perform(async () => {
      state.selectedClassId = item.id;
      await loadClasses();
    }));
    const edit = node('button', '', 'Edit'); edit.type = 'button';
    edit.addEventListener('click', () => {
      state.selectedClassId = item.id;
      state.editingClassId = item.id;
      state.pendingClassRoster = null;
      $('class-name').value = item.name;
      $('class-section').value = item.section;
      $('class-file').value = '';
      $('class-roster-status').textContent = 'Upload a file only to replace this roster.';
      loadClasses().catch(error => message(error.message));
      $('class-name').focus();
    });
    const remove = node('button', '', 'Delete'); remove.type = 'button';
    remove.addEventListener('click', () => perform(async () => {
      if (!window.confirm(`Delete ${item.name}? Existing runs keep their student lists.`)) return;
      await request(`/api/instructor/classes/${item.id}`, { method: 'DELETE' });
      if (state.selectedClassId === item.id) state.selectedClassId = '';
      if (state.editingClassId === item.id) resetClassForm();
      await loadClasses();
      message('Class deleted.');
    }));
    actions.append(view, edit, remove); row.append(label, actions); list.append(row);
  }
  state.classDetail = state.selectedClassId
    ? await request(`/api/instructor/classes/${state.selectedClassId}`) : null;
  renderClassDetail();
  renderWorkflowState();
}

function renderActivityLibrary() {
  const term = $('activity-search').value.trim().toLocaleLowerCase();
  const status = $('activity-status').value, type = $('activity-type').value;
  const matches = exam => (!term || `${exam.title} ${exam.subject || ''}`.toLocaleLowerCase().includes(term)) &&
    (status === 'all' || exam.status === status) && (type === 'all' || kindOf(exam) === type);
  const active = state.exams.filter(exam => !exam.archivedAt);
  const latest = new Map();
  for (const exam of active) if (exam.status === 'published' && !latest.has(exam.examId)) latest.set(exam.examId, exam.version);
  const current = active.filter(exam => exam.status === 'draft' || exam.version === latest.get(exam.examId));
  const history = state.exams.filter(exam => !current.includes(exam));
  clear($('exam-library')); clear($('exam-history-list'));
  const open = async (exam, destination) => {
    const unsaved = titleChanged() || state.rulesDirty || $('package-json').value.trim() !== state.packageBaseline;
    if (unsaved && !window.confirm('Open this activity and discard unsaved edits to the current activity?')) return;
    state.selectedExam = exam; state.sources = []; invalidateValidation();
    await refreshLibrary(); await loadSources();
    showStep(destination === 'run' && !state.classes.length ? 'classes' : destination);
  };
  const renderRow = (exam, target) => {
    const row = node('article', 'list-row');
    row.classList.toggle('selected', examKey(exam) === examKey(state.selectedExam));
    const text = node('div', 'library-item-copy');
    text.append(node('strong', '', exam.title), node('span', '', `${kindLabel(exam)}${difficultyLabel(exam)} · v${exam.version}`),
      node('span', `status-badge status-${exam.archivedAt ? 'archived' : exam.status}`, exam.archivedAt ? 'Archived draft' : exam.status === 'draft' ? 'Draft' : 'Published'));
    const actions = node('div', 'button-row');
    if (!exam.archivedAt) {
      const view = node('button', '', exam.status === 'draft' ? 'Continue draft' : 'View activity');
      view.type = 'button'; view.addEventListener('click', () => perform(() => open(exam, 'review'))); actions.append(view);
      if (exam.status === 'published' && latest.get(exam.examId) === exam.version) {
        const run = node('button', 'primary', 'Create run'); run.type = 'button';
        run.addEventListener('click', () => perform(() => open(exam, 'run'))); actions.append(run);
      }
    }
    if (exam.status === 'draft') {
      const archive = node('button', 'text-button', exam.archivedAt ? 'Restore' : 'Archive'); archive.type = 'button';
      archive.addEventListener('click', () => perform(async () => {
        await request(`/api/instructor/assessments/${exam.examId}/${exam.version}/${exam.archivedAt ? 'restore' : 'archive'}`, { method: 'POST' });
        state.sources = []; await refreshLibrary(); await loadSources();
        message(exam.archivedAt ? 'Draft restored.' : 'Draft archived.');
      })); actions.append(archive);
    }
    row.append(text, actions); target.append(row);
  };
  const visible = current.filter(matches), visibleHistory = history.filter(matches);
  visible.forEach(exam => renderRow(exam, $('exam-library')));
  if (!visible.length) $('exam-library').append(node('p', 'empty-state', current.length ? 'No activities match these filters. Try another name or clear the filters.' : 'Create your first activity to get started.'));
  visibleHistory.forEach(exam => renderRow(exam, $('exam-history-list')));
  $('activity-match-count').textContent = `${visible.length} of ${current.length} current activities`;
  $('exam-history').hidden = !visibleHistory.length;
  $('exam-history').querySelector('summary').textContent = `Older and archived versions (${visibleHistory.length})`;
}

for (const id of ['activity-search', 'activity-status', 'activity-type'])
  $(id).addEventListener(id === 'activity-search' ? 'input' : 'change', renderActivityLibrary);

async function refreshLibrary() {
  const exams = await request('/api/instructor/assessments');
  const runs = await request('/api/instructor/runs');
  state.exams = exams;
  state.runs = runs;
  const active = exams.filter(exam => !exam.archivedAt);
  const latestPublished = new Map();
  for (const exam of active) if (exam.status === 'published' && !latestPublished.has(exam.examId))
    latestPublished.set(exam.examId, exam.version);
  const current = active.filter(exam => exam.status === 'draft' || exam.version === latestPublished.get(exam.examId));
  const history = exams.filter(exam => !current.includes(exam));
  const previousExam = examKey(state.selectedExam);
  const rememberedExam = sessionStorage.getItem('facultyExamKey');
  state.selectedExam = active.find(e => e.examId === state.selectedExam?.examId && e.version === state.selectedExam?.version)
    || current.find(e => examKey(e) === rememberedExam)
    || current.find(e => e.status === 'draft') || current[0] || null;
  if (state.selectedExam) sessionStorage.setItem('facultyExamKey', examKey(state.selectedExam));
  else sessionStorage.removeItem('facultyExamKey');
  if (examKey(state.selectedExam) !== previousExam) invalidateValidation();
  renderActivityLibrary();

  const previousRun = $('results-run').value || loadSelectedRun();
  clear($('results-run'));
  for (const run of runs) {
    const option = node('option', '', `${run.name} · v${run.version} · ${run.id.slice(0, 8)}`);
    option.value = run.id;
    $('results-run').append(option);
  }
  if (runs.some(run => run.id === previousRun)) $('results-run').value = previousRun;
  syncRunName();

  if (state.selectedExam) {
    updateRunSelection(state.selectedExam);
    state.examDetail = await request(`/api/instructor/assessments/${state.selectedExam.examId}/${state.selectedExam.version}`);
    $('exam-title-input').value = state.examDetail.public.title || '';
    $('package-json').value = JSON.stringify({ public: state.examDetail.public, private: state.examDetail.private }, null, 2);
    state.packageBaseline = $('package-json').value.trim();
    renderExamControls();
  } else {
    state.examDetail = null;
    $('exam-title-input').value = '';
    $('package-json').value = '';
    state.packageBaseline = '';
    state.rulesDirty = false;
    clear($('policy-editor'));
    clear($('answer-key'));
  }
  await loadClasses();
  renderWorkflowState();
  await perform(loadProctorAccess);
  if (state.libraryReady && state.step === 'results') await loadResults();
}

function syncRunName() {
  const runId = $('results-run').value;
  const run = state.runs.find(item => item.id === runId);
  $('results-run-name').value = run?.name || '';
  $('results-feedback-mode').textContent = run
    ? `${run.feedbackMode === 'graded' ? 'Graded' : 'Practice'} feedback · ${run.shuffleQuestions ? 'Questions shuffled within groups' : 'Question order fixed'}` : '';
  $('publish-all-scores').classList.toggle('hidden', run?.feedbackMode !== 'graded');
  $('publish-all-scores').disabled = state.results?.runId !== runId || !participationCounts(state.results.rows).readyToPublish;
  renderRunAccess(runId);
}

$('results-run').addEventListener('change', () => {
  if ($('results-run').value) saveSelectedRun($('results-run').value);
  syncRunName();
  state.results = null; state.resultsEpoch++; state.publicationNotice = null;
  clear($('results-table')); clear($('results-summary'));
  $('results-publication-message').textContent = '';
  $('results-status').value = 'all'; $('results-visibility').value = 'all'; $('results-search').value = '';
  $('student-review').classList.add('hidden');
  clear($('student-review-questions'));
  $('proctor-share-text').value = '';
  $('proctor-share').classList.add('hidden');
  perform(loadProctorAccess);
  renderWorkflowState();
  perform(loadResults);
});

$('copy-saved-run-access').addEventListener('click', async () => {
  const field = $('saved-run-access-text');
  try { await navigator.clipboard.writeText(field.value); message('Student access details copied.'); }
  catch { field.focus(); field.select(); document.execCommand('copy'); message('Student access details copied.'); }
});
$('reset-run-pin').addEventListener('click', () => perform(async () => {
  const runId = $('results-run').value;
  const pin = $('run-pin-recovery-value').value;
  if (!runId) throw new Error('Select a run first.');
  if (pin.length < 4 || pin.length > 80) throw new Error('Enter a PIN from 4 to 80 characters.');
  await request(`/api/instructor/runs/${runId}/pin`, { method: 'PUT', data: { pin } });
  const studentUrl = new URL('/app/student', window.location.href);
  studentUrl.searchParams.set('run', runId);
  saveRunAccess(runId, { url: studentUrl.href, pin });
  $('run-pin-recovery-value').value = '';
  renderRunAccess(runId);
  message('Admission PIN updated. Copy the access details before refreshing or signing out.');
}));

for (const id of ['exam-title-input', 'results-run-name', 'package-json', 'new-package-json', 'run-name-field', 'run-pin-field', 'run-duration-days',
  'ai-title', 'ai-subject', 'ai-duration', 'ai-questions', 'ai-missions', 'ai-custom-prompt'])
  $(id).addEventListener('input', () => { renderWorkflowState(); if (state.aiProposal) updateAiApprovals(); });
$('source-file').addEventListener('change', renderWorkflowState);
for (const id of ['run-feedback-mode', 'run-shuffle-questions']) $(id).addEventListener('change', renderWorkflowState);
for (const id of ['ai-source', 'ai-kind', 'ai-difficulty', 'ai-question-mode', 'ai-programming-language'])
  $(id).addEventListener('change', () => { syncQuestionMix(); renderWorkflowState(); if (state.aiProposal) updateAiApprovals(); });

$('save-run-name').addEventListener('click', () => perform(async () => {
  const runId = $('results-run').value;
  if (!runId) throw new Error('Select a run first.');
  const name = $('results-run-name').value.trim();
  await request(`/api/instructor/runs/${runId}/name`, { method: 'PUT', data: { name } });
  await refreshLibrary();
  $('results-run').value = runId;
  syncRunName();
  if ($('results-table').childElementCount) await loadResults();
  message('Run name saved.');
}));

$('save-exam-title').addEventListener('click', () => perform(async () => {
  const e = selected();
  if (e.status !== 'draft') throw new Error('Create an editable copy first.');
  const title = $('exam-title-input').value.trim();
  if (!title || title.length > 120) throw new Error('Enter a name of 1–120 characters.');
  const pub = structuredClone(state.examDetail.public);
  pub.title = title;
  await request(`/api/instructor/assessments/${e.examId}/${e.version}`, {
    method: 'PUT', data: { public: pub, private: state.examDetail.private }
  });
  invalidateValidation();
  await refreshLibrary();
  message('Name saved.');
}));

function updateRunSelection(exam) {
  $('run-exam-label').textContent = `${exam.title || exam.examId} · v${exam.version}`;
}

function policyFields(policy, editable) {
  const wrap = node('div', 'policy-fields');
  const definitions = [
    ['maxRetries', 'Retries (blank = unlimited)', 99],
    ['pointPenalty', 'Points off per retry', state.examDetail.public.settings.coreMaxPoints],
    ['timePenaltySeconds', 'Seconds off per retry', state.examDetail.public.settings.durationMinutes * 60]
  ];
  const inputs = {};
  for (const [key, labelText, max] of definitions) {
    const label = node('label', '', labelText);
    const input = node('input');
    input.type = 'number'; input.min = '0'; input.max = String(max); input.step = '1';
    input.required = key !== 'maxRetries';
    input.dataset.policyKey = key;
    input.value = policy?.[key] ?? (key === 'maxRetries' ? '' : '0');
    input.disabled = !editable;
    label.append(input); wrap.append(label); inputs[key] = input;
  }
  return {
    element: wrap, inputs,
    set(value) {
      for (const key of Object.keys(inputs)) inputs[key].value = value[key] ?? (key === 'maxRetries' ? '' : '0');
    },
    disable(value) { for (const input of Object.values(inputs)) input.disabled = value; },
    read() {
      const maxRetries = inputs.maxRetries.value === '' ? null : Number(inputs.maxRetries.value);
      const pointPenalty = Number(inputs.pointPenalty.value);
      const timePenaltySeconds = Number(inputs.timePenaltySeconds.value);
      const values = { maxRetries, pointPenalty, timePenaltySeconds };
      if ((maxRetries !== null && (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 99)) ||
        !Number.isInteger(pointPenalty) || pointPenalty < 0 || pointPenalty > state.examDetail.public.settings.coreMaxPoints ||
        !Number.isInteger(timePenaltySeconds) || timePenaltySeconds < 0 ||
        timePenaltySeconds > Number(state.durationInput.value) * 60)
        throw new Error('Retry rules need valid whole numbers within the activity limits.');
      return values;
    }
  };
}

function renderExamControls() {
  const { public: exam, private: grading } = state.examDetail;
  const editable = state.selectedExam.status === 'draft';
  state.rulesDirty = false;
  clear($('policy-editor'));
  clear($('answer-key'));
  state.policyEditors = [];
  const durationLabel = node('label', '', 'Duration (minutes)');
  const durationInput = node('input');
  durationInput.type = 'number'; durationInput.min = '1'; durationInput.max = '1440';
  durationInput.required = true;
  durationInput.value = String(exam.settings.durationMinutes);
  durationInput.disabled = !editable;
  durationLabel.append(durationInput);
  $('policy-editor').append(durationLabel);
  state.durationInput = durationInput;
  durationInput.addEventListener('input', () => {
    for (const input of $('policy-editor').querySelectorAll('[data-policy-key="timePenaltySeconds"]'))
      input.max = String(Number(durationInput.value) * 60);
  });
  for (const mission of exam.missions) {
    const editor = node('details', 'policy-mission');
    editor.append(node('summary', '', mission.title));
    const missionFields = policyFields(mission.retryPolicy, editable);
    editor.append(node('p', 'small', `${groupWord(state.selectedExam)} default`), missionFields.element);
    const questions = [];
    for (const activity of mission.activities) {
      const question = node('div', 'policy-question');
      question.append(renderPrompt(activity.prompt));
      const inheritLabel = node('label', 'policy-inherit');
      const inherit = node('input');
      inherit.type = 'checkbox'; inherit.checked = !activity.retryPolicy; inherit.disabled = !editable;
      inheritLabel.append(inherit, node('span', '', `Use ${groupWord(state.selectedExam)} rule`));
      const fields = policyFields(activity.retryPolicy ?? mission.retryPolicy, editable && !inherit.checked);
      question.append(inheritLabel, fields.element);
      inherit.addEventListener('change', () => {
        if (inherit.checked) fields.set(missionFields.read());
        fields.disable(!editable || inherit.checked);
      });
      for (const input of Object.values(missionFields.inputs)) input.addEventListener('input', () => {
        if (inherit.checked) fields.set(missionFields.read());
      });
      editor.append(question);
      questions.push({ activityId: activity.id, inherit, fields });
    }
    $('policy-editor').append(editor);
    state.policyEditors.push({ missionId: mission.id, missionFields, questions });

    const answerMission = node('section', 'answer-mission');
    answerMission.append(node('h3', '', mission.title));
    for (const activity of mission.activities) {
      const answer = node('div', 'answer-question');
      answer.append(renderPrompt(activity.prompt));
      const rule = grading.rules?.[activity.gradingRuleId];
      answer.append(node('pre', 'answer-value', rule ? answerText(activity, rule) : 'No grading rule.'));
      answerMission.append(answer);
    }
    $('answer-key').append(answerMission);
  }
}

$('policy-editor').addEventListener('input', () => {
  state.rulesDirty = true;
  renderWorkflowState();
});
$('policy-editor').addEventListener('change', () => {
  state.rulesDirty = true;
  renderWorkflowState();
});

$('clone-package').addEventListener('click', () => perform(async () => {
  const exam = selected();
  const copy = await request(`/api/instructor/assessments/${exam.examId}/${exam.version}/clone`, { method: 'POST', data: {} });
  state.selectedExam = copy;
  state.sources = [];
  invalidateValidation();
  await refreshLibrary();
  await loadSources();
  showStep('exams');
  $('exam-title-input').focus();
  message(`Editable version ${copy.version} created. You can change its name here.`);
}));

$('save-policies').addEventListener('click', () => perform(async () => {
  const selectedVersion = selected();
  if (selectedVersion.status !== 'draft') throw new Error('Create an editable copy first.');
  const pub = structuredClone(state.examDetail.public);
  const duration = Number(state.durationInput.value);
  if (!Number.isInteger(duration) || duration < 1 || duration > 1440) throw new Error('Duration must be 1–1440 minutes.');
  pub.settings.durationMinutes = duration;
  for (const entry of state.policyEditors) {
    const mission = pub.missions.find(item => item.id === entry.missionId);
    mission.retryPolicy = entry.missionFields.read();
    for (const question of entry.questions) {
      const activity = mission.activities.find(item => item.id === question.activityId);
      if (question.inherit.checked) delete activity.retryPolicy;
      else activity.retryPolicy = question.fields.read();
    }
  }
  await request(`/api/instructor/assessments/${selectedVersion.examId}/${selectedVersion.version}`, {
    method: 'PUT', data: { public: pub, private: state.examDetail.private }
  });
  invalidateValidation();
  await refreshLibrary();
  showStep('review');
  message('Rules saved. Checking the draft now.');
}));

for (const id of ['class-name', 'class-section']) $(id).addEventListener('input', renderWorkflowState);
$('class-file').addEventListener('change', async () => {
  const file = $('class-file').files[0];
  state.pendingClassRoster = null;
  $('class-roster-status').textContent = file ? 'Reading roster…' :
    state.editingClassId ? 'Current roster remains.' : 'Choose a roster file.';
  if (!file) { renderWorkflowState(); return; }
  try {
    const roster = parseRoster(await file.text(), file.name, $('class-section').value);
    state.pendingClassRoster = roster;
    $('class-section').value = roster[0].section;
    if (!$('class-name').value.trim()) $('class-name').value = roster[0].section;
    $('class-roster-status').textContent = `${roster.length} students ready from ${file.name}.`;
  } catch (error) { $('class-roster-status').textContent = error.message; }
  renderWorkflowState();
});
$('class-section').addEventListener('change', () => {
  if ($('class-file').files.length) $('class-file').dispatchEvent(new Event('change'));
});
$('class-cancel').addEventListener('click', resetClassForm);
$('class-form').addEventListener('submit', event => {
  event.preventDefault();
  perform(async () => {
    if (state.classBusy || $('class-save').disabled) return;
    state.classBusy = true; renderWorkflowState();
    try {
      const data = { name: $('class-name').value.trim(), section: $('class-section').value.trim(),
        ...(state.pendingClassRoster ? { roster: state.pendingClassRoster } : {}) };
      const editing = state.editingClassId;
      const saved = await request(editing ? `/api/instructor/classes/${editing}` : '/api/instructor/classes',
        { method: editing ? 'PUT' : 'POST', data });
      state.selectedClassId = saved.id;
      resetClassForm();
      await loadClasses();
      message(editing ? 'Class updated.' : 'Class added.');
    } finally { state.classBusy = false; renderWorkflowState(); }
  });
});
$('run-class').addEventListener('change', () => {
  state.selectedClassId = $('run-class').value;
  loadClasses().catch(error => message(error.message));
});

const selected = () => {
  if (!state.selectedExam) throw new Error('Select an activity from the library first.');
  return state.selectedExam;
};

async function loadSources() {
  const e = selected();
  state.sources = await request(`/api/instructor/assessments/${e.examId}/${e.version}/sources`);
  const select = $('source-select');
  clear(select);
  for (const source of state.sources) {
    const opt = node('option', '', `${source.filename} · ${source.reviewStatus.replace('_', ' ')}`);
    opt.value = source.id;
    select.append(opt);
  }
  displaySource();
  renderWorkflowState();
}

function displaySource() {
  const source = state.sources.find(x => x.id === $('source-select').value);
  $('source-preview').textContent = source?.content || 'No source selected.';
  const cov = source?.coverage || { topic: '', learningOutcome: '', proposedActivityType: '', evidence: '' };
  $('coverage-json').value = JSON.stringify(cov, null, 2);
  $('cov-topic').value = cov.topic || '';
  $('cov-outcome').value = cov.learningOutcome || '';
  $('cov-type').value = cov.proposedActivityType || '';
  $('cov-evidence').value = cov.evidence || '';
  renderWorkflowState();
}

$('source-select').addEventListener('change', displaySource);
$('load-sources').addEventListener('click', () => perform(loadSources));

// Sync Coverage Form UI to Coverage JSON
['cov-topic', 'cov-outcome', 'cov-type', 'cov-evidence'].forEach(id => {
  $(id).addEventListener('input', () => {
    const cov = {
      topic: $('cov-topic').value,
      learningOutcome: $('cov-outcome').value,
      proposedActivityType: $('cov-type').value,
      evidence: $('cov-evidence').value
    };
    $('coverage-json').value = JSON.stringify(cov, null, 2);
    renderWorkflowState();
  });
});

$('upload-source').addEventListener('click', () => perform(async () => {
  const e = selected(), file = $('source-file').files[0];
  if (!file) throw new Error('Choose a source file.');
  const source = await extractFile(file);
  await request(`/api/instructor/assessments/${e.examId}/${e.version}/sources`, {
    method: 'POST',
    data: { filename: source.filename, content: source.content }
  });
  $('source-file').value = '';
  invalidateValidation();
  message(`Source added: ${source.sections} ${source.sectionLabel}. Coverage notes are optional.`);
  await loadSources();
}));

$('save-coverage').addEventListener('click', () => perform(async () => {
  const e = selected(), sourceId = $('source-select').value;
  if (!sourceId) throw new Error('Select a source first.');
  const cov = {
    topic: $('cov-topic').value.trim(),
    learningOutcome: $('cov-outcome').value.trim(),
    proposedActivityType: $('cov-type').value.trim(),
    evidence: $('cov-evidence').value.trim()
  };
  if (Object.values(cov).some(value => !value)) throw new Error('Complete all four coverage fields.');
  $('coverage-json').value = JSON.stringify(cov, null, 2);
  await request(`/api/instructor/assessments/${e.examId}/${e.version}/sources/${sourceId}`, {
    method: 'PUT',
    data: cov
  });
  invalidateValidation();
  await loadSources();
  $('source-select').value = sourceId;
  displaySource();
  showStep('review');
  message('Coverage note saved. Checking the draft now.');
}));

const packageInput = id => {
  const value = JSON.parse($(id).value);
  if (!value.public || !value.private) throw new Error('Package requires public and private root objects.');
  return value;
};

$('import-package').addEventListener('click', () => perform(async () => {
  const value = packageInput('new-package-json');
  const result = await request('/api/instructor/assessments', { method: 'POST', data: value });
  state.selectedExam = result;
  state.sources = [];
  invalidateValidation();
  message('New draft imported.');
  await refreshLibrary();
  setActivityMode('library');
  await loadSources();
  showStep('review');
}));

$('update-package').addEventListener('click', () => perform(async () => {
  const e = selected(), value = packageInput('package-json');
  await request(`/api/instructor/assessments/${e.examId}/${e.version}`, { method: 'PUT', data: value });
  invalidateValidation();
  message('Draft saved.');
  await refreshLibrary();
  showStep('review');
}));

async function validateCurrentDraft() {
  const exam = state.selectedExam;
  if (!exam || exam.status !== 'draft' || !state.examDetail || state.validationBusy) return;
  const epoch = state.validationEpoch, key = examKey(exam);
  state.validationBusy = true;
  $('validation-output').textContent = 'Checking questions and scoring…';
  renderWorkflowState();
  try {
    const result = await request(`/api/instructor/assessments/${exam.examId}/${exam.version}/validate`,
      { method: 'POST', data: {} });
    if (epoch !== state.validationEpoch || key !== examKey(state.selectedExam)) return;
    state.validationErrors = result.errors;
    state.validatedKey = result.errors.length ? null : key;
    $('validation-output').textContent = result.errors.length
      ? result.errors.map(item => `• ${item}`).join('\n')
      : 'Ready to publish. Questions and scoring passed validation.';
    renderReview();
  } catch (error) {
    if (epoch === state.validationEpoch) {
      state.validationErrors = [error.message];
      $('validation-output').textContent = `Validation could not finish: ${error.message}`;
    }
  } finally {
    state.validationBusy = false;
    renderWorkflowState();
  }
}

$('validate-package').addEventListener('click', () => perform(validateCurrentDraft));
$('review-edit-rules').addEventListener('click', () => showStep('rules'));

$('ai-check').addEventListener('click', () => perform(async () => {
  const e = selected();
  const target = $('ai-check-results');
  target.textContent = 'Checking source support…';
  let checks;
  try { checks = await request(`/api/instructor/ai/check/${e.examId}/${e.version}`, { method: 'POST', data: {} }); }
  catch (error) { target.textContent = 'Source check could not be completed.'; throw error; }
  clear(target);
  const scores = checks.map(check => check.matchPercent).filter(score => score !== null);
  const average = scores.length === checks.length && scores.length
    ? `${Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)}%` : 'unavailable';
  target.append(node('p', 'ai-score', `Test source match: ${average} · AI estimate. You decide whether to publish.`));
  for (const check of checks) {
    const item = node('details', 'ai-question');
    item.append(node('summary', '', `${check.matchPercent === null ? 'Unscored' : `${check.matchPercent}%`} · ${check.prompt.split('```')[0].trim().slice(0, 100) || 'Code question'}`));
    item.append(renderPrompt(check.prompt));
    if (check.reason) item.append(node('p', '', check.reason));
    if (check.quote) item.append(node('blockquote', '', check.quote));
    target.append(item);
  }
}));

function renderReview() {
  if (!state.examDetail) return;
  const exam = state.examDetail.public, grading = state.examDetail.private;
  const paperActivities = (exam.missions || []).flatMap(mission => mission.activities || []);
  const pointsInput = $('paper-total-points');
  const versionKey = examKey(state.selectedExam);
  if (pointsInput.dataset.versionKey !== versionKey) {
    pointsInput.dataset.versionKey = versionKey;
    pointsInput.min = String(Math.max(1, paperActivities.length));
    pointsInput.value = String(paperActivities.reduce((sum, activity) => sum + (Number(activity.maxPoints) || 0), 0));
  }
  const target = $('draft-preview');
  clear(target);
  const rules = $('review-rules-summary');
  clear(rules);
  const policies = (exam.missions || []).map(mission => mission.retryPolicy || {});
  const uniform = policies.every(policy => JSON.stringify(policy) === JSON.stringify(policies[0]));
  const first = policies[0] || {};
  rules.append(node('strong', '', `${exam.settings.durationMinutes} minutes`),
    node('span', '', uniform && first.maxRetries !== undefined
      ? ` · ${first.maxRetries === null ? 'Unlimited' : first.maxRetries} retries · ${first.pointPenalty || 0} ${first.pointPenalty === 1 ? 'point' : 'points'} and ${first.timePenaltySeconds || 0} seconds off per retry`
      : ' · Custom retry rules'));
  const evidence = grading.evidence || [];
  for (const [missionIndex, mission] of (exam.missions || []).entries()) {
    const section = node('section', 'review-mission');
    section.append(node('h2', '', mission.title || mission.id));
    if (mission.story) section.append(node('p', 'small', mission.story));
    for (const activity of mission.activities ?? []) {
      const card = node('article', 'review-question');
      card.append(renderPrompt(activity.prompt, 'ai-prompt'));
      if (activity.type === 'code_writing') appendCodeExamples(card, activity.publicConfig);
      const choices = activity.publicConfig?.options || activity.publicConfig?.items;
      if (Array.isArray(choices) && choices.length) {
        const list = node('ol', 'ai-options');
        for (const choice of choices) list.append(node('li', '', choice.label || String(choice)));
        card.append(list);
      }
      const rule = grading.rules?.[activity.gradingRuleId];
      card.append(node('p', 'ai-answer', 'Correct answer'),
        node('pre', 'answer-value', rule ? answerText(activity, rule) : 'No grading rule.'));
      const proof = evidence.find(item => item.activityId === activity.id);
      const refs = activity.sourceRefs || [];
      if (proof?.quote || refs.length || activity.manualRationale) {
        const source = node('details', 'ai-evidence');
        source.append(node('summary', '', 'Source evidence'));
        for (const ref of refs) source.append(node('p', 'small', `${ref.file} · ${ref.pageOrSlide}`));
        if (proof?.quote) source.append(node('blockquote', '', proof.quote));
        if (activity.manualRationale) source.append(node('p', 'small', activity.manualRationale));
        card.append(source);
      }
      const issues = state.validationErrors.filter(issue => issue.includes(activity.id) || issue.includes(mission.id)
        || issue.includes(`Mission ${missionIndex + 1}`));
      for (const issue of issues) card.append(node('p', 'ai-issue', issue));
      section.append(card);
    }
    target.append(section);
  }
}

function openPrintCopy(includeAnswers) {
  const detail = state.examDetail;
  if (!detail?.public) { message('Select an activity first.'); return; }
  const paperActivities = (detail.public.missions || []).flatMap(mission => mission.activities || []);
  const totalPoints = Number($('paper-total-points').value);
  if (!Number.isInteger(totalPoints) || totalPoints < Math.max(1, paperActivities.length) || totalPoints > 10000) {
    message(`Enter a whole number from ${Math.max(1, paperActivities.length)} to 10,000 points.`);
    $('paper-total-points').focus();
    return;
  }
  const questionPoints = distributePaperPoints(paperActivities, totalPoints);
  const pointsByActivity = new Map(paperActivities.map((activity, index) => [activity.id, questionPoints[index]]));
  const printWindow = window.open('', '_blank');
  if (!printWindow) { message('Allow the print window, then try again.'); return; }
  printWindow.opener = null;
  const doc = printWindow.document;
  doc.documentElement.lang = 'en';
  const title = `${detail.public.title || detail.public.examId} · ${includeAnswers ? 'Faculty answer key' : 'Paper backup'}`;
  doc.title = title;
  doc.head.replaceChildren();
  const charset = doc.createElement('meta'); charset.setAttribute('charset', 'utf-8');
  const viewport = doc.createElement('meta'); viewport.name = 'viewport'; viewport.content = 'width=device-width, initial-scale=1';
  const stylesheet = doc.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('/print.css', window.location.href).href;
  doc.head.append(charset, viewport, stylesheet);
  const root = doc.createElement('main');
  const preparing = doc.createElement('p'); preparing.className = 'print-preparing';
  preparing.textContent = 'Preparing print layout…'; root.append(preparing);
  const heading = doc.createElement('h1'); heading.textContent = title; root.append(heading);
  const meta = doc.createElement('p');
  meta.textContent = `${detail.public.subject || ''}${detail.public.settings?.durationMinutes ? ` · ${detail.public.settings.durationMinutes} minutes` : ''} · ${totalPoints} points`;
  root.append(meta);
  if (includeAnswers) {
    const notice = doc.createElement('p'); notice.className = 'faculty-only'; notice.textContent = 'FACULTY COPY · Contains correct answers. Keep separate from student copies.'; root.append(notice);
  } else {
    const identity = doc.createElement('div'); identity.className = 'paper-meta';
    for (const labelText of ['Student name', 'School ID', 'Section']) {
      const field = doc.createElement('div'); field.className = 'paper-meta-field';
      const caption = doc.createElement('span'); caption.className = 'paper-meta-label';
      caption.textContent = labelText;
      const line = doc.createElement('span'); line.className = 'paper-line';
      field.append(caption, line); identity.append(field);
    }
    root.append(identity);
  }
  let questionNumber = 0;
  for (const mission of detail.public.missions || []) {
    const group = doc.createElement('section');
    const groupTitle = doc.createElement('h2'); groupTitle.textContent = mission.title || mission.id; group.append(groupTitle);
    if (mission.story) { const story = doc.createElement('p'); story.textContent = mission.story; group.append(story); }
    for (const activity of mission.activities || []) {
      questionNumber++;
      const card = doc.createElement('article'); card.className = 'paper-question';
      const questionHeading = doc.createElement('div'); questionHeading.className = 'question-title';
      const number = doc.createElement('span'); number.textContent = `Question ${questionNumber}`;
      const points = doc.createElement('span'); points.textContent = `${pointsByActivity.get(activity.id) ?? 0} pts`;
      questionHeading.append(number, points); card.append(questionHeading);
      card.append(renderPrompt(activity.prompt));
      const config = activity.publicConfig || {};
      if (!includeAnswers) appendPaperInput(doc, card, activity, config);
      if (includeAnswers) {
        const rule = detail.private?.rules?.[activity.gradingRuleId];
        const answerLabel = doc.createElement('h3'); answerLabel.textContent = 'Correct answer'; card.append(answerLabel);
        const answer = doc.createElement('pre'); answer.className = 'answer';
        answer.textContent = rule ? answerText(activity, rule) : 'No grading rule found.'; card.append(answer);
      }
      group.append(card);
    }
    root.append(group);
  }
  doc.body.replaceChildren(root);
  printWindow.focus();
  const cssReady = new Promise(resolve => {
    if (stylesheet.sheet) resolve();
    else {
      stylesheet.addEventListener('load', resolve, { once: true });
      stylesheet.addEventListener('error', resolve, { once: true });
    }
  });
  (async () => {
    await cssReady;
    if (doc.fonts?.ready) await doc.fonts.ready;
    preparing.remove();
    window.setTimeout(() => { try { printWindow.print(); } catch { /* print can be opened from this tab */ } }, 150);
  })();
}

$('print-student-copy').addEventListener('click', () => openPrintCopy(false));
$('print-answer-key').addEventListener('click', () => openPrintCopy(true));

$('publish-package').addEventListener('click', () => perform(async () => {
  const e = selected();
  if (state.publishBusy || state.rulesDirty || titleChanged() || state.validatedKey !== examKey(e)) return;
  if (!window.confirm(`Publish ${e.examId} v${e.version}? Published versions are immutable.`)) return;
  state.publishBusy = true;
  renderWorkflowState();
  try {
    await request(`/api/instructor/assessments/${e.examId}/${e.version}/publish`, {
      method: 'POST', data: { approved: true }
    });
    invalidateValidation();
    message('Activity version published and locked.');
    await refreshLibrary();
    showStep(state.classes.length ? 'run' : 'classes');
  } finally { state.publishBusy = false; renderWorkflowState(); }
}));

$('create-run').addEventListener('click', () => perform(async () => {
  const exam = selected();
  if (state.runBusy) return;
  const classId = $('run-class').value;
  if (!state.classes.some(item => item.id === classId)) throw new Error('Choose a saved class first.');
  const days = Number($('run-duration-days').value);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Enter a joining window from 1 to 365 days.');
  const payload = {
    examId: exam.examId, version: exam.version, name: $('run-name-field').value.trim(), pin: $('run-pin-field').value,
    feedbackMode: $('run-feedback-mode').value,
    shuffleQuestions: $('run-shuffle-questions').checked,
    opensAt: new Date(Date.now() - 60_000).toISOString(),
    closesAt: new Date(Date.now() + days * 86400_000).toISOString(),
    classId
  };
  state.runBusy = true;
  renderWorkflowState();
  try {
    const result = await request('/api/instructor/runs', { method: 'POST', data: payload });
    $('created-run').textContent = `${result.name} created for ${result.className} · ${result.rosterCount} students · ${result.feedbackMode === 'graded' ? 'Graded' : 'Practice'} feedback${result.shuffleQuestions ? ' · Questions shuffled' : ''}.`;
    const studentUrl = new URL('/app/student', window.location.href);
    studentUrl.searchParams.set('run', result.id);
    const linkLabel = ['localhost', '127.0.0.1'].includes(studentUrl.hostname)
      ? 'Student activity (this computer only)' : 'Student activity';
    $('run-access-text').value = `${linkLabel}: ${studentUrl.href}\nRun ID: ${result.id}\nRun PIN: ${payload.pin}\nSign in with your School ID from the class roster.`;
    const accessSaved = saveRunAccess(result.id, { url: studentUrl.href, pin: payload.pin });
    $('run-access').classList.remove('hidden');
    message(accessSaved ? 'Run created.' : 'Run created, but browser storage is unavailable. Copy the access details now.');
    await refreshLibrary();
    $('results-run').value = result.id;
    saveSelectedRun(result.id);
    syncRunName();
  } finally { state.runBusy = false; renderWorkflowState(); }
}));

$('load-results').addEventListener('click', () => perform(loadResults));
$('publish-all-scores').addEventListener('click', () => perform(async () => {
  const runId = $('results-run').value;
  if (!runId) throw new Error('Select a run.');
  if (!window.confirm('Publish scores for every student who has completed this run? Students still in progress will keep their scores hidden.')) return;
  const button = $('publish-all-scores');
  button.disabled = true;
  try {
    const result = await request(`/api/instructor/runs/${runId}/publish-scores`, { method: 'POST' });
    const latest = await loadResults();
    const stillHidden = latest.rows.filter(row => row.sessionId && !row.resultsReleased &&
      ['submitted', 'expired'].includes(row.status)).length;
    if (stillHidden) throw new Error('The server did not confirm the score release. Restart the app server and retry.');
    publicationMessage(`Published ${result.publishedCount} completed ${result.publishedCount === 1 ? 'score' : 'scores'}. These students can now view their results.`, runId);
  } catch (error) {
    button.disabled = false;
    throw error;
  }
}));

async function loadProctorAccess() {
  const runId = $('results-run').value;
  $('proctor-access').classList.toggle('hidden', !runId);
  if (!runId) return;
  const access = await request(`/api/instructor/runs/${runId}/proctor-access`);
  if ($('results-run').value !== runId) return;
  const ended = Date.now() >= Date.parse(access.closesAt);
  $('proctor-access-status').textContent = ended ? 'This run has ended.'
    : access.enabled ? 'Monitoring is enabled. Replace the code if it was lost.'
      : 'Create a separate code for a run proctor.';
  $('issue-proctor').textContent = access.enabled ? 'Replace access code' : 'Create access code';
  $('issue-proctor').disabled = ended || state.proctorBusy;
  $('revoke-proctor').classList.toggle('hidden', !access.issuedAt);
  $('revoke-proctor').disabled = state.proctorBusy;
}

$('issue-proctor').addEventListener('click', () => perform(async () => {
  const runId = $('results-run').value;
  if (!runId || state.proctorBusy) return;
  const code = $('proctor-code-field').value.trim();
  if (code.length < 8 || code.length > 100) throw new Error('Choose a proctor code from 8 to 100 characters.');
  if ($('issue-proctor').textContent === 'Replace access code' &&
    !window.confirm('Replace this code? Signed-in proctors will lose access.')) return;
  state.proctorBusy = true;
  $('issue-proctor').disabled = true;
  $('revoke-proctor').disabled = true;
  try {
    const access = await request(`/api/instructor/runs/${runId}/proctor-access`, { method: 'POST', data: { code } });
    $('proctor-code-field').value = '';
    await loadProctorAccess();
    if ($('results-run').value !== runId) return;
    const url = new URL('/app/proctor', window.location.href);
    url.searchParams.set('run', runId);
    $('proctor-share-text').value = `Proctor view: ${url.href}\nRun ID: ${runId}\nProctor code: ${access.code}`;
    $('proctor-share').classList.remove('hidden');
    message('Proctor access code created. Copy it now; it will not be shown again.');
  } finally { state.proctorBusy = false; await loadProctorAccess(); }
}));

$('revoke-proctor').addEventListener('click', () => perform(async () => {
  const runId = $('results-run').value;
  if (!runId || state.proctorBusy || !window.confirm('Revoke proctor access for this run?')) return;
  state.proctorBusy = true;
  $('issue-proctor').disabled = true;
  $('revoke-proctor').disabled = true;
  try {
    await request(`/api/instructor/runs/${runId}/proctor-access`, { method: 'DELETE' });
    $('proctor-share-text').value = '';
    $('proctor-share').classList.add('hidden');
    message('Proctor access revoked.');
  } finally { state.proctorBusy = false; await loadProctorAccess(); }
}));

$('copy-proctor').addEventListener('click', async () => {
  const field = $('proctor-share-text');
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(field.value);
    message('Proctor access details copied.');
  } catch {
    field.focus(); field.select();
    message('Copy the selected details.');
  }
});

function responseText(question, submission) {
  if (!submission) return 'No answer submitted';
  const value = submission.value, config = question.publicConfig || {};
  const option = id => config.options?.find(item => item.id === id)?.label ?? String(id);
  if (question.type === 'single_choice') return option(value);
  if (question.type === 'multiple_choice') return Array.isArray(value) ? value.map(option).join(', ') : String(value);
  if (question.type === 'true_false') return value ? 'True' : 'False';
  if (question.type === 'numeric_entry') return `${value}${submission.unit ? ` ${submission.unit}` : ''}`;
  if (question.type === 'matching') return Object.entries(value || {}).map(([left, right]) => {
    const leftLabel = config.left?.find(item => item.id === left)?.label ?? left;
    const rightLabel = config.right?.find(item => item.id === right)?.label ?? right;
    return `${leftLabel}: ${rightLabel}`;
  }).join('\n');
  if (question.type === 'sequencing') return Array.isArray(value)
    ? value.map(id => config.items?.find(item => item.id === id)?.label ?? id).join(' → ') : String(value);
  if (question.type === 'data_inspection' && value && typeof value === 'object') return [
    `Rows per page: ${value.pageLength}`, `Page: ${(value.pageIndex ?? 0) + 1}`,
    `Search: ${value.globalSearch || '(none)'}`,
    `Column filters: ${Object.entries(value.columnSearch || {}).map(([key, term]) => `${key} = ${term}`).join(', ') || '(none)'}`,
    `Order: ${(value.order || []).map(item => `${item.column} ${item.direction}`).join(', ') || '(none)'}`
  ].join('\n');
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function renderStudentReview(review) {
  if ($('results-run').value !== review.runId) return;
  $('student-review').classList.remove('hidden');
  $('student-review-title').textContent = `Student answers · ${review.displayName}`;
  $('student-review-summary').textContent = `${review.candidateId} · ${review.status} · ${review.score} / ${review.maxPoints} pts${review.canOverride ? '' : ' · Scores can be adjusted after the attempt ends.'}`;
  const target = $('student-review-questions');
  clear(target);
  if (!review.questions.length) { target.append(node('p', 'small', 'No attempt or answers yet.')); return; }
  let previousMission = null;
  review.questions.forEach((question, index) => {
    if (question.missionId !== previousMission) {
      target.append(node('h3', 'review-group-title', question.missionTitle));
      previousMission = question.missionId;
    }
    const card = node('article', 'student-answer-card');
    const heading = node('div', 'review-header');
    heading.append(node('h4', '', `Question ${index + 1}`),
      node('strong', '', `${question.effectivePoints} / ${question.maxPoints} pts`));
    card.append(heading, renderPrompt(question.prompt));
    const latest = question.attempts.at(-1);
    card.append(node('p', 'small', `Student answer · ${question.attempts.length} attempt${question.attempts.length === 1 ? '' : 's'}`),
      node('pre', 'answer-value', responseText(question, latest?.response)),
      node('p', 'small', 'Correct answer'), node('pre', 'answer-value', question.expectedAnswer));
    if (latest) card.append(node('p', 'small', `Last automatic check: ${latest.result.replaceAll('_', ' ')} · Automatic score: ${question.automaticPoints} pts`));
    if (question.override) card.append(node('p', 'small', `Faculty override: ${question.override.points} pts · ${question.override.reason}`));
    if (question.attempts.length > 1) {
      const history = node('details', 'answer-history');
      history.append(node('summary', '', `Previous submissions (${question.attempts.length - 1})`));
      for (const attempt of question.attempts.slice(0, -1)) {
        history.append(node('p', 'small', `${new Date(attempt.at).toLocaleString()} · ${attempt.result.replaceAll('_', ' ')}`),
          node('pre', 'answer-value', responseText(question, attempt.response)));
      }
      card.append(history);
    }
    if (review.canOverride) {
      const adjust = node('details', 'score-adjust');
      adjust.append(node('summary', '', question.override ? 'Edit score override' : 'Adjust score'));
      const form = node('form', 'score-adjust-form');
      const pointsLabel = node('label', '', 'Points');
      const points = node('input');
      points.type = 'number'; points.min = '0'; points.max = String(question.maxPoints); points.step = '1'; points.required = true;
      points.value = String(question.override?.points ?? Math.max(0, question.automaticPoints));
      pointsLabel.append(points);
      const reasonLabel = node('label', '', 'Reason');
      const reason = node('textarea'); reason.rows = 2; reason.minLength = 3; reason.maxLength = 300; reason.required = true;
      reason.value = question.override?.reason ?? '';
      reasonLabel.append(reason);
      const actions = node('div', 'button-row');
      const save = node('button', 'primary', 'Save score'); save.type = 'submit'; actions.append(save);
      if (question.override) {
        const reset = node('button', '', 'Use automatic score'); reset.type = 'button';
        reset.addEventListener('click', () => perform(async () => {
          reset.disabled = true;
          try {
            const updated = await request(`/api/instructor/runs/${review.runId}/students/${encodeURIComponent(review.candidateId)}/scores/${encodeURIComponent(question.id)}`, { method: 'DELETE' });
            renderStudentReview(updated); await loadResults(); message('Automatic score restored.');
          } finally { reset.disabled = false; }
        }));
        actions.append(reset);
      }
      form.append(pointsLabel, reasonLabel, actions);
      form.addEventListener('submit', event => {
        event.preventDefault();
        perform(async () => {
          save.disabled = true;
          try {
            const updated = await request(`/api/instructor/runs/${review.runId}/students/${encodeURIComponent(review.candidateId)}/scores/${encodeURIComponent(question.id)}`, {
              method: 'PUT', data: { points: Number(points.value), reason: reason.value.trim() }
            });
            renderStudentReview(updated); await loadResults(); message('Score saved.');
          } finally { save.disabled = false; }
        });
      });
      adjust.append(form);
      card.append(adjust);
    }
    target.append(card);
  });
}

$('close-student-review').addEventListener('click', () => {
  $('student-review').classList.add('hidden');
  clear($('student-review-questions'));
});

async function loadResults() {
  const runId = $('results-run').value;
  const epoch = ++state.resultsEpoch;
  if (!runId) {
    state.results = null;
    clear($('results-summary')); clear($('results-table'));
    $('results-filters').classList.add('hidden');
    $('publish-all-scores').classList.add('hidden');
    $('results-publication-message').textContent = '';
    return null;
  }
  $('results-table').setAttribute('aria-busy', 'true');
  $('load-results').disabled = true;
  $('publish-all-scores').disabled = true;
  try {
    const result = await request(`/api/instructor/runs/${runId}/results`);
    if (epoch === state.resultsEpoch && $('results-run').value === runId) {
      state.results = result;
      renderResults();
    }
    return result;
  } catch (error) {
    if (epoch === state.resultsEpoch) {
      state.results = null;
      clear($('results-table')); clear($('results-summary'));
      $('results-table').append(node('p', 'inline-error', 'Results could not be loaded. Select Refresh results to try again.'));
      $('results-filters').classList.add('hidden');
    }
    throw error;
  } finally {
    if (epoch === state.resultsEpoch) {
      $('results-table').setAttribute('aria-busy', 'false');
      $('load-results').disabled = false;
    }
  }
}

function publicationMessage(text, runId = $('results-run').value) {
  state.publicationNotice = { runId, text };
  if ($('results-run').value === runId) $('results-publication-message').textContent = text;
}

function renderResults() {
  const result = state.results;
  if (!result || result.runId !== $('results-run').value) return;
  const runId = result.runId;
  const counts = participationCounts(result.rows);
  const summary = $('results-summary'); clear(summary);
  for (const [key, label] of [...Object.entries(attemptLabels), ['hidden', 'Scores hidden']]) {
    const card = node('button', 'summary-stat'); card.type = 'button';
    card.dataset.status = key;
    card.append(node('strong', '', counts[key]), node('span', '', label));
    card.setAttribute('aria-pressed', String(key === 'hidden'
      ? $('results-visibility').value === 'hidden'
      : $('results-status').value === key && $('results-visibility').value === 'all'));
    card.addEventListener('click', () => {
      const active = card.getAttribute('aria-pressed') === 'true';
      $('results-status').value = !active && key !== 'hidden' ? key : 'all';
      $('results-visibility').value = !active && key === 'hidden' ? 'hidden' : 'all';
      renderResults();
      $('results-summary').querySelector(`[data-status="${key}"]`)?.focus();
    }); summary.append(card);
  }
  $('results-filters').classList.remove('hidden');
  const publishAll = $('publish-all-scores');
  publishAll.classList.toggle('hidden', result.feedbackMode !== 'graded');
  publishAll.textContent = `Publish ${counts.readyToPublish} completed ${counts.readyToPublish === 1 ? 'score' : 'scores'}`;
  publishAll.disabled = !counts.readyToPublish;
  $('results-publication-message').textContent = state.publicationNotice?.runId === runId ? state.publicationNotice.text
    : result.feedbackMode === 'practice' ? 'Practice run · Students see scores immediately.'
    : counts.readyToPublish ? `${counts.readyToPublish} completed ${counts.readyToPublish === 1 ? 'score is' : 'scores are'} ready to publish.`
    : counts.hidden ? 'Scores for students still in progress stay hidden until they finish and you publish, or the run closes.'
    : 'No completed scores are waiting to be published.';
  const target = $('results-table'); clear(target);
  const rows = filterResultRows(result.rows, {
    search: $('results-search').value, status: $('results-status').value, visibility: $('results-visibility').value
  });
  target.append(node('p', 'small', `${rows.length} of ${result.rows.length} students${result.className ? ` · ${result.className}` : ''} · Maximum ${result.maxPoints} points`));
  const wrap = node('div', 'table-wrap results-table-wrap');
  wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Student results. Scroll horizontally for more columns.');
  const table = node('table', 'results-data-table');
  const caption = node('caption', 'sr-only', `${result.name} · ${result.title} v${result.version}`); table.append(caption);
  const head = node('thead'), tr = node('tr');
  for (const label of ['Student', 'Section', 'Attempt', 'Score', 'Score visibility', 'Actions']) {
    const th = node('th', '', label); th.scope = 'col'; tr.append(th);
  }
  head.append(tr); table.append(head);
  const tbody = node('tbody');
  for (const row of rows) {
    const line = node('tr');
    const identity = node('th', 'student-identity'); identity.scope = 'row';
    identity.append(node('strong', '', row.displayName), node('small', '', row.candidateId));
    const attempt = node('td'); attempt.append(node('span', `status-badge status-${row.status}`, attemptLabels[row.status] || row.status));
    line.append(identity, node('td', '', row.section), attempt, node('td', 'score-cell', row.sessionId ? `${row.score} / ${result.maxPoints}` : '—'));
    const releaseCell = node('td');
    const visible = !!row.sessionId && row.resultsReleased;
    releaseCell.append(node('span', `status-badge ${visible ? 'status-published' : ''}`, !row.sessionId ? 'No attempt' : visible ? 'Visible to student' : 'Hidden'));
    if (row.sessionId && !row.resultsReleased && ['submitted', 'expired'].includes(row.status)) {
      const publish = node('button', 'text-button', 'Publish score'); publish.type = 'button';
      publish.setAttribute('aria-label', `Publish score for ${row.displayName}`);
      publish.addEventListener('click', () => perform(async () => {
        publish.disabled = true; publish.textContent = 'Publishing score…';
        try {
          await request(`/api/instructor/runs/${runId}/students/${encodeURIComponent(row.candidateId)}/publish-scores`, { method: 'POST' });
          const latest = await loadResults();
          if (!latest.rows.find(item => item.candidateId === row.candidateId)?.resultsReleased)
            throw new Error('The server did not confirm the score release. Refresh results and retry.');
          publicationMessage(`Score published for ${row.displayName}. It is now visible to this student.`, runId);
        } catch (error) {
          publish.disabled = false; publish.textContent = 'Publish score'; throw error;
        }
      })); releaseCell.append(publish);
    }
    line.append(releaseCell);
    const actionCell = node('td', 'result-row-actions');
    const reviewButton = node('button', '', 'Review answers'); reviewButton.type = 'button'; reviewButton.disabled = !row.sessionId;
    reviewButton.setAttribute('aria-label', `Review answers for ${row.displayName}`);
    reviewButton.addEventListener('click', () => perform(async () => {
      const review = await request(`/api/instructor/runs/${runId}/students/${encodeURIComponent(row.candidateId)}`);
      if ($('results-run').value !== runId) return;
      renderStudentReview(review); $('student-review').scrollIntoView({ block: 'start' });
    })); actionCell.append(reviewButton);
    const runOpen = Date.now() < Date.parse(result.closesAt);
    const canExtend = row.sessionId && runOpen && ['in_progress', 'expired'].includes(row.status);
    const canReopen = row.sessionId && runOpen && ['submitted', 'expired'].includes(row.status);
    if (canExtend || canReopen) {
      const details = node('details', 'student-recovery row-more');
      const more = node('summary', '', 'More'); more.setAttribute('aria-label', `More actions for ${row.displayName}`); details.append(more);
      const addForm = (action, label) => {
        const form = node('form', 'recovery-form');
        const minutesLabel = node('label', '', 'Minutes');
        const minutes = node('input'); minutes.type = 'number'; minutes.min = '1'; minutes.max = '120';
        minutes.value = '5'; minutes.required = true; minutesLabel.append(minutes);
        const reasonLabel = node('label', '', 'Reason');
        const reason = node('input'); reason.type = 'text'; reason.minLength = 3; reason.maxLength = 300;
        reason.placeholder = 'Brief incident note'; reason.required = true; reasonLabel.append(reason);
        const button = node('button', '', label); button.type = 'submit';
        form.append(minutesLabel, reasonLabel, button);
        form.addEventListener('submit', event => {
          event.preventDefault();
          perform(async () => {
            button.disabled = true;
            try {
              const updated = await request(`/api/instructor/runs/${runId}/students/${encodeURIComponent(row.candidateId)}/${action}`, {
                method: 'POST', data: { minutes: Number(minutes.value), reason: reason.value.trim() }
              });
              details.open = false;
              renderStudentReview(updated);
              $('student-review').scrollIntoView({ block: 'start' });
              await loadResults(); message(`${label} complete.`);
            } finally { button.disabled = false; }
          });
        });
        details.append(form);
      };
      if (canExtend) addForm('extend', 'Add time');
      if (canReopen) addForm('reopen', 'Reopen attempt');

      actionCell.append(details);
    }
    line.append(actionCell); tbody.append(line);
  }
  if (!rows.length) {
    const row = node('tr'), cell = node('td', 'empty-state', result.rows.length ? 'No students match these filters.' : 'No students in this run.');
    cell.colSpan = 6; row.append(cell); tbody.append(row);
  }
  table.append(tbody); wrap.append(table); target.append(wrap);
}

for (const id of ['results-search', 'results-status', 'results-visibility'])
  $(id).addEventListener(id === 'results-search' ? 'input' : 'change', renderResults);

$('export-results').addEventListener('click', () => perform(async () => {
  const runId = $('results-run').value;
  if (!runId) throw new Error('Select a run.');
  const blob = await request(`/api/instructor/runs/${runId}/export.csv`, { raw: true });
  const url = URL.createObjectURL(blob);
  const link = node('a');
  link.href = url;
  link.download = `gradebook-${runId.slice(0, 8)}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}));

await perform(loadConfig);
try {
  await request('/api/instructor/session', { silent: true });
  state.instructorAuthenticated = true;
} catch { /* Sign in to start a new faculty session. */ }
showInstructor();
