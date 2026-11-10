import { apiError, userErrorMessage, questionIssueText, codeServiceMessage, tableTargetSummary } from './user-messages.js';
import { referenceTopics } from './reference-topics.js';
import { renderReferenceResults } from './reference-dictionary.js';
import { editableQuestion } from './draft-question.js';
import { appendExpectedOutput, createWebQuestionEditor } from './web-project.js';
import { outputMatches } from './code-task.js';
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
import { retryPolicyText, attemptLabels, participationCounts, filterResultRows, localDateTime } from './ui-model.js';
import { browserSessionHeaders, createRunAccessStore, clearLegacyCredentials } from './browser-session.js';
import { assessmentLimits } from './assessment-limits.js';

installPasswordToggles();

const $ = (id) => document.getElementById(id);
$('ai-questions').max = String(assessmentLimits.questions);
$('ai-missions').max = String(assessmentLimits.groups);
// Keep library browsing separate from editing the selected assessment.
const reviewSection = document.querySelector('[data-step="review"]');
reviewSection.querySelector('.step-actions').after($('exam-title-editor'));
reviewSection.querySelector('.step-actions').append($('clone-package'));
const createGrid = document.querySelector('#ai-create > .ai-form-grid');
for (const [title, ids] of [
  ['Question generator', ['ai-provider', 'ai-model']],
  ['Activity details', ['ai-title', 'ai-subject', 'ai-kind']],
  [
    'Questions',
    ['ai-question-mode', 'ai-difficulty', 'ai-questions', 'ai-missions', 'ai-programming-language'],
  ],
  ['Timing', ['ai-duration']],
  ['Teaching material', ['ai-source']],
]) {
  const group = document.createElement('fieldset');
  group.className = 'creation-group';
  const legend = document.createElement('legend');
  legend.textContent = title;
  group.append(legend);
  for (const id of ids) group.append($(id).closest('label'));
  createGrid.append(group);
}
const activityHeading = $('step-exams-title');
const activityHeader = document.createElement('div');
activityHeader.className = 'faculty-page-heading';
activityHeading.before(activityHeader);
activityHeader.append(activityHeading, $('new-activity'));
const workflowIcons = {
  exams: 'activity',
  rules: 'rules',
  sources: 'source',
  review: 'review',
  classes: 'people',
  run: 'run',
  results: 'results',
};
for (const button of document.querySelectorAll('[data-step-link]'))
  button.prepend(icon(workflowIcons[button.dataset.stepLink]));
const state = {
  instructorAuthenticated: false,
  step:
    new URL(location.href).searchParams.get('workspace') || sessionStorage.getItem('facultyStep') || 'exams',
  activityMode: 'library',
  validatedKey: null,
  validationErrors: [],
  validationBusy: false,
  validationEpoch: 0,
  publishBusy: false,
  runBusy: false,
  proctorBusy: false,
  selectedExam: null,
  libraryReady: false,
  examDetail: null,
  policyEditors: [],
  rulesDirty: false,
  questionDirty: '',
  sources: [],
  runs: [],
  classes: [],
  selectedClassId: '',
  classDetail: null,
  editingClassId: '',
  pendingClassRoster: null,
  classBusy: false,
  classTable: null,
  editingStudentId: '',
  aiProposal: null,
  aiInput: null,
  aiEditors: [],
  aiProviders: [],
  aiReady: false,
  aiBusy: false,
  aiSaveQueue: Promise.resolve(),
  exams: [],
  results: null,
  resultsEpoch: 0,
  aiReviewCursor: -1,
};

const node = (tag, className, content) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = String(content);
  return element;
};
const clear = (element) => element.replaceChildren();
const editRunButton=node('button','','Edit run');editRunButton.id='edit-run';editRunButton.type='button';
const deleteRunButton=node('button','text-button danger-button','Delete run');deleteRunButton.id='delete-run';deleteRunButton.type='button';
$('export-results').after(editRunButton,deleteRunButton);
const closesLabel=node('label','','Students may join until');const closesInput=node('input');closesInput.type='datetime-local';closesInput.id='results-run-closes';closesLabel.append(closesInput);
$('save-run-name').before(closesLabel);$('save-run-name').textContent='Save run changes';
closesInput.addEventListener('input',()=>renderWorkflowState());
editRunButton.addEventListener('click',()=>{ $('results-settings').open=true;$('results-run-name').focus();$('results-settings').scrollIntoView({block:'start'}); });
deleteRunButton.addEventListener('click',()=>perform(async()=>{
 const runId=$('results-run').value;const run=state.runs.find(item=>item.id===runId);if(!run)return;
 if(!window.confirm(`Delete ${run.name}? All student attempts, submissions and grades in this run will be permanently deleted. The activity is kept.`))return;
 deleteRunButton.disabled=true;
 try{await request(`/api/instructor/runs/${runId}`,{method:'DELETE'});state.results=null;await refreshLibrary();await loadResults();message('Class activity deleted.');}
 finally{deleteRunButton.disabled=false;}
}));
const languageSelect = $('ai-programming-language');
const languagePanel = document.createElement('fieldset');
languagePanel.id = 'ai-language-wrap';
languagePanel.className = 'language-picker';
const languageLegend = document.createElement('legend');
languageLegend.textContent = 'Languages and project types';
const languageHelp = document.createElement('p');
languageHelp.id = 'ai-language-help';
languageHelp.className = 'small';
languageHelp.textContent = 'Choose any combination, such as PHP and SQL.';
languagePanel.setAttribute('aria-describedby', languageHelp.id);
const languageChoices = document.createElement('div');
languageChoices.className = 'language-choices';
const languageChecks = new Map();
for (const option of languageSelect.options) {
  const label = document.createElement('label');
  label.className = 'language-choice';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.value = option.value;
  input.checked = option.selected;
  const text = document.createElement('span');
  text.textContent = option.textContent;
  label.append(input, text);
  languageChoices.append(label);
  languageChecks.set(option.value, input);
  input.addEventListener('change', () => {
    if (input.checked && input.value === 'auto') {
      for (const [value, checkbox] of languageChecks) checkbox.checked = value === 'auto';
    } else if (input.checked) languageChecks.get('auto').checked = false;
    if (![...languageChecks.values()].some(checkbox => checkbox.checked)) languageChecks.get('auto').checked = true;
    for (const option of languageSelect.options) option.selected = languageChecks.get(option.value).checked;
    languageSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
const oldLanguageLabel = languageSelect.closest('label');
oldLanguageLabel.replaceWith(languagePanel);
languageSelect.hidden = true;
languageSelect.setAttribute('aria-hidden', 'true');
languageSelect.tabIndex = -1;
languagePanel.append(languageLegend, languageHelp, languageChoices, languageSelect);
const readGenerationLanguages = () => {
  const values = [...languageSelect.selectedOptions].map(option => option.value).filter(value => value !== 'auto');
  return values.join(',') || 'auto';
};
const mixInputs = new Map();
for (const type of questionTypes) {
  const label = node('label', '', type.label),
    input = node('input');
  input.type = 'number';
  input.min = '0';
  input.max = String(assessmentLimits.questions);
  input.step = '1';
  input.value = ['single_choice', 'true_false', 'matching', 'code_writing'].includes(type.id) ? '2' : '0';
  label.append(input);
  $('ai-question-type-counts').append(label);
  mixInputs.set(type.id, input);
  input.addEventListener('input', () => {
    syncQuestionMix();
    updateAiApprovals();
    renderWorkflowState();
  });
}
const readQuestionMix = () =>
  Object.fromEntries([...mixInputs].map(([type, input]) => [type, Number(input.value)]));
function syncQuestionMix() {
  const objective = $('ai-question-mode').value === 'objective';
  $('ai-language-wrap').classList.toggle('hidden', objective);
  $('coding-runtime-status').classList.toggle('hidden', objective);
  const mixed = $('ai-question-mode').value === 'mixed';
  $('ai-question-mix').hidden = !mixed;
  $('ai-questions').readOnly = mixed;
  if (mixed) {
    const total = typeCountTotal(readQuestionMix());
    $('ai-questions').value = String(total);
    $('ai-mix-total').textContent = `${total} / ${assessmentLimits.questions} questions`;
  }
}
const runAccess = createRunAccessStore();
function loadSelectedRun() {
  try {
    return localStorage.getItem('gotItSelectedRun') || '';
  } catch {
    return '';
  }
}
function saveSelectedRun(runId) {
  try {
    localStorage.setItem('gotItSelectedRun', runId);
  } catch {
    /* Keep the current tab usable if browser storage is blocked. */
  }
}
function loadRunAccess(runId) {
  return runAccess.get(runId);
}
function saveRunAccess(runId, details) {
  return runAccess.set(runId, details);
}
function renderRunAccess(runId) {
  const run = state.runs.find((item) => item.id === runId);
  const panel = $('saved-run-access');
  panel.classList.toggle('hidden', !run);
  if (!run) return;
  const saved = loadRunAccess(runId);
  const studentUrl = new URL('/app/student', window.location.href);
  studentUrl.searchParams.set('run', runId);
  const linkLabel = ['localhost', '127.0.0.1'].includes(studentUrl.hostname)
    ? 'Student activity (this computer only)'
    : 'Student activity';
  $('saved-run-access-text').value =
    `${linkLabel}: ${saved?.url || studentUrl.href}\nActivity code: ${runId}${saved?.pin ? `\nActivity PIN: ${saved.pin}` : ''}\nSign in with your School ID from the class roster.`;
  $('saved-run-access-note').textContent = saved?.pin
    ? 'Access details are available in this tab until you refresh or sign out. Copy them now.'
    : 'The PIN is not available in this tab. For privacy, we cannot show the old PIN. Set a new PIN below if needed.';
  $('run-pin-recovery').classList.toggle('hidden', !!saved?.pin);
}

let noticeTimer;
const message = (text, { persistent = false } = {}) => {
  clearTimeout(noticeTimer);
  const box = $('notice');
  box.textContent = text;
  if (text && !persistent)
    noticeTimer = window.setTimeout(() => {
      if (box.textContent === text) box.textContent = '';
    }, 7000);
};

async function request(path, { method = 'GET', data, raw = false, silent = false, signal } = {}) {
  const finishStatus = silent ? () => {} : beginRequestStatus(facultyRequestLabel(path, method));
  const headers = browserSessionHeaders('instructor');
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetch(path, {
      method,
      headers,
      body: data === undefined ? undefined : JSON.stringify(data),
      signal,
    });
    if (raw && response.ok) return await response.blob();
    let result;
    try { result = await response.json(); }
    catch {
      throw apiError({ code: path.startsWith('/api/instructor/ai/') ? 'AI_GATEWAY_ERROR' : 'INVALID_SERVER_RESPONSE',
        message: `Server returned HTTP ${response.status} without a readable JSON response.` }, 'faculty', response.status);
    }
    if (response.status === 401 && state.instructorAuthenticated) {
      state.reauthenticating = true;
      $('instructor-login-panel').classList.remove('hidden');
      $('instructor-workspace').classList.add('hidden');
      $('instructor-password').focus();
    }
    if (!response.ok)
      throw apiError(result, 'faculty', response.status);
    return result.data;
  } finally {
    finishStatus();
  }
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
  return request('/api/instructor/materials/extract', {
    method: 'POST',
    data: { filename: file.name, base64 },
  });
}

const perform = async (fn) => {
  try {
    await fn();
  } catch (error) {
    message(userErrorMessage(error, 'faculty'), { persistent: true });
  }
};

const examKey = (exam) => (exam ? `${exam.examId}@${exam.version}` : '');
const kindOf = (exam) => exam?.kind || 'activity';
const groupWord = (exam) => (kindOf(exam) === 'ctf' ? 'mission' : 'section');
const kindLabel = (exam) =>
  kindOf(exam) === 'ctf' ? 'CTF' : kindOf(exam)[0].toUpperCase() + kindOf(exam).slice(1);
const difficultyLabel = (exam) =>
  exam?.difficulty ? ` · ${exam.difficulty[0].toUpperCase()}${exam.difficulty.slice(1)}` : '';
const materialFileReady = (file) =>
  !!file && /\.(txt|md|pdf|pptx)$/i.test(file.name) && file.size <= 10_000_000;
const aiGroupCount = () =>
  $('ai-kind').value === 'ctf'
    ? Number($('ai-missions').value)
    : Math.ceil(Number($('ai-questions').value) / 4);
const aiConfigMatches = () =>
  state.aiInput &&
  state.aiInput.title === $('ai-title').value.trim() &&
  state.aiInput.subject === $('ai-subject').value.trim() &&
  state.aiInput.kind === $('ai-kind').value &&
  state.aiInput.difficulty === $('ai-difficulty').value &&
  (state.aiInput.questionMode || 'auto') === $('ai-question-mode').value &&
  (state.aiInput.programmingLanguage || 'auto') === readGenerationLanguages() &&
  ($('ai-question-mode').value !== 'mixed' ||
    JSON.stringify(positiveTypeCounts(state.aiInput.questionTypeCounts)) ===
      JSON.stringify(positiveTypeCounts(readQuestionMix()))) &&
  state.aiInput.durationMinutes === Number($('ai-duration').value) &&
  state.aiInput.questionCount === Number($('ai-questions').value) &&
  state.aiInput.missionCount === aiGroupCount() &&
  (state.aiInput.customPrompt || '') === $('ai-custom-prompt').value.trim() &&
  state.aiInput.source.filename === ($('ai-source').files[0]?.name || state.aiInput.source.filename);
const titleChanged = () =>
  state.selectedExam?.status === 'draft' &&
  $('exam-title-input').value.trim() !== (state.examDetail?.public.title || '');

function invalidateValidation() {
  state.validationEpoch++;
  state.validatedKey = null;
  state.validationErrors = [];
  $('validation-output').textContent = '';
  clear($('ai-check-results'));
  state.aiSourceChecks = [];
  $('ai-check').textContent = 'Compare with teaching material';
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
  if (step === 'sources')
    return state.selectedExam?.status === 'draft' && !titleChanged() && !state.rulesDirty;
  if (step === 'review')
    return (
      state.selectedExam?.status === 'published' ||
      (state.selectedExam?.status === 'draft' && !state.rulesDirty)
    );
  return false;
}

function showStep(step) {
  if (state.questionDirty && step !== state.step) {
    message('Save or cancel your question changes before leaving.');
    return;
  }
  const section = document.querySelector(`.faculty-step[data-step="${step}"]`);
  if (!section) return;
  if (state.libraryReady && !stepAllowed(step)) return;
  state.step = step;
  sessionStorage.setItem('facultyStep', step);
  const destination = new URL(location.href);
  destination.searchParams.set('workspace', step);
  if (destination.href !== location.href) history.pushState({ step }, '', destination);
  for (const item of document.querySelectorAll('.faculty-step'))
    item.classList.toggle('hidden', item !== section);
  for (const button of document.querySelectorAll('[data-step-link]')) {
    if (button.dataset.stepLink === step) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
  document
    .querySelector('[data-step-link][aria-current="step"]')
    ?.scrollIntoView({ block: 'nearest', inline: 'center' });
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
  const objectiveCreation = state.step === 'exams' && state.activityMode === 'create' &&
    ($('ai-question-mode').value === 'objective' || ($('ai-question-mode').value === 'mixed' &&
      !(readQuestionMix().code_writing || readQuestionMix().web_project)));
  $('faculty-services').classList.toggle('hidden', !state.instructorAuthenticated || state.step === 'classes' || objectiveCreation);
  const draft = exam?.status === 'draft';
  const published = exam?.status === 'published';
  if (state.libraryReady && !stepAllowed(state.step)) showStep('exams');
  for (const button of document.querySelectorAll('[data-step-link], [data-go-step]')) {
    const target = button.dataset.stepLink || button.dataset.goStep;
    button.disabled = !state.libraryReady || !stepAllowed(target);
    button.title = button.disabled
      ? target === 'run'
        ? state.classes.length
          ? 'Publish an activity before assigning it to a class.'
          : 'Add a class first.'
        : target === 'results'
          ? 'Assign to a class to view results.'
          : titleChanged()
            ? 'Save the activity name first.'
            : state.rulesDirty
              ? 'Save rule changes first.'
              : 'Select a draft activity first.'
      : '';
  }
  const contextualRun = state.runs.find((run) => run.id === $('results-run').value);
  $('selected-exam-title').textContent =
    state.step === 'classes'
      ? 'Classes'
      : state.step === 'results'
        ? contextualRun?.name || 'Class results'
        : state.step === 'exams' && state.activityMode === 'create'
          ? 'New activity'
          : exam?.title || 'Select an activity';
  $('step-exams-title').textContent = state.activityMode === 'create' ? 'Create activity' : 'Activities';
  $('selected-exam-meta').textContent = ['classes', 'results'].includes(state.step)
    ? ''
    : state.step === 'exams' && state.activityMode === 'create'
      ? ''
      : exam
        ? `${kindLabel(exam)}${difficultyLabel(exam)} · v${exam.version} · ${exam.status}`
        : '';
  $('clone-package').classList.toggle('hidden', !published);
  $('clone-package').disabled = !published;
  document
    .querySelector('.faculty-step[data-step="exams"] [data-go-step="review"]')
    .classList.toggle('hidden', !draft);
  document
    .querySelector('.faculty-step[data-step="exams"] [data-go-step="run"]')
    .classList.toggle('hidden', !published);
  const title = $('exam-title-input').value.trim();
  const titleDirty = titleChanged();
  const name = $('results-run-name').value.trim();
  const selectedRun = state.runs.find((run) => run.id === $('results-run').value);
  const coverage = ['cov-topic', 'cov-outcome', 'cov-type', 'cov-evidence'].map((id) => $(id).value.trim());
  const source = state.sources.find((item) => item.id === $('source-select').value);
  const originalCoverage = source?.coverage || {};
  const coverageDirty = coverage.some(
    (value, i) =>
      value !==
      [
        originalCoverage.topic,
        originalCoverage.learningOutcome,
        originalCoverage.proposedActivityType,
        originalCoverage.evidence,
      ][i],
  );
  const pin = $('run-pin-field').value.trim();
  const days = Number($('run-duration-days').value);
  const chosenClass = state.classes.find((item) => item.id === $('run-class').value);
  const runIssue = !published
    ? 'Publish an activity first.'
    : !state.classes.length
      ? 'Add a class in Classes first.'
      : !chosenClass
        ? 'Choose a saved class.'
        : !chosenClass.studentCount
          ? 'Add students to this class before creating a run.'
          : !$('run-name-field').value.trim()
            ? 'Name this run for your class.'
            : pin.length < 4
              ? 'Enter an admission PIN of at least 4 characters.'
              : !Number.isInteger(days) || days < 1 || days > 365
                ? 'Enter a joining window from 1 to 365 days.'
                : '';
  $('workflow-guidance').textContent =
    state.step === 'exams' && state.activityMode === 'create'
      ? state.aiProposal
        ? 'Review the generated questions and save your selection.'
        : 'Generate questions from your teaching material.'
      : state.step === 'classes'
        ? state.classes.length
          ? 'Select a class or edit its roster.'
          : 'Upload a roster to add your first class.'
        : !exam
          ? 'Choose a draft or create an activity.'
          : state.step === 'exams'
            ? draft
              ? titleDirty
                ? 'Save the activity name to continue.'
                : 'Continue this draft or create an activity.'
              : state.classes.length
                ? 'Create an editable copy or assign this activity to a class.'
                : 'Add a class before creating a run.'
            : state.step === 'rules'
              ? state.rulesDirty
                ? 'Save rule changes to continue.'
                : 'Check how many times students may submit each answer and any point or time deductions.'
              : state.step === 'sources'
                ? 'Source notes are optional. Continue to review when ready.'
                : state.step === 'review'
                  ? published
                    ? 'This version is published and locked.'
                    : state.validationErrors.length
                      ? 'Fix the issues shown with the questions.'
                      : state.validatedKey === examKey(exam)
                        ? 'Ready to publish.'
                        : 'Checking the questions and scoring…'
                  : state.step === 'run'
                    ? runIssue || 'Ready to assign this activity to a class.'
                    : state.runs.length
                      ? 'Track participation, review answers, and control score visibility.'
                      : 'Assign to a class to begin tracking results.';
  $('exam-title-input').disabled = !draft;
  $('exam-title-editor').classList.toggle('hidden', !draft);
  $('published-activity-summary').classList.toggle('hidden', !published);
  if (published) {
    const summary = $('published-activity-summary');
    clear(summary);
    summary.append(
      node('strong', '', `Published version ${exam.version}`),
      node('p', 'small', 'This version is ready to run. Create an editable copy to make changes.'),
    );
  }
  $('save-exam-title').disabled = !titleDirty || !title || title.length > 120;
  $('exam-title-help').textContent = !exam
    ? 'Select an activity first.'
    : draft
      ? 'This name appears to students and in Faculty.'
      : 'Published versions are locked. Create an editable copy to change the name.';
  $('save-policies').disabled =
    !draft ||
    !state.rulesDirty ||
    [...$('policy-editor').querySelectorAll('input[type="number"]')].some((input) => !input.checkValidity());
  $('upload-source').disabled = !draft || !materialFileReady($('source-file').files[0]);
  $('save-coverage').disabled = !draft || !source || coverage.some((value) => !value) || !coverageDirty;
  $('source-select').disabled = !state.sources.length;
  $('load-sources').disabled = !exam;
  $('source-file').disabled = !draft;
  $('source-upload-help').textContent = !exam
    ? 'Select a draft activity first.'
    : draft
      ? 'Upload a file to add material to this draft.'
      : 'Create an editable copy of this version to add material.';
  for (const id of ['cov-topic', 'cov-outcome', 'cov-type', 'cov-evidence']) $(id).disabled = !draft;
  const canPublish =
    !state.questionDirty && draft && !state.rulesDirty && !titleDirty && state.validatedKey === examKey(exam);
  $('publish-package').classList.toggle('hidden', !draft);
  $('publish-package').disabled = !canPublish || state.publishBusy || state.validationBusy;
  $('step-review-title').textContent = published ? 'Review published activity' : 'Review and publish';
  $('review-intro').textContent = published
    ? 'View questions and the faculty answer key.'
    : 'Check each question, answer, and source before publishing.';
  $('validate-package').disabled = !draft || state.validationBusy;
  $('validate-package').classList.toggle(
    'hidden',
    !draft || (!state.validationErrors.length && !!state.validatedKey),
  );
  $('review-edit-rules').classList.toggle('hidden', !draft);
  $('review-edit-rules').disabled = !draft;
  $('ai-check').disabled = state.aiSourceChecking || !exam || !state.sources.length || !state.aiReady;
  $('source-check-details').classList.toggle('hidden', !state.sources.length);
  $('create-run').disabled = !!runIssue || state.runBusy;
  $('run-setup-status').textContent = runIssue || 'Ready to assign this activity to a class.';
  $('run-class-status').textContent = chosenClass
    ? `${chosenClass.studentCount} students · ${chosenClass.section}`
    : 'Choose a saved class.';
  const className = $('class-name').value.trim(),
    classSection = $('class-section').value.trim();
  const classFileSelected = $('class-file').files.length > 0;
  $('class-form-title').textContent = state.editingClassId ? 'Edit class' : 'Add class';
  $('class-save').textContent = state.editingClassId ? 'Save changes' : 'Save class';
  $('class-save').disabled =
    state.classBusy ||
    !className ||
    className.length > 80 ||
    !classSection ||
    classSection.length > 40 ||
    (!state.editingClassId && !state.pendingClassRoster?.length) ||
    (classFileSelected && !state.pendingClassRoster?.length);
  $('class-cancel').classList.toggle('hidden', !state.editingClassId);
  $('run-exam-label').textContent = !exam
    ? 'Select an activity first.'
    : published
      ? `${exam.title} · v${exam.version}`
      : 'Publish this version before creating a run.';
  $('load-results').disabled = !$('results-run').value;
  $('export-results').disabled = !$('results-run').value;
  $('save-run-name').disabled = !selectedRun || !name;
  $('edit-run').disabled=!selectedRun; $('delete-run').disabled=!selectedRun;
  const aiDuration = Number($('ai-duration').value),
    aiMissions = aiGroupCount();
  const aiQuestions = Number($('ai-questions').value);
  const isCtf = $('ai-kind').value === 'ctf';
  $('ai-missions-wrap').classList.toggle('hidden', !isCtf);
  $('ai-count-help').textContent = isCtf
    ? Number.isInteger(aiMissions) && aiMissions >= 1 && aiMissions <= assessmentLimits.groups
      ? `${aiMissions} missions need ${aiMissions}–${aiMissions * 4} questions total.`
      : `Choose 1–${assessmentLimits.groups} missions.`
    : Number.isInteger(aiQuestions) && aiQuestions >= 1 && aiQuestions <= assessmentLimits.questions
      ? `${Math.ceil(aiQuestions / 4)} section${aiQuestions > 4 ? 's' : ''} for ${aiQuestions} questions.`
      : `Choose 1–${assessmentLimits.questions} questions.`;
  $('ai-rules-summary').textContent =
    `${aiDuration || 40} minutes · 3 tries per question · retries cost 1 point and 10 seconds. Editable before publication.`;
  $('ai-provider').disabled = state.aiBusy;
  $('ai-model').disabled = state.aiBusy;
  let generateHelp = '';
  if (state.aiBusy) generateHelp = 'Generating your preview…';
  else if (!state.aiReady)
    generateHelp =
      'Choose an available AI service and model.';
  else if (!$('ai-title').value.trim()) generateHelp = 'Enter an activity name.';
  else if (!$('ai-subject').value.trim()) generateHelp = 'Enter a subject.';
  else if (!materialFileReady($('ai-source').files[0]))
    generateHelp = 'Choose a supported teaching source (PDF, PPTX, TXT, or MD, up to 10 MB).';
  else if (!Number.isInteger(aiDuration) || aiDuration < 5 || aiDuration > 180)
    generateHelp = 'Set a duration from 5 to 180 minutes.';
  else if (!Number.isInteger(aiQuestions) || aiQuestions < 1 || aiQuestions > assessmentLimits.questions)
    generateHelp = `Set 1–${assessmentLimits.questions} questions.`;
  else if (
    $('ai-question-mode').value === 'mixed' &&
    validateQuestionMix(readQuestionMix(), aiQuestions).length
  )
    generateHelp = validateQuestionMix(readQuestionMix(), aiQuestions)[0];
  else if (!Number.isInteger(aiMissions) || aiMissions < 1 || aiMissions > assessmentLimits.groups)
    generateHelp = `Set 1–${assessmentLimits.groups} missions.`;
  else if (isCtf && aiQuestions < aiMissions)
    generateHelp = `You set ${aiMissions} missions, so choose at least ${aiMissions} questions (one per mission).`;
  else if (isCtf && aiQuestions > aiMissions * 4)
    generateHelp = `${aiMissions} missions can contain up to ${aiMissions * 4} questions total.`;
  $('ai-generate').disabled = !!generateHelp;
  $('ai-generate-help').textContent = generateHelp || 'Ready to generate preview.';
  if (state.aiProposal && !aiConfigMatches()) $('ai-save').disabled = true;
  if (state.aiBusy) $('ai-save').disabled = true;
  $('ai-save-row').classList.toggle('hidden', !state.aiProposal);
  $('ai-discard').classList.toggle('hidden', !state.aiProposal);
  for (const option of $('faculty-mobile-nav').options)
    option.disabled = !state.libraryReady || !stepAllowed(option.value);
  renderActivityWorkflow();
  renderRunSummary();
  $('results-empty').classList.toggle('hidden', state.runs.length > 0);
  $('results-settings').classList.toggle('hidden', !state.runs.length);
}

function renderActivityWorkflow() {
  const target = $('activity-workflow');
  clear(target);
  const creating = state.step === 'exams' && state.activityMode === 'create';
  target.classList.toggle(
    'hidden',
    ['classes', 'results'].includes(state.step) || (!state.selectedExam && !creating),
  );
  const published = !creating && state.selectedExam?.status === 'published';
  const current = creating || state.step === 'exams' ? 0 : state.step === 'run' ? 2 : 1;
  for (const [index, [label, step]] of [
    ['Draft', 'exams'],
    ['Review and publish', 'review'],
    ['Assign to a class', 'run'],
  ].entries()) {
    const item = node('li', index < current || (published && index < 2) ? 'is-complete' : '');
    const button = node('button', '', `${index + 1} · ${label}`);
    button.type = 'button';
    button.disabled = !stepAllowed(step);
    if (index === current) button.setAttribute('aria-current', 'step');
    button.addEventListener('click', () => showStep(step));
    item.append(button);
    target.append(item);
  }
}

function renderRunSummary() {
  const target = $('run-summary');
  clear(target);
  if (!state.examDetail || state.selectedExam?.status !== 'published') return;
  const exam = state.examDetail.public;
  const chosenClass = state.classes.find((item) => item.id === $('run-class').value);
  const days = Number($('run-duration-days').value);
  target.append(
    node('h2', '', 'Before you create this run'),
    node('strong', '', `${exam.title} · v${exam.version}`),
    node(
      'p',
      '',
      `${exam.settings.durationMinutes} minutes per student · ${chosenClass ? `${chosenClass.name} · ${chosenClass.studentCount} students` : 'Choose a class'}`,
    ),
  );
  if (Number.isInteger(days) && days >= 1 && days <= 365)
    target.append(
      node(
        'p',
        '',
        `Students may join until ${localDateTime(Date.now() + days * 86400_000)}. All attempts end by this time.`,
      ),
    );
  target.append(
    node(
      'p',
      'small',
      $('run-feedback-mode').value === 'graded'
        ? 'Graded: scores stay hidden until you publish them.'
        : 'Practice: students see correctness and scores immediately.',
    ),
    node(
      'p',
      'small',
      $('run-shuffle-questions').checked
        ? 'Questions shuffled within each section or mission.'
        : 'Questions shown in the authored order.',
    ),
  );
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
  } catch {
    /* use default label */
  }
}

function showInstructor() {
  const hasToken = state.instructorAuthenticated;
  $('instructor-login-panel').classList.toggle('hidden', hasToken);
  $('instructor-workspace').classList.toggle('hidden', !hasToken);
  $('instructor-logout').classList.toggle('hidden', !hasToken);
  $('faculty-ai-header').classList.toggle('hidden', !hasToken);
  $('faculty-services').classList.toggle('hidden', !hasToken);
  if (hasToken) {
    state.libraryReady = false;
    showStep(state.step);
    const aiStatusReady = loadAiStatus();
    refreshRuntimeStatus();
    refreshLibrary()
      .then(async () => {
        if (state.selectedExam) await loadSources();
        await aiStatusReady;
        await loadAiWork();
        state.libraryReady = true;
        showStep(stepAllowed(state.step) ? state.step : 'exams');
        renderWorkflowState();
      })
      .catch((error) => {
        if (error.status === 401 || error.code === 'UNAUTHORIZED') {
          state.instructorAuthenticated = false;
          runAccess.clear();
          showInstructor();
          message('Faculty session expired. Please sign in again.');
        } else {
          message(userErrorMessage(error, 'faculty'), { persistent: true });
        }
      });
  }
}

$('instructor-login').addEventListener('submit', (event) => {
  event.preventDefault();
  perform(async () => {
    await request('/api/instructor/login', {
      method: 'POST',
      data: { username: $('instructor-username').value.trim(), password: $('instructor-password').value },
    });
    state.instructorAuthenticated = true;
    $('instructor-password').value = '';
    if (state.reauthenticating) {
      state.reauthenticating = false;
      $('instructor-login-panel').classList.add('hidden');
      $('instructor-workspace').classList.remove('hidden');
      message('Signed in again. Your work is preserved.');
      return;
    }
    showInstructor();
    message('Signed in.');
  });
});

$('instructor-logout').addEventListener('click', () =>
  perform(async () => {
    await state.aiSaveQueue.catch(() => {});
    try {
      await request('/api/instructor/logout', { method: 'POST' });
    } catch (error) {
      if (error.status !== 401) throw error;
    }
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
    clear($('policy-editor'));
    clear($('answer-key'));
    $('run-access-text').value = '';
    $('run-access').classList.add('hidden');
    $('proctor-share-text').value = '';
    $('proctor-share').classList.add('hidden');
    $('proctor-access').classList.add('hidden');
    showStep('exams');
    window.location.reload();
  }),
);

$('new-activity').addEventListener('click', () => {
  setActivityMode('create');
  $('ai-title').focus();
});
$('manage-activities').addEventListener('click', () => setActivityMode('library'));
$('ai-discard').addEventListener('click', () =>
  perform(async () => {
    const jobId = state.aiJobId ?? state.aiProposalJobId;
    if (state.aiJobId) await request(`/api/instructor/ai/jobs/${state.aiJobId}/cancel`, { method: 'POST' });
    state.aiJobId = null;
    state.aiJobReadOnly = false;
    state.aiJobWatch = null;
    state.aiBusy = false;
    try { sessionStorage.removeItem('gotit-ai-job'); } catch { /* Optional local hint. */ }
    await state.aiSaveQueue.catch(() => {});
    await request(`/api/instructor/ai/proposal${jobId ? `?jobId=${encodeURIComponent(jobId)}` : ''}`, { method: 'DELETE' });
    state.aiProposalJobId = null;
    state.aiProposal = null;
    state.aiInput = null;
    state.aiEditors = [];
    clear($('ai-preview'));
    $('ai-selection').textContent = '';
    $('ai-recovery-status').textContent = '';
    $('ai-status').textContent = 'Preview removed.';
    aiJobControls('cancelled');
    renderWorkflowState();
  }),
);

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

$('refresh-library').addEventListener('click', () =>
  perform(async () => {
    if (state.questionDirty || state.rulesDirty || titleChanged())
      throw new Error('Save or cancel your changes before refreshing.');
    await refreshLibrary();
  }),
);

async function refreshRuntimeStatus() {
  const button = $('refresh-services');
  if (!state.instructorAuthenticated || button.disabled) return;
  button.disabled = true;
  try {
    const status = await request('/api/instructor/code/status', { silent: true });
    const creating = state.step === 'exams' && state.activityMode === 'create';
    const selected = readGenerationLanguages().split(',');
    const webProject = !creating || selected.includes('auto') || selected.some(value => ['frontend', 'php-web'].includes(value));
    const text = codeServiceMessage(status, { role: 'faculty', webProject,
      languages: creating ? selected.filter(value => ['python', 'javascript', 'php', 'sql'].includes(value)) : [] });
    $('faculty-runtime-status').textContent = text;
    $('coding-runtime-status').textContent = text;
  } catch {
    $('faculty-runtime-status').textContent =
      'We could not check code running. Check your connection, then select Refresh service status.';
    $('coding-runtime-status').textContent = $('faculty-runtime-status').textContent;
  } finally {
    button.disabled = false;
  }
}
$('refresh-services').addEventListener('click', refreshRuntimeStatus);
window.setInterval(() => {
  if (!document.hidden) refreshRuntimeStatus();
}, 30000);

let savedAiChoice;
const aiChoiceControls = document.createElement('div');
aiChoiceControls.className = 'creation-group';
for (const id of ['ai-provider', 'ai-model']) aiChoiceControls.append($(id).closest('label'));
$('ai-settings-controls').append(aiChoiceControls, $('ai-model-help'));
for (const group of createGrid.querySelectorAll('.creation-group')) if (group.querySelector('legend')?.textContent === 'Question generator') group.remove();
const aiChoiceSummary = node('p', 'ai-selection-summary');
const changeAiChoice = node('button', 'secondary ai-settings-action', 'AI settings');
changeAiChoice.type = 'button';
const aiSelectionBar = node('div', 'ai-selection-bar');
aiSelectionBar.append(aiChoiceSummary, changeAiChoice);
$('ai-create').prepend(aiSelectionBar);
$('ai-status').setAttribute('role', 'status');
$('ai-status').setAttribute('aria-live', 'polite');
async function openAiSettings() {
  const settings = await request('/api/instructor/ai/settings');
  savedAiChoice = settings;
  state.aiProviders = settings.providers;
  $('ai-provider').value = settings.aiProvider;
  updateAiModelState(settings.aiModel);
  $('ai-settings-status').textContent = 'Changes apply to new AI requests. Requests already running keep their original model. No automatic switching.';
  $('ai-settings-dialog').showModal();
}
$('open-ai-settings').addEventListener('click', () => perform(openAiSettings));
changeAiChoice.addEventListener('click', () => perform(openAiSettings));
function restoreAiChoice() {
  if (savedAiChoice) { $('ai-provider').value = savedAiChoice.aiProvider; updateAiModelState(savedAiChoice.aiModel); }
}
$('close-ai-settings').addEventListener('click', () => { restoreAiChoice(); $('ai-settings-dialog').close(); });
$('ai-settings-dialog').addEventListener('cancel', restoreAiChoice);
$('save-ai-settings').addEventListener('click', () => perform(async () => {
  const settings = await request('/api/instructor/ai/settings', { method: 'PUT', data: { aiProvider: $('ai-provider').value, aiModel: $('ai-model').value } });
  savedAiChoice = settings;
  $('ai-settings-status').textContent = 'Settings saved. All new AI requests will use this service and model.';
  updateAiModelState(settings.aiModel);
}));

function updateAiModelState(preferredModel) {
  const provider = state.aiProviders.find(entry => entry.id === $('ai-provider').value);
  const current = preferredModel || $('ai-model').value;
  $('ai-model').replaceChildren();
  for (const model of provider?.models || []) {
    const option = node('option', '', model.label);
    option.value = model.id;
    $('ai-model').append(option);
  }
  if ([...$('ai-model').options].some(option => option.value === current)) $('ai-model').value = current;
  else if (preferredModel) {
    const unavailable = node('option', '', `${preferredModel} (unavailable)`);
    unavailable.value = preferredModel;
    unavailable.disabled = true;
    $('ai-model').append(unavailable);
    $('ai-model').value = preferredModel;
  }
  const selectedModel = provider?.models.find(model => model.id === $('ai-model').value);
  aiChoiceSummary.textContent = `${provider?.label || 'Not selected'} · ${selectedModel?.label || $('ai-model').value}`;
  $('faculty-ai-selection').textContent = aiChoiceSummary.textContent;
  state.aiReady = Boolean(provider?.available && provider.models.some(model => model.id === $('ai-model').value));
  $('ai-model-help').textContent = provider?.available && !state.aiReady
    ? 'This saved AI model is no longer available. Choose another model from the list.'
    : provider?.available
    ? 'New and regenerated questions use the AI service and model you choose. The app will not switch to another service.'
    : `${provider?.label || 'This AI service'} is not set up for this school. Choose another service or ask your technical administrator to set it up.`;
  renderWorkflowState();
  if (state.aiProposal) updateAiApprovals();
}
$('ai-provider').addEventListener('change', () => updateAiModelState());
$('ai-model').addEventListener('change', () => updateAiModelState($('ai-model').value));

async function loadAiStatus() {
  try {
    const result = await request('/api/instructor/ai/settings');
    savedAiChoice = result;
    $('ai-provider').value = result.aiProvider || 'gemini';
    state.aiProviders = result.providers || [{ id: 'gemini', label: 'Google Gemini', available: result.available, models: [{ id: result.model, label: result.model }] }];
    updateAiModelState(result.aiModel);
    $('ai-status').textContent = state.aiReady ? 'AI is ready. Check every question and correct answer before publishing.' : 'The selected AI service or model is not ready. Choose another one or ask your technical administrator for help.';
  } catch {
    state.aiReady = false;
    $('ai-status').textContent = 'We could not check the AI service. Refresh this page, then try again.';
    renderWorkflowState();
  }
}

function answerPreview(answer) {
  if (typeof answer === 'boolean') return answer ? 'True' : 'False';
  if (Array.isArray(answer)) return answer.join(' → ');
  if (answer && typeof answer === 'object')
    return `${answer.value} ${answer.unit || ''} (tolerance ±${answer.tolerance})`;
  return String(answer ?? 'Missing');
}

const selectedAiQuestions = () =>
  state.aiEditors.flatMap((editor, missionIndex) =>
    editor.questions.flatMap((question, questionIndex) =>
      question.checkbox.checked ? [`${missionIndex}:${questionIndex}`] : [],
    ),
  );

function queueAiWorkSave() {
  if (!state.aiProposal || !state.aiInput) return;
  const snapshot = { input: state.aiInput, proposal: state.aiProposal, selected: selectedAiQuestions(),
    job: state.aiProposalJobId ? { id: state.aiProposalJobId, complete: state.aiJobImportedComplete === true } : null };
  state.aiSaveQueue = state.aiSaveQueue
    .catch(() => {})
    .then(() => request('/api/instructor/ai/proposal', { method: 'PUT', data: snapshot }));
  state.aiSaveQueue.catch(() => {
    $('ai-recovery-status').textContent = 'We could not save your question review. Keep this page open and check your connection.';
  });
}

async function loadAiWork() {
  const saved = await request('/api/instructor/ai/proposal');
  const jobs = await request('/api/instructor/ai/jobs', { silent: true });
  const listedIds = jobs.jobs.filter(job => !saved || job.id === saved.job?.id ||
    ['running', 'paused'].includes(job.status) || job.updated_at > jobs.reviewUpdatedAt).map(job => job.id);
  const pendingReviewId = saved?.job?.complete === false ? saved.job.id : null;
  let hint;
  try { hint = sessionStorage.getItem('gotit-ai-job'); } catch { /* Server list remains available. */ }
  const recoverIds = new Set(listedIds);
  if (pendingReviewId) recoverIds.add(pendingReviewId);
  const first = recoverIds.delete(hint) ? [hint] : [];
  for (const recoverId of [...first, ...recoverIds]) {
    try {
      const job = await request(`/api/instructor/ai/jobs/${recoverId}`, { silent: true });
      if (['running', 'paused'].includes(job.status) ||
        (['done', 'cancelled'].includes(job.status) && job.completedQuestions &&
          !(saved?.job?.id === recoverId && saved.job.complete))) {
        void followAiJob(job).catch(error => { $('ai-status').textContent = userErrorMessage(error, 'faculty'); });
        setActivityMode('create');
        return;
      }
    } catch (error) { if (error.status !== 404) throw error; }
  }
  try { sessionStorage.removeItem('gotit-ai-job'); } catch { /* Optional local hint. */ }
  if (!saved) return;
  state.aiJobId = null;
  state.aiJobReadOnly = false;
  state.aiProposalJobId = saved.job?.id ?? null;
  state.aiJobImportedComplete = saved.job?.complete === true;
  state.aiInput = saved.input;
  state.aiProposal = saved.proposal;

  for (const [id, value] of Object.entries({
    'ai-title': saved.input.title,
    'ai-subject': saved.input.subject,
    'ai-kind': saved.input.kind,
    'ai-difficulty': saved.input.difficulty,
    'ai-duration': saved.input.durationMinutes,
    'ai-questions': saved.input.questionCount,
    'ai-missions': saved.input.missionCount,
    'ai-custom-prompt': saved.input.customPrompt || '',
    'ai-question-mode': saved.input.questionMode || 'auto',
    'ai-programming-language': saved.input.programmingLanguage || 'auto',
  }))
    if (id === 'ai-programming-language') {
      for (const option of $(id).options) {
        option.selected = String(value).split(',').includes(option.value);
        languageChecks.get(option.value).checked = option.selected;
      }
    } else $(id).value = String(value ?? '');
  if (saved.input.questionMode === 'mixed')
    for (const [type, input] of mixInputs) input.value = String(saved.input.questionTypeCounts?.[type] ?? 0);
  syncQuestionMix();
  $('ai-recovery-status').textContent = `Recovered preview · ${saved.input.source.filename}`;
  $('ai-status').textContent = 'Review answers and approve questions.';
  renderAiPreview(saved.proposal, new Set(saved.selected));
  setActivityMode('create');
}

function aiJobControls(status) {
  let controls = $('ai-job-controls');
  if (!controls) {
    controls = node('div', 'button-row');
    controls.id = 'ai-job-controls';
    for (const [action, label] of [['resume', 'Resume generation'], ['pause', 'Pause'], ['cancel', 'Cancel generation']]) {
      const button = node('button', '', label);
      button.id = `ai-job-${action}`;
      button.type = 'button';
      button.addEventListener('click', () => perform(async () => {
        if (!state.aiJobId) return;
        const job = await request(`/api/instructor/ai/jobs/${state.aiJobId}/${action}`, { method: 'POST' });
        await followAiJob(job);
      }));
      controls.append(button);
    }
    $('ai-status').after(controls);
  }
  controls.hidden = !['running', 'paused'].includes(status);
  $('ai-job-resume').hidden = status !== 'paused';
  $('ai-job-pause').hidden = status !== 'running';
}

async function followAiJob(initial) {
  const id = initial.jobId;
  const watch = {};
  state.aiJobWatch = watch;
  state.aiJobRenderedCount = -1;
  state.aiJobId = id;
  state.aiInput = initial.input;
  for (const [key, value] of Object.entries({ title: initial.input.title, subject: initial.input.subject, kind: initial.input.kind,
    difficulty: initial.input.difficulty ?? 'medium', duration: initial.input.durationMinutes, questions: initial.input.questionCount,
    missions: initial.input.missionCount, 'custom-prompt': initial.input.customPrompt ?? '', 'question-mode': initial.input.questionMode ?? 'auto' }))
    $(`ai-${key}`).value = String(value ?? '');
  for (const option of languageSelect.options) {
    option.selected = String(initial.input.programmingLanguage ?? 'auto').split(',').includes(option.value);
    languageChecks.get(option.value).checked = option.selected;
  }
  if (initial.input.questionMode === 'mixed')
    for (const [type, input] of mixInputs) input.value = String(initial.input.questionTypeCounts?.[type] ?? 0);
  syncQuestionMix();
  try { sessionStorage.setItem('gotit-ai-job', id); } catch { /* Server progress remains durable. */ }
  let job = initial;
  try {
  while (state.aiJobId === id && state.aiJobWatch === watch) {
    state.aiBusy = job.status === 'running';
    state.aiJobReadOnly = job.status === 'running' || (job.status === 'paused' && job.error?.code !== 'AI_INVALID_DRAFT');
    state.aiProposalJobId = id;
    state.aiJobImportedComplete = ['done', 'cancelled'].includes(job.status);
    aiJobControls(job.status);
    $('ai-status').textContent = `${job.completedQuestions} / ${job.totalQuestions} questions · ${job.status === 'running' ? 'generating…' : job.status}`;
    if (job.completedQuestions && job.completedQuestions !== state.aiJobRenderedCount) {
      state.aiProposal = job.proposal;
      state.aiJobRenderedCount = job.completedQuestions;
      renderAiPreview(job.proposal);
    }
    renderWorkflowState();
    if (job.status === 'running' || (job.status === 'paused' && job.error?.code !== 'AI_INVALID_DRAFT'))
      for (const control of $('ai-preview').querySelectorAll('button,input,select,textarea')) control.disabled = true;
    if (job.status !== 'running') {
      state.aiProposal = job.proposal;
      renderAiPreview(job.proposal);
      if (job.status === 'paused' && job.error?.code !== 'AI_INVALID_DRAFT')
        for (const control of $('ai-preview').querySelectorAll('button,input,select,textarea')) control.disabled = true;
      if (job.completedQuestions) {
        queueAiWorkSave();
        if (['done', 'cancelled'].includes(job.status)) {
          await state.aiSaveQueue;
          try { sessionStorage.removeItem('gotit-ai-job'); } catch { /* Optional local hint. */ }
          state.aiJobId = null;
        }
      }
      $('ai-recovery-status').textContent = 'Completed batches are saved.';
      const retryMessage = job.error && userErrorMessage(job.error, 'faculty');
      const pinnedSelection = job.error && ['AI_INVALID_JSON', 'AI_OUTPUT_TRUNCATED', 'AI_MODEL_UNAVAILABLE', 'AI_RATE_LIMITED'].includes(job.error.code)
        ? ' Resume uses this job’s original model and question count. Start a new generation to change them.'
        : '';
      $('ai-status').textContent = job.status === 'done' ? `${job.completedQuestions} questions ready. Review answers before approving.`
        : job.status === 'paused' ? `${job.completedQuestions} / ${job.totalQuestions} saved. ${retryMessage || 'Resume when ready.'}${pinnedSelection}`
        : 'Generation cancelled. Completed batches are saved.';
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
    job = await request(`/api/instructor/ai/jobs/${id}`, { silent: true });
  }
  } finally {
    if (state.aiJobWatch === watch) {
      state.aiBusy = false;
      renderWorkflowState();
      if (state.aiJobReadOnly && job.error?.code !== 'AI_INVALID_DRAFT')
        for (const control of $('ai-preview').querySelectorAll('button,input,select,textarea')) control.disabled = true;
    }
  }
}

function questionEditor(activity, saveEdited, settings = {}) {
  const placeholder = node('details', 'ai-evidence');
  placeholder.append(node('summary', '', 'Edit question'));
  placeholder.addEventListener('toggle', () => {
    if (!placeholder.open) return;
    if (!settings.saved && state.aiJobReadOnly) { placeholder.open = false; return; }
    const editor = buildQuestionEditor(activity, saveEdited, settings);
    placeholder.replaceWith(editor);
    editor.open = true;
  });
  return placeholder;
}

function buildQuestionEditor(activity, saveEdited, settings = {}) {
  const details = node('details', 'ai-evidence');
  details.append(node('summary', '', 'Edit question'));
  const form = node('form', 'stack ai-edit-form');
  const field = (labelText, tag = 'input') => {
    const label = node('label', '', labelText),
      input = node(tag);
    if (tag === 'input') input.type = 'text';
    label.append(input);
    form.append(label);
    return { label, input };
  };
  const type = field('Question type', 'select');
  for (const { id, label } of questionTypes) {
    const option = node('option', '', label);
    option.value = id;
    type.input.append(option);
  }
  type.input.value = [...type.input.options].some((option) => option.value === activity.type)
    ? activity.type
    : 'single_choice';
  const prompt = field('Question · fence code with ```python, ```php, ```sql, or ```javascript', 'textarea');
  prompt.input.value = activity.prompt || '';
  prompt.input.required = true;
  const points = settings.saved ? field('Question points') : null;
  if (points) {
    points.input.type = 'number';
    points.input.min = '1';
    points.input.max = '10000';
    points.input.required = true;
    points.input.value = settings.points;
  }
  const options = field('Options · one per line', 'textarea');
  options.input.value = (Array.isArray(activity.options) ? activity.options : []).join('\n');
  const answer = field('Correct answer · one per line for multiple answers', 'textarea');
  answer.input.value = Array.isArray(activity.answer)
    ? activity.answer.join('\n')
    : String(activity.answer ?? '');
  const truth = field('Correct answer', 'select');
  for (const value of ['true', 'false']) {
    const option = node('option', '', value);
    option.value = value;
    truth.input.append(option);
  }
  truth.input.value = String(activity.answer === true);
  const numericValue = field('Number');
  numericValue.input.type = 'number';
  numericValue.input.step = 'any';
  numericValue.input.value = activity.answer?.value ?? '';
  const tolerance = field('Tolerance');
  tolerance.input.type = 'number';
  tolerance.input.min = '0';
  tolerance.input.step = 'any';
  tolerance.input.value = activity.answer?.tolerance ?? '0';
  const unit = field('Unit');
  unit.input.value = activity.answer?.unit ?? '';
  const quote = field('Source quote · optional', 'textarea');
  quote.input.value = activity.evidenceQuote || '';
  const location = field('Slide or page · optional');
  location.input.value = activity.location || '';
  const web = createWebQuestionEditor(activity);
  form.append(web.element);
  if (settings.saved) {
    quote.label.hidden = true;
    location.label.hidden = true;
  }
  const coding = createCodeQuestionEditor(activity);
  form.append(coding.element);
  const matching = createMatchingEditor(activity);
  form.append(matching.element);
  const table = createTableQuestionEditor(activity);
  form.append(table.element);
  const sync = () => {
    const value = type.input.value;
    options.label.hidden = !['single_choice', 'multiple_choice', 'sequencing'].includes(value);
    options.input.required = !options.label.hidden;
    web.element.hidden = value !== 'web_project';
    coding.element.hidden = value !== 'code_writing';
    matching.element.hidden = value !== 'matching';
    table.element.hidden = !['data_inspection', 'datatable_code'].includes(value);
    table.setType(value);
    for (const editor of [web, coding, matching, table])
      for (const control of editor.element.querySelectorAll('input,select,textarea,button'))
        control.disabled = editor.element.hidden;
    answer.label.hidden = [
      'true_false',
      'numeric_entry',
      'code_writing',
      'web_project',
      'matching',
      'data_inspection',
      'datatable_code',
    ].includes(value);
    answer.input.required = !answer.label.hidden;
    truth.label.hidden = value !== 'true_false';
    for (const item of [numericValue, tolerance, unit]) {
      item.label.hidden = value !== 'numeric_entry';
      item.input.required = value === 'numeric_entry' && item !== unit;
      item.input.disabled = value !== 'numeric_entry';
    }
    answer.label.firstChild.textContent =
      value === 'single_choice'
        ? 'Correct option text · match one option exactly'
        : 'Correct answer · one per line for multiple answers';
  };
  type.input.addEventListener('change', sync);
  sync();
  const actions = node('div', 'button-row'),
    save = node('button', 'primary', 'Save question');
  save.type = 'submit';
  actions.append(save);
  const cancel = node('button', '', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => {
    details.open = false;
    settings.cancel?.();
  });
  actions.append(cancel);
  form.append(actions);
  if (settings.saved) {
    form.addEventListener('input', () => settings.changed?.(details));
    form.addEventListener('change', () => settings.changed?.(details));
    details.querySelector('summary').addEventListener('click', (event) => {
      if (state.questionDirty && (!details.open || state.questionDirty === settings.id)) {
        event.preventDefault();
        message('Save or cancel the current question changes first.');
      }
    });
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    perform(async () => {
      const value = type.input.value;
      const lines = (text) =>
        text
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean);
      const edited = {
        ...activity,
        type: value,
        prompt: prompt.input.value.trim(),
        evidenceQuote: quote.input.value.trim(),
        location: location.input.value.trim(),
        sourceMatchPercent: null,
        sourceMatchReason: 'Edited by faculty; source match was not re-estimated.',
      };
      if (['single_choice', 'multiple_choice', 'sequencing'].includes(value))
        edited.options = lines(options.input.value);
      else delete edited.options;
      edited.answer =
        value === 'true_false'
          ? truth.input.value === 'true'
          : value === 'numeric_entry'
            ? {
                value: Number(numericValue.input.value),
                tolerance: Number(tolerance.input.value),
                unit: unit.input.value.trim(),
              }
            : value === 'single_choice'
              ? answer.input.value.trim()
              : lines(answer.input.value);
      if (points) edited.points = Number(points.input.value);
      if (value === 'code_writing') {
        Object.assign(edited, coding.value());
        delete edited.answer;
      }
      if (value === 'web_project') {
        Object.assign(edited, web.read());
        delete edited.answer;
      }
      if (value === 'matching') {
        Object.assign(edited, matching.value());
        delete edited.answer;
      }
      if (['data_inspection', 'datatable_code'].includes(value)) Object.assign(edited, table.value(value));
      save.disabled = true;
      try {
        await saveEdited(edited);
      } finally {
        save.disabled = false;
      }
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
    const available = editor.questions.filter((question) => question.ready);
    for (const question of editor.questions) {
      question.checkbox.disabled = state.aiJobReadOnly || !question.eligible;
      if (question.checkbox.checked) {
        selected++;
        if (question.sourceMatchPercent !== null) selectedScores.push(question.sourceMatchPercent);
      }
    }
    editor.mission.checked = available.length > 0 && available.every((question) => question.checkbox.checked);
    editor.mission.indeterminate =
      !editor.mission.checked && available.some((question) => question.checkbox.checked);
    editor.mission.disabled = available.length === 0;
    editor.summary.textContent = `${editor.heading} · ${selected}/${editor.questions.length} approved`;
    if (selected) approvedMissions++;
    approvedQuestions += selected;
    if (selected > 4) overLimit = true;
  }
  const word = groupWord(state.aiInput || { kind: $('ai-kind').value });
  const totalQuestions = state.aiEditors.reduce((sum, editor) => sum + editor.questions.length, 0);
  const count = `${approvedQuestions} of ${totalQuestions} questions approved · ${approvedMissions} ${word}${approvedMissions === 1 ? '' : 's'}`;
  const average =
    selectedScores.length === approvedQuestions && selectedScores.length
      ? ` · ${Math.round(selectedScores.reduce((sum, score) => sum + score, 0) / selectedScores.length)}% source match (AI estimate)`
      : '';
  $('ai-selection').textContent = !state.aiProposal
    ? ''
    : overLimit
      ? `${count}. Limit: 4 questions per ${word}.`
      : approvedMissions > assessmentLimits.groups
        ? `${count}. Limit: ${assessmentLimits.groups} ${word}s.`
        : count + average;
  const setupMatches = aiConfigMatches();
  if (state.aiProposal && !setupMatches)
    $('ai-selection').textContent =
      `Setup changed. Generate a new preview before saving. ${count}${average}.`;
  $('ai-save').disabled = state.aiBusy || state.aiJobReadOnly || !approvedQuestions || overLimit || approvedMissions > assessmentLimits.groups || !setupMatches;
  $('ai-next-unreviewed').disabled = approvedQuestions === totalQuestions;
  for (const editor of state.aiEditors)
    for (const question of editor.questions)
      question.card.classList.toggle('is-approved', question.checkbox.checked);
}

$('ai-next-unreviewed').addEventListener('click', () => {
  const questions = state.aiEditors.flatMap((editor) => editor.questions);
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
  const design = {
    ...structuredClone(state.aiProposal.design),
    missions: (Array.isArray(state.aiProposal.design?.missions) ? state.aiProposal.design.missions : []).map(
      (mission) => ({
        ...structuredClone(mission),
        activities: structuredClone(Array.isArray(mission?.activities) ? mission.activities : []),
      }),
    ),
  };
  const approved = new Set(
    [...selectedAiQuestions()].map((key) => {
      const [mission, question] = key.split(':').map(Number);
      return design.missions[mission]?.activities[question];
    }),
  );
  change(design);
  const selected = new Set(
    design.missions.flatMap((mission, mi) =>
      mission.activities.flatMap((question, qi) => (approved.has(question) ? [`${mi}:${qi}`] : [])),
    ),
  );
  state.aiBusy = true;
  const controls = [...$('ai-preview').querySelectorAll('button,input,select,textarea')].map((control) => [
    control,
    control.disabled,
  ]);
  for (const [control] of controls) control.disabled = true;
  try {
    state.aiProposal = await request('/api/instructor/ai/inspect', {
      method: 'POST',
      data: { ...state.aiInput, design },
    });
    renderAiPreview(state.aiProposal, selected, openMissionIndex);
    queueAiWorkSave();
  } finally {
    for (const [control, disabled] of controls) if (control.isConnected) control.disabled = disabled;
    state.aiBusy = false;
    updateAiApprovals();
    renderWorkflowState();
  }
}

async function regenerateQuestions(targets) {
  if (state.aiBusy || !targets.length) return;
  if (!state.aiReady) throw new Error('Choose an available AI service and model before regenerating this question.');
  if (state.aiJobId) {
    await request(`/api/instructor/ai/jobs/${state.aiJobId}/cancel`, { method: 'POST' });
    state.aiJobId = null;
    state.aiJobReadOnly = false;
    state.aiJobImportedComplete = true;
  }
  state.aiInput = { ...state.aiInput, aiProvider: $('ai-provider').value, aiModel: $('ai-model').value };
  const selected = new Set(selectedAiQuestions());
  state.aiBusy = true;
  renderWorkflowState();
  const controls = [...$('ai-preview').querySelectorAll('button,input,select,textarea')].map(control => [control, control.disabled]);
  for (const [control] of controls) control.disabled = true;
  $('ai-status').textContent = `Regenerating ${targets.length === 1 ? 'question' : `${targets.length} invalid questions`}…`;
  try {
    const proposal = await request('/api/instructor/ai/regenerate', {
      method: 'POST', data: { ...state.aiInput, design: state.aiProposal.design, targets },
    });
    const results = proposal.regeneration ?? [];
    state.aiProposal = proposal;
    for (const result of results) if (result.replaced) selected.delete(`${result.missionIndex}:${result.questionIndex}`);
    state.aiProposal = { ...state.aiProposal, regeneration: results };
    renderAiPreview(state.aiProposal, selected, targets[0].missionIndex);
    queueAiWorkSave();
    const count = results.filter(result => result.replaced).length;
    $('ai-status').textContent = proposal.paused
      ? `${count} replaced. Regeneration paused at its budget. Continue when ready.`
      : `${count} of ${targets.length} replaced. Review before approving.`;
  } finally {
    for (const [control, disabled] of controls) if (control.isConnected) control.disabled = disabled;
    state.aiBusy = false;
    updateAiApprovals();
    renderWorkflowState();
  }
}

function renderAiPreview(proposal, selected = new Set(), openMissionIndex = 0) {
  const target = $('ai-preview');
  clear(target);
  state.aiEditors = [];
  state.aiReviewCursor = -1;
  target.append(node('h2', '', 'Review questions'));
  if (proposal.paused && proposal.pendingTargets?.length) {
    const resume = node('button', '', `Continue regeneration (${proposal.pendingTargets.length})`);
    resume.type = 'button';
    resume.addEventListener('click', () => perform(() => regenerateQuestions(proposal.pendingTargets)));
    target.append(resume);
  }
  const invalidTargets = proposal.missions.flatMap((mission, missionIndex) => mission.questions.flatMap((question, questionIndex) => question.ready ? [] : [{ missionIndex, questionIndex }]));
  if (invalidTargets.length) {
    const regenerateAll = node('button', '', `Regenerate invalid questions (${invalidTargets.length})`);
    regenerateAll.type = 'button';
    regenerateAll.addEventListener('click', () => perform(() => regenerateQuestions(invalidTargets)));
    target.append(regenerateAll);
  }
  for (const result of proposal.regeneration || []) if (!result.replaced)
    target.append(node('p', 'ai-issue', `(REGENERATION FAILED: Section ${result.missionIndex + 1}, question ${result.questionIndex + 1} — ${questionIssueText(result.issue)}) Your original question has been kept.`));

  for (const warning of new Set(proposal.warnings || []))
    target.append(node('p', 'ai-issue', `(GENERATION WARNING: ${questionIssueText(warning)})`));
  target.append(
    node(
      'p',
      'ai-score',
      `Based on your teaching material: ${proposal.sourceMatchPercent === null ? 'not estimated' : `${proposal.sourceMatchPercent}% (AI estimate)`}. Check the questions and answers yourself.`,
    ),
  );
  target.append(
    node(
      'p',
      'small',
      'Check each question and its correct answer. You can edit, add, remove or rearrange questions. Approve the ones you want to use.',
    ),
  );
  const word = groupWord(state.aiInput);
  if (proposal.missions.length !== state.aiInput.missionCount)
    target.append(
      node(
        'p',
        'small',
        `Preview: ${proposal.missions.length} ${word}s. Originally requested: ${state.aiInput.missionCount}. You may keep your edited layout.`,
      ),
    );
  const generatedQuestions = proposal.missions.reduce((total, group) => total + group.questions.length, 0);
  if (generatedQuestions !== state.aiInput.questionCount)
    target.append(
      node(
        'p',
        'small',
        `Preview: ${generatedQuestions} questions. Originally requested: ${state.aiInput.questionCount}. You may approve a different count.`,
      ),
    );
  for (const [missionIndex, rawMission] of (Array.isArray(proposal.design?.missions)
    ? proposal.design.missions
    : []
  ).entries()) {
    const mission = {
      ...(rawMission && typeof rawMission === 'object' ? rawMission : {}),
      activities: Array.isArray(rawMission?.activities) ? rawMission.activities : [],
    };
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
    const addQuestion = node('button', '', 'Add question');
    addQuestion.type = 'button';
    addQuestion.disabled = mission.activities.length >= 4;
    addQuestion.addEventListener('click', () =>
      perform(() =>
        mutateAiDesign((design) => {
          design.missions[missionIndex].activities.push({
            type: 'single_choice',
            prompt: '',
            options: ['Option A', 'Option B'],
            answer: 'Option A',
            sourceMatchPercent: null,
            sourceMatchReason: 'Added by faculty.',
          });
        }, missionIndex),
      ),
    );
    const removeSection = node('button', 'text-button', `Remove ${word}`);
    removeSection.type = 'button';
    removeSection.addEventListener('click', () =>
      perform(() =>
        mutateAiDesign(
          (design) => {
            design.missions.splice(missionIndex, 1);
          },
          Math.max(0, missionIndex - 1),
        ),
      ),
    );
    groupActions.append(addQuestion, removeSection);
    section.append(groupActions);
    if (mission.story) section.append(node('p', 'small', mission.story));
    const editor = { mission: missionCheckbox, summary, heading, questions: [] };
    for (const [questionIndex, rawActivity] of (Array.isArray(mission.activities)
      ? mission.activities
      : []
    ).entries()) {
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
      card.append(
        node(
          'p',
          'small',
          questionTypes.find((type) => type.id === activity.type)?.label || activity.type || 'Choose a type',
        ),
      );
      card.append(renderPrompt(activity.prompt || 'No question prompt', 'ai-prompt'));
      for (const warning of result.qualityWarnings ?? []) card.append(node('p', 'small ai-warning', warning));
      if (Array.isArray(activity.options) && activity.options.length) {
        const options = node('ol', 'ai-options');
        for (const option of activity.options) options.append(node('li', '', option));
        card.append(options);
      }
      if (activity.type === 'code_writing' && result.ready) {
        appendCodeExamples(card, activity);
        if (Array.isArray(activity.tests)) {
        const reference = node('details', 'ai-evidence');
        reference.append(node('summary', '', 'Sample solution and answer checks'));
        reference.append(renderPrompt(`\`\`\`${activity.language}\n${activity.referenceCode || ''}\n\`\`\``));
        (activity.tests || []).forEach((test, index) => {
          reference.append(
            node('p', 'small', `Grading test ${index + 1} · Input`),
            node('pre', '', test.input || '(no input)'),
            node('p', 'small', 'Expected output'),
            node('pre', '', test.output || '(empty output)'),
          );
        });
        card.append(reference);
        const check = node('button', '', 'Check reference solution');
        check.type = 'button';
        const checked = node('p', 'small');
        checked.setAttribute('role', 'status');
        check.addEventListener('click', () =>
          perform(async () => {
            check.disabled = true;
            checked.textContent = 'Checking reference solution…';
            try {
              const samples = [];
              for (let offset = 0; offset < activity.tests.length; offset += 3) {
                const config = {
                  language: activity.language,
                  starterCode: '',
                  samples: activity.tests.slice(offset, offset + 3),
                  comparison: activity.comparison,
                };
                const result = await request('/api/instructor/code/preview', {
                  method: 'POST',
                  data: { config, value: activity.referenceCode },
                });
                samples.push(
                  ...result.samples.map((sample, index) => ({
                    ...sample,
                    matches:
                      sample.succeeded &&
                      outputMatches(sample.output, config.samples[index].output, config.comparison),
                  })),
                );
              }
              checked.textContent = samples.every((sample) => sample.matches)
                ? 'Reference solution passes all tests.'
                : samples
                    .map(
                      (sample, index) =>
                        `Test ${index + 1}: ${sample.matches ? 'passed' : `failed. ${sample.error || sample.output}`}`,
                    )
                    .join('\n');
            } finally {
              check.disabled = false;
            }
          }),
        );
        card.append(check, checked);
        } else card.append(node('pre', 'answer-value', (activity.rubric || []).join('\n')));
      } else if (activity.type === 'web_project') {
        appendExpectedOutput(card, { expectedHtml: activity.expectedHtml });
        card.append(
          node('p', 'ai-answer', 'Grading guide for faculty'),
          node('pre', 'answer-value', (activity.rubric || []).join('\n')),
        );
      } else if (activity.type === 'matching') {
        card.append(node('p', 'ai-answer', 'Correct pairs · faculty only'));
        for (const pair of Array.isArray(activity.pairs) ? activity.pairs.filter(Boolean) : [])
          card.append(node('p', 'small', `${pair.left} → ${pair.right}`));
      } else if (['data_inspection', 'datatable_code'].includes(activity.type)) {
        card.append(
          node('p', 'small', 'Table data'),
          node(
            'pre',
            'table-question-preview',
            (Array.isArray(activity.table?.rows) ? activity.table.rows.filter(row => row && typeof row === 'object') : [])
              .map((row) =>
                (Array.isArray(activity.table?.columns) ? activity.table.columns.filter(column => column && typeof column === 'object') : [])
                  .map((column) => `${column.label}: ${row[column.id]}`)
                  .join(' · '),
              )
              .join('\n'),
          ),
        );
        card.append(
          node('p', 'ai-answer', 'Correct table settings · faculty only'),
          node(
            'pre',
            'table-question-preview',
            tableTargetSummary(activity),
          ),
        );
      } else card.append(node('p', 'ai-answer', `Correct answer: ${answerPreview(activity.answer)}`));
      card.append(
        node(
          'p',
          'ai-score',
          `Based on your teaching material: ${result.sourceMatchPercent === null ? 'not estimated' : `${result.sourceMatchPercent}% (AI estimate)`}. This does not confirm the answer is correct.`,
        ),
      );
      if (!result.ready) card.append(node('p', 'ai-issue', `(INVALID QUESTION: ${questionIssueText(result.issue)})`));
      if (result.sourceMatchReason || result.evidence?.quote) {
        const evidence = node('details', 'ai-evidence');
        evidence.append(node('summary', '', 'How this relates to your material'));
        if (result.sourceMatchReason) evidence.append(node('p', 'small', result.sourceMatchReason));
        if (result.evidence?.quote) {
          evidence.append(node('p', 'small', `${result.evidence.file} · ${result.evidence.location}`));
          evidence.append(node('blockquote', '', result.evidence.quote));
        }
        card.append(evidence);
      }
      if (!eligible) card.append(node('p', 'small', 'Edit or regenerate this question before approving.'));
      card.append(
        questionEditor(activity, async (edited) => {
          await mutateAiDesign((design) => {
            design.missions[missionIndex].activities[questionIndex] = edited;
          }, missionIndex);
          message('Question updated. Check its format and answer before approval.');
        }),
      );
      const questionActions = node('div', 'button-row');
      if (!result.ready || result.qualityWarnings?.length) {
        const regenerate = node('button', '', 'Regenerate question');
        regenerate.type = 'button';
        regenerate.addEventListener('click', () => perform(() => regenerateQuestions([{ missionIndex, questionIndex }])));
        questionActions.append(regenerate);
      }

      for (const [label, transform, disabled] of [
        [
          'Move up',
          (items) => {
            [items[questionIndex - 1], items[questionIndex]] = [
              items[questionIndex],
              items[questionIndex - 1],
            ];
          },
          questionIndex === 0,
        ],
        [
          'Move down',
          (items) => {
            [items[questionIndex + 1], items[questionIndex]] = [
              items[questionIndex],
              items[questionIndex + 1],
            ];
          },
          questionIndex === mission.activities.length - 1,
        ],
        [
          'Duplicate question',
          (items) => items.splice(questionIndex + 1, 0, structuredClone(items[questionIndex])),
          mission.activities.length >= 4,
        ],
        ['Remove question', (items) => items.splice(questionIndex, 1), false],
      ]) {
        const button = node('button', 'text-button', label);
        button.type = 'button';
        button.disabled = disabled;
        button.addEventListener('click', () =>
          perform(() =>
            mutateAiDesign((design) => transform(design.missions[missionIndex].activities), missionIndex),
          ),
        );
        questionActions.append(button);
      }
      card.append(questionActions);
      editor.questions.push({
        checkbox,
        card,
        section,
        eligible,
        ready: result.ready,
        sourceMatchPercent: result.sourceMatchPercent,
        activity,
      });
      checkbox.addEventListener('change', () => {
        updateAiApprovals();
        queueAiWorkSave();
      });
      section.append(card);
    }
    missionCheckbox.addEventListener('change', () => {
      for (const question of editor.questions)
        if (question.eligible) question.checkbox.checked = missionCheckbox.checked;
      updateAiApprovals();
      queueAiWorkSave();
    });
    state.aiEditors.push(editor);
    target.append(section);
  }
  const addSection = node('button', '', `Add ${word}`);
  addSection.type = 'button';
  addSection.disabled = (proposal.design?.missions?.length ?? 0) >= assessmentLimits.groups;
  addSection.addEventListener('click', () =>
    perform(() =>
      mutateAiDesign((design) => {
        design.missions.push({ title: `New ${word}`, activities: [] });
      }, proposal.design.missions.length),
    ),
  );
  target.append(addSection);
  updateAiApprovals();
}

$('ai-generate').addEventListener('click', () =>
  perform(async () => {
    const file = $('ai-source').files[0];
    if (!file) throw new Error('Choose a teaching source first.');
    $('ai-save').disabled = true;
    state.aiBusy = true;
    renderWorkflowState();
    $('ai-status').classList.remove('ai-status-error');
    $('ai-status').textContent = 'Extracting material…';
    try {
      const source = await extractFile(file);
      if (source.content.length > 60000)
        throw new Error(
          'This material is too long to generate questions from. Use a shorter file (up to 60,000 characters).',
        );
      $('ai-status').textContent = `Extracted ${source.sections} ${source.sectionLabel}. Generating draft…`;
      const input = {
        aiProvider: $('ai-provider').value,
        aiModel: $('ai-model').value,
        title: $('ai-title').value.trim(),
        subject: $('ai-subject').value.trim(),
        kind: $('ai-kind').value,
        difficulty: $('ai-difficulty').value,
        questionMode: $('ai-question-mode').value,
        programmingLanguage: readGenerationLanguages(),
        ...($('ai-question-mode').value === 'mixed'
          ? { questionTypeCounts: positiveTypeCounts(readQuestionMix()) }
          : {}),
        durationMinutes: Number($('ai-duration').value),
        questionCount: Number($('ai-questions').value),
        missionCount: aiGroupCount(),
        customPrompt: $('ai-custom-prompt').value.trim(),
        source,
      };
      const job = await request('/api/instructor/ai/jobs', { method: 'POST', data: input });
      state.aiInput = input;
      await followAiJob(job);
    } catch (error) {
      $('ai-status').classList.add('ai-status-error');
      $('ai-status').textContent = userErrorMessage(error, 'faculty');
    } finally {
      state.aiBusy = false;
      if (state.aiProposal) updateAiApprovals();
      renderWorkflowState();
    }
  }),
);

$('ai-save').addEventListener('click', () =>
  perform(async () => {
    if (state.aiBusy || $('ai-save').disabled) return;
    if (!state.aiProposal || !state.aiInput) throw new Error('Generate a preview first.');
    state.aiBusy = true;
    renderWorkflowState();
    try {
      const missions = state.aiEditors.flatMap((editor, missionIndex) => {
        const activities = editor.questions.flatMap((question) => {
          if (!question.checkbox.checked) return [];
          const activity = { ...question.activity };
          delete activity.manualRationale;
          return [activity];
        });
        if (!activities.length) return [];
        if (activities.length > 4)
          throw new Error(
            `${groupWord(state.aiInput)} ${missionIndex + 1} can have at most four approved questions.`,
          );
        return [{ ...state.aiProposal.design.missions[missionIndex], activities }];
      });
      if (!missions.length) throw new Error(`Approve at least one ${groupWord(state.aiInput)} and question.`);
      const reviewJobId = state.aiProposalJobId ?? undefined;
      await state.aiSaveQueue.catch(() => {});
      const created = await request('/api/instructor/ai/approved-draft', {
        method: 'POST',
        data: { ...state.aiInput, missions, reviewJobId },
      });
      if (!reviewJobId) await request('/api/instructor/ai/proposal', { method: 'DELETE' }).catch(() => {});
      state.selectedExam = created;
      state.sources = [];
      state.aiProposal = null;
      state.aiJobId = null;
      state.aiProposalJobId = null;
      try { sessionStorage.removeItem('gotit-ai-job'); } catch { /* Optional local hint. */ }
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
  }),
);

function resetClassForm() {
  state.editingClassId = '';
  state.pendingClassRoster = null;
  $('class-form').reset();
  $('class-roster-status').textContent = 'Choose a roster file.';
  renderWorkflowState();
}

function renderClassDetail() {
  const target = $('class-detail');
  if (state.classTable) {
    state.classTable.destroy();
    state.classTable = null;
  }
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
    ['candidateId', 'School ID', 40, true],
    ['displayName', 'Name', 120, true],
    ['gender', 'Gender', 120, false],
    ['yearLevel', 'Year', 120, false],
    ['programShortName', 'Program', 120, false],
  ];
  for (const [key, label, maxLength, required] of columns) {
    const field = node('label', '', label),
      input = node('input');
    input.name = key;
    input.type = 'text';
    input.maxLength = maxLength;
    input.required = required;
    if (key === 'candidateId') input.pattern = '[A-Za-z0-9-]{1,40}';
    field.append(input);
    fields.append(field);
  }
  form.append(fields);
  const formActions = node('div', 'button-row');
  const save = node('button', 'primary', 'Add student');
  save.type = 'submit';
  const cancel = node('button', 'hidden', 'Cancel');
  cancel.type = 'button';
  const resetEditor = () => {
    state.editingStudentId = '';
    form.reset();
    heading.textContent = 'Add student';
    save.textContent = 'Add student';
    cancel.classList.add('hidden');
  };
  cancel.addEventListener('click', resetEditor);
  formActions.append(save, cancel);
  form.append(formActions);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    perform(async () => {
      const student = Object.fromEntries(
        columns.map(([key]) => [key, form.elements.namedItem(key).value.trim()]),
      );
      const originalId = state.editingStudentId;
      save.disabled = true;
      try {
        await request(
          `/api/instructor/classes/${selectedClass.id}/students${originalId ? `/${originalId}` : ''}`,
          { method: originalId ? 'PUT' : 'POST', data: student },
        );
        state.editingStudentId = '';
        await loadClasses();
        message(originalId ? 'Student updated.' : 'Student added.');
      } finally {
        save.disabled = false;
      }
    });
  });
  details.append(form);
  const wrap = node('div', 'table-wrap class-students');
  const table = node('table'),
    head = node('thead'),
    header = node('tr');
  table.className = 'display';
  for (const label of ['School ID', 'Name', 'Gender', 'Year', 'Program', 'Actions'])
    header.append(node('th', '', label));
  head.append(header);
  table.append(head);
  const body = node('tbody');
  for (const student of selectedClass.roster) {
    const row = node('tr');
    for (const value of [
      student.candidateId,
      student.displayName,
      student.gender,
      student.yearLevel,
      student.programShortName,
    ])
      row.append(node('td', '', value || ''));
    const actionCell = node('td');
    const actions = node('div', 'button-row');
    const edit = node('button', '', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => {
      state.editingStudentId = student.candidateId;
      for (const [key] of columns) form.elements.namedItem(key).value = student[key] || '';
      heading.textContent = `Edit ${student.displayName}`;
      save.textContent = 'Save student';
      cancel.classList.remove('hidden');
      details.open = true;
      form.scrollIntoView({ block: 'nearest' });
      form.elements.namedItem('candidateId').focus();
    });
    const remove = node('button', '', 'Delete');
    remove.type = 'button';
    remove.addEventListener('click', () =>
      perform(async () => {
        if (!window.confirm(`Remove ${student.displayName} from ${selectedClass.name}?`)) return;
        await request(`/api/instructor/classes/${selectedClass.id}/students/${student.candidateId}`, {
          method: 'DELETE',
        });
        state.editingStudentId = '';
        await loadClasses();
        message('Student removed.');
      }),
    );
    actions.append(edit, remove);
    actionCell.append(actions);
    row.append(actionCell);
    body.append(row);
  }
  table.append(body);
  wrap.append(table);
  details.append(wrap);
  target.append(details);
  if (typeof window.DataTable === 'function')
    state.classTable = new window.DataTable(table, {
      pageLength: 10,
      lengthMenu: [10, 25, 50, 100],
      columnDefs: [{ targets: 5, orderable: false, searchable: false }],
      language: { emptyTable: 'No students yet. Add one above.' },
    });
  else message('DataTables could not load. Refresh the page.');
}

async function loadClasses() {
  state.classes = await request('/api/instructor/classes');
  if (!state.classes.some((item) => item.id === state.selectedClassId)) state.selectedClassId = '';
  const select = $('run-class');
  clear(select);
  const blank = node('option', '', 'Choose a class');
  blank.value = '';
  select.append(blank);
  for (const item of state.classes) {
    const option = node('option', '', `${item.name} · ${item.section} · ${item.studentCount} students`);
    option.value = item.id;
    select.append(option);
  }
  select.value = state.selectedClassId;
  const list = $('class-library');
  clear(list);
  if (!state.classes.length) list.append(node('p', 'small', 'No classes yet.'));
  for (const item of state.classes) {
    const row = node('div', 'list-row');
    row.classList.toggle('selected', item.id === state.selectedClassId);
    const label = node('div');
    label.append(
      node('strong', '', item.name),
      node('span', '', `${item.section} · ${item.studentCount} students`),
    );
    const actions = node('div', 'button-row');
    const view = node('button', '', item.id === state.selectedClassId ? 'Selected' : 'Select');
    view.type = 'button';
    view.disabled = item.id === state.selectedClassId;
    view.addEventListener('click', () =>
      perform(async () => {
        state.selectedClassId = item.id;
        await loadClasses();
      }),
    );
    const edit = node('button', '', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => {
      state.selectedClassId = item.id;
      state.editingClassId = item.id;
      state.pendingClassRoster = null;
      $('class-name').value = item.name;
      $('class-section').value = item.section;
      $('class-file').value = '';
      $('class-roster-status').textContent = 'Upload a file only to replace this roster.';
      loadClasses().catch((error) => message(userErrorMessage(error, 'faculty'), { persistent: true }));
      $('class-name').focus();
    });
    const remove = node('button', '', 'Delete');
    remove.type = 'button';
    remove.addEventListener('click', () =>
      perform(async () => {
        if (!window.confirm(`Delete ${item.name}? Existing runs keep their student lists.`)) return;
        await request(`/api/instructor/classes/${item.id}`, { method: 'DELETE' });
        if (state.selectedClassId === item.id) state.selectedClassId = '';
        if (state.editingClassId === item.id) resetClassForm();
        await loadClasses();
        message('Class deleted.');
      }),
    );
    actions.append(view, edit, remove);
    row.append(label, actions);
    list.append(row);
  }
  state.classDetail = state.selectedClassId
    ? await request(`/api/instructor/classes/${state.selectedClassId}`)
    : null;
  renderClassDetail();
  renderWorkflowState();
}

function renderActivityLibrary() {
  const term = $('activity-search').value.trim().toLocaleLowerCase();
  const status = $('activity-status').value,
    type = $('activity-type').value;
  const matches = (exam) =>
    (!term || `${exam.title} ${exam.subject || ''}`.toLocaleLowerCase().includes(term)) &&
    (status === 'all' || exam.status === status) &&
    (type === 'all' || kindOf(exam) === type);
  const active = state.exams.filter((exam) => !exam.archivedAt);
  const latest = new Map();
  for (const exam of active)
    if (exam.status === 'published' && !latest.has(exam.examId)) latest.set(exam.examId, exam.version);
  const current = active.filter(
    (exam) => exam.status === 'draft' || exam.version === latest.get(exam.examId),
  );
  const history = state.exams.filter((exam) => !current.includes(exam));
  clear($('exam-library'));
  clear($('exam-history-list'));
  const open = async (exam, destination) => {
    const unsaved = titleChanged() || state.rulesDirty || !!state.questionDirty;
    if (unsaved && !window.confirm('Open this activity and discard unsaved edits to the current activity?'))
      return;
    state.questionDirty = '';
    state.selectedExam = exam;
    state.sources = [];
    invalidateValidation();
    await refreshLibrary();
    await loadSources();
    showStep(destination === 'run' && !state.classes.length ? 'classes' : destination);
  };
  const renderRow = (exam, target) => {
    const row = node('article', 'list-row');
    row.classList.toggle('selected', examKey(exam) === examKey(state.selectedExam));
    const text = node('div', 'library-item-copy');
    text.append(
      node('strong', '', exam.title),
      node('span', '', `${kindLabel(exam)}${difficultyLabel(exam)} · v${exam.version}`),
      node(
        'span',
        `status-badge status-${exam.archivedAt ? 'archived' : exam.status}`,
        exam.archivedAt ? 'Archived draft' : exam.status === 'draft' ? 'Draft' : 'Published',
      ),
    );
    const actions = node('div', 'button-row');
    if (!exam.archivedAt) {
      const view = node('button', '', exam.status === 'draft' ? 'Continue draft' : 'View activity');
      view.type = 'button';
      view.addEventListener('click', () => perform(() => open(exam, 'review')));
      actions.append(view);
      if (exam.status === 'published' && latest.get(exam.examId) === exam.version) {
        const run = node('button', 'primary', 'Assign activity');
        run.type = 'button';
        run.addEventListener('click', () => perform(() => open(exam, 'run')));
        actions.append(run);
      }
    }
    if (!exam.archivedAt) {
      const edit = node('button','','Edit activity'); edit.type='button';
      edit.addEventListener('click',()=>perform(async()=>{
        if (state.questionDirty || state.rulesDirty || titleChanged()) throw new Error('Save or cancel your changes first.');
        let target=exam;
        if(exam.status==='published') {
          if(!window.confirm(`Edit ${exam.title}? An editable copy will be created; existing runs keep their published version.`)) return;
          target=await request(`/api/instructor/assessments/${exam.examId}/${exam.version}/clone`,{method:'POST',data:{}});
        }
        await open(target,'review');
      }));actions.append(edit);
    }
    const remove = node('button','text-button danger-button','Delete activity');remove.type='button';
    remove.addEventListener('click',()=>perform(async()=>{
      if(state.questionDirty || state.rulesDirty || titleChanged()) throw new Error('Save or cancel your changes first.');
      if(!window.confirm(`Delete ${exam.title} (version ${exam.version})? Its runs, submissions and grades will also be permanently deleted. Other versions are kept.`)) return;
      remove.disabled=true;
      try { await request(`/api/instructor/assessments/${exam.examId}/${exam.version}`,{method:'DELETE'});state.selectedExam=null;state.examDetail=null;state.sources=[];await refreshLibrary();showStep('exams');message('Activity version deleted.'); }
      finally {remove.disabled=false;}
    }));actions.append(remove);
    if (exam.status === 'draft') {
      const archive = node('button', 'text-button', exam.archivedAt ? 'Restore' : 'Archive');
      archive.type = 'button';
      archive.addEventListener('click', () =>
        perform(async () => {
          await request(
            `/api/instructor/assessments/${exam.examId}/${exam.version}/${exam.archivedAt ? 'restore' : 'archive'}`,
            { method: 'POST' },
          );
          state.sources = [];
          await refreshLibrary();
          await loadSources();
          message(exam.archivedAt ? 'Draft restored.' : 'Draft archived.');
        }),
      );
      actions.append(archive);
    }
    row.append(text, actions);
    target.append(row);
  };
  const visible = current.filter(matches),
    visibleHistory = history.filter(matches);
  visible.forEach((exam) => renderRow(exam, $('exam-library')));
  if (!visible.length)
    $('exam-library').append(
      node(
        'p',
        'empty-state',
        current.length
          ? 'No activities match these filters. Try another name or clear the filters.'
          : 'Create your first activity to get started.',
      ),
    );
  visibleHistory.forEach((exam) => renderRow(exam, $('exam-history-list')));
  $('activity-match-count').textContent = `${visible.length} of ${current.length} current activities`;
  $('exam-history').hidden = !visibleHistory.length;
  $('exam-history').querySelector('summary').textContent =
    `Older and archived versions (${visibleHistory.length})`;
}

for (const id of ['activity-search', 'activity-status', 'activity-type'])
  $(id).addEventListener(id === 'activity-search' ? 'input' : 'change', renderActivityLibrary);

async function refreshLibrary() {
  if (state.questionDirty) throw new Error('Save or cancel your question changes before refreshing.');
  const exams = await request('/api/instructor/assessments');
  const runs = await request('/api/instructor/runs');
  state.exams = exams;
  state.runs = runs;
  const active = exams.filter((exam) => !exam.archivedAt);
  const latestPublished = new Map();
  for (const exam of active)
    if (exam.status === 'published' && !latestPublished.has(exam.examId))
      latestPublished.set(exam.examId, exam.version);
  const current = active.filter(
    (exam) => exam.status === 'draft' || exam.version === latestPublished.get(exam.examId),
  );
  const history = exams.filter((exam) => !current.includes(exam));
  const previousExam = examKey(state.selectedExam);
  const rememberedExam = sessionStorage.getItem('facultyExamKey');
  state.selectedExam =
    active.find(
      (e) => e.examId === state.selectedExam?.examId && e.version === state.selectedExam?.version,
    ) ||
    current.find((e) => examKey(e) === rememberedExam) ||
    current.find((e) => e.status === 'draft') ||
    current[0] ||
    null;
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
  if (runs.some((run) => run.id === previousRun)) $('results-run').value = previousRun;
  syncRunName();

  if (state.selectedExam) {
    updateRunSelection(state.selectedExam);
    state.examDetail = await request(
      `/api/instructor/assessments/${state.selectedExam.examId}/${state.selectedExam.version}`,
    );
    $('exam-title-input').value = state.examDetail.public.title || '';
    renderExamControls();
  } else {
    state.examDetail = null;
    $('exam-title-input').value = '';
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
  const run = state.runs.find((item) => item.id === runId);
  $('results-run-name').value = run?.name || '';
  const closing=run?.closesAt ? new Date(run.closesAt) : null;
  $('results-run-closes').value=closing ? new Date(closing.getTime()-closing.getTimezoneOffset()*60000).toISOString().slice(0,16) : '';
  $('results-feedback-mode').textContent = run
    ? `${run.feedbackMode === 'graded' ? 'Graded' : 'Practice'} feedback · ${run.shuffleQuestions ? 'Questions shuffled within groups' : 'Question order fixed'}`
    : '';
  $('publish-all-scores').classList.toggle('hidden', run?.feedbackMode !== 'graded');
  $('publish-all-scores').disabled =
    state.results?.runId !== runId || !participationCounts(state.results.rows).readyToPublish;
  renderRunAccess(runId);
}

$('results-run').addEventListener('change', () => {
  if ($('results-run').value) saveSelectedRun($('results-run').value);
  syncRunName();
  state.results = null;
  state.resultsEpoch++;
  state.publicationNotice = null;
  clear($('results-table'));
  clear($('results-summary'));
  $('results-publication-message').textContent = '';
  $('results-status').value = 'all';
  $('results-visibility').value = 'all';
  $('results-search').value = '';
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
  try {
    await navigator.clipboard.writeText(field.value);
    message('Student access details copied.');
  } catch {
    field.focus();
    field.select();
    document.execCommand('copy');
    message('Student access details copied.');
  }
});
$('reset-run-pin').addEventListener('click', () =>
  perform(async () => {
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
  }),
);

for (const id of [
  'exam-title-input',
  'results-run-name',
  'run-name-field',
  'run-pin-field',
  'run-duration-days',
  'ai-title',
  'ai-subject',
  'ai-duration',
  'ai-questions',
  'ai-missions',
  'ai-custom-prompt',
])
  $(id).addEventListener('input', () => {
    renderWorkflowState();
    if (state.aiProposal) updateAiApprovals();
  });
$('source-file').addEventListener('change', renderWorkflowState);
$('ai-programming-language').addEventListener('change', () => {
  if ($('ai-question-mode').value !== 'mixed' && ['frontend', 'php-web'].includes(readGenerationLanguages()))
    $('ai-question-mode').value = 'coding';
});
for (const id of ['run-feedback-mode', 'run-shuffle-questions'])
  $(id).addEventListener('change', renderWorkflowState);
for (const id of ['ai-source', 'ai-kind', 'ai-difficulty', 'ai-question-mode', 'ai-programming-language'])
  $(id).addEventListener('change', () => {
    syncQuestionMix();
    renderWorkflowState();
    if (state.aiProposal) updateAiApprovals();
  });

$('save-run-name').addEventListener('click', () =>
  perform(async () => {
    const runId = $('results-run').value;
    if (!runId) throw new Error('Select a run first.');
    const name = $('results-run-name').value.trim();
    const date=new Date($('results-run-closes').value);
      if(!Number.isFinite(date.getTime()))throw new Error('Choose a valid closing date and time.');
      await request(`/api/instructor/runs/${runId}`, { method: 'PUT', data: { name, ...(() => { const old=new Date(state.runs.find(item=>item.id===runId).closesAt); const local=new Date(old.getTime()-old.getTimezoneOffset()*60000).toISOString().slice(0,16); return $('results-run-closes').value===local ? {} : {closesAt:date.toISOString()}; })() } });
    await refreshLibrary();
    $('results-run').value = runId;
    syncRunName();
    if ($('results-table').childElementCount) await loadResults();
    message('Run changes saved.');
  }),
);

$('save-exam-title').addEventListener('click', () =>
  perform(async () => {
    const e = selected();
    if (e.status !== 'draft') throw new Error('Create an editable copy first.');
    const title = $('exam-title-input').value.trim();
    if (!title || title.length > 120) throw new Error('Enter a name of 1–120 characters.');
    const pub = structuredClone(state.examDetail.public);
    pub.title = title;
    await request(`/api/instructor/assessments/${e.examId}/${e.version}`, {
      method: 'PUT',
      data: { public: pub, private: state.examDetail.private },
    });
    invalidateValidation();
    await refreshLibrary();
    message('Name saved.');
  }),
);

function updateRunSelection(exam) {
  $('run-exam-label').textContent = `${exam.title || exam.examId} · v${exam.version}`;
}

function policyFields(policy, editable) {
  const wrap = node('div', 'policy-fields');
  const definitions = [
    ['maxRetries', 'Extra submissions allowed after the first · leave blank for no limit', 99],
    ['pointPenalty', 'Points deducted for each extra submission', state.examDetail.public.settings.coreMaxPoints],
    ['timePenaltySeconds', 'Seconds deducted for each extra submission', state.examDetail.public.settings.durationMinutes * 60],
  ];
  const inputs = {};
  for (const [key, labelText, max] of definitions) {
    const label = node('label', '', labelText);
    const input = node('input');
    input.type = 'number';
    input.min = '0';
    input.max = String(max);
    input.step = '1';
    input.required = key !== 'maxRetries';
    input.dataset.policyKey = key;
    input.value = policy?.[key] ?? (key === 'maxRetries' ? '' : '0');
    input.disabled = !editable;
    label.append(input);
    wrap.append(label);
    inputs[key] = input;
  }
  return {
    element: wrap,
    inputs,
    set(value) {
      for (const key of Object.keys(inputs))
        inputs[key].value = value[key] ?? (key === 'maxRetries' ? '' : '0');
    },
    disable(value) {
      for (const input of Object.values(inputs)) input.disabled = value;
    },
    read() {
      const maxRetries = inputs.maxRetries.value === '' ? null : Number(inputs.maxRetries.value);
      const pointPenalty = Number(inputs.pointPenalty.value);
      const timePenaltySeconds = Number(inputs.timePenaltySeconds.value);
      const values = { maxRetries, pointPenalty, timePenaltySeconds };
      if (
        (maxRetries !== null && (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 99)) ||
        !Number.isInteger(pointPenalty) ||
        pointPenalty < 0 ||
        pointPenalty > state.examDetail.public.settings.coreMaxPoints ||
        !Number.isInteger(timePenaltySeconds) ||
        timePenaltySeconds < 0 ||
        timePenaltySeconds > Number(state.durationInput.value) * 60
      )
        throw new Error('Retry rules need valid whole numbers within the activity limits.');
      return values;
    },
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
  durationInput.type = 'number';
  durationInput.min = '1';
  durationInput.max = '1440';
  durationInput.required = true;
  durationInput.value = String(exam.settings.durationMinutes);
  durationInput.disabled = !editable;
  durationLabel.append(durationInput);
  $('policy-editor').append(durationLabel);
  state.durationInput = durationInput;
  const references = node('fieldset', 'stack');
  references.id = 'reference-guide-picker';
  references.append(
    node('legend', '', 'Student reference guides'),
    node(
      'p',
      'small',
      'Choose which guides students can search during this assessment. Leave all unchecked to disable references.',
    ),
  );
  const guideChoices = node('div', 'reference-guide-choices');
  references.append(guideChoices);
  for (const topic of referenceTopics) {
    const label = node('label', 'ai-approval'),
      checkbox = node('input');
    checkbox.type = 'checkbox';
    checkbox.value = topic.id;
    checkbox.dataset.referenceGuide = topic.id;
    checkbox.checked = (exam.settings.referenceGuides || []).includes(topic.id);
    checkbox.disabled = !editable;
    label.append(checkbox, node('span', '', topic.label));
    guideChoices.append(label);
  }
  const preview = node('details', 'reference-preview');
  preview.append(node('summary', '', 'Preview selected guides'));
  const previewContent = node('div', 'reference-results');
  preview.append(previewContent);
  references.append(preview);
  let guideContent;
  const showReferencePreview = async () => {
    if (!preview.open) return;
    try {
      guideContent ||= (await request('/api/instructor/reference-guides')).guides;
      const ids = [...references.querySelectorAll('[data-reference-guide]:checked')].map(
        (input) => input.value,
      );
      if (!ids.length) previewContent.textContent = 'Select at least one reference guide to preview it.';
      else
        renderReferenceResults(
          previewContent,
          guideContent.filter((guide) => ids.includes(guide.id)),
        );
    } catch (error) {
      previewContent.textContent = userErrorMessage(error, 'faculty');
    }
  };
  preview.addEventListener('toggle', showReferencePreview);
  references.addEventListener('change', showReferencePreview);
  $('policy-editor').append(references);

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
      inherit.type = 'checkbox';
      inherit.checked = !activity.retryPolicy;
      inherit.disabled = !editable;
      inheritLabel.append(inherit, node('span', '', `Use ${groupWord(state.selectedExam)} rule`));
      const fields = policyFields(activity.retryPolicy ?? mission.retryPolicy, editable && !inherit.checked);
      question.append(inheritLabel, fields.element);
      inherit.addEventListener('change', () => {
        if (inherit.checked) fields.set(missionFields.read());
        fields.disable(!editable || inherit.checked);
      });
      for (const input of Object.values(missionFields.inputs))
        input.addEventListener('input', () => {
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

$('clone-package').addEventListener('click', () =>
  perform(async () => {
    const exam = selected();
    const copy = await request(`/api/instructor/assessments/${exam.examId}/${exam.version}/clone`, {
      method: 'POST',
      data: {},
    });
    state.selectedExam = copy;
    state.sources = [];
    invalidateValidation();
    await refreshLibrary();
    await loadSources();
    showStep('exams');
    $('exam-title-input').focus();
    message(`Editable version ${copy.version} created. You can change its name here.`);
  }),
);

$('save-policies').addEventListener('click', () =>
  perform(async () => {
    const selectedVersion = selected();
    if (selectedVersion.status !== 'draft') throw new Error('Create an editable copy first.');
    const pub = structuredClone(state.examDetail.public);
    const duration = Number(state.durationInput.value);
    if (!Number.isInteger(duration) || duration < 1 || duration > 1440)
      throw new Error('Duration must be 1–1440 minutes.');
    pub.settings.durationMinutes = duration;
    pub.settings.referenceGuides = [
      ...$('reference-guide-picker').querySelectorAll('[data-reference-guide]:checked'),
    ].map((input) => input.value);
    for (const entry of state.policyEditors) {
      const mission = pub.missions.find((item) => item.id === entry.missionId);
      mission.retryPolicy = entry.missionFields.read();
      for (const question of entry.questions) {
        const activity = mission.activities.find((item) => item.id === question.activityId);
        if (question.inherit.checked) delete activity.retryPolicy;
        else activity.retryPolicy = question.fields.read();
      }
    }
    await request(`/api/instructor/assessments/${selectedVersion.examId}/${selectedVersion.version}`, {
      method: 'PUT',
      data: { public: pub, private: state.examDetail.private },
    });
    invalidateValidation();
    await refreshLibrary();
    showStep('review');
    message('Rules saved. We are checking the questions and scoring.');
  }),
);

for (const id of ['class-name', 'class-section']) $(id).addEventListener('input', renderWorkflowState);
let rosterRead = 0;
$('class-file').addEventListener('change', async () => {
  const read = ++rosterRead;
  const file = $('class-file').files[0];
  state.pendingClassRoster = null;
  $('class-roster-status').textContent = file
    ? 'Reading roster…'
    : state.editingClassId
      ? 'Current roster remains.'
      : 'Choose a roster file.';
  if (!file) {
    renderWorkflowState();
    return;
  }
  try {
    const text = await file.text();
    if (read !== rosterRead || $('class-file').files[0] !== file) return;
    const roster = parseRoster(text, file.name, $('class-section').value);
    state.pendingClassRoster = roster;
    $('class-section').value = roster[0].section;
    if (!$('class-name').value.trim()) $('class-name').value = roster[0].section;
    $('class-roster-status').textContent = `${roster.length} students ready from ${file.name}.`;
  } catch (error) {
    if (read !== rosterRead || $('class-file').files[0] !== file) return;
    $('class-roster-status').textContent = userErrorMessage(error, 'faculty');
  }
  renderWorkflowState();
});
$('class-section').addEventListener('change', () => {
  if ($('class-file').files.length) $('class-file').dispatchEvent(new Event('change'));
});
$('class-cancel').addEventListener('click', resetClassForm);
$('class-form').addEventListener('submit', (event) => {
  event.preventDefault();
  perform(async () => {
    if (state.classBusy || $('class-save').disabled) return;
    state.classBusy = true;
    renderWorkflowState();
    try {
      const data = {
        name: $('class-name').value.trim(),
        section: $('class-section').value.trim(),
        ...(state.pendingClassRoster ? { roster: state.pendingClassRoster } : {}),
      };
      const editing = state.editingClassId;
      const saved = await request(
        editing ? `/api/instructor/classes/${editing}` : '/api/instructor/classes',
        { method: editing ? 'PUT' : 'POST', data },
      );
      state.selectedClassId = saved.id;
      resetClassForm();
      await loadClasses();
      message(editing ? 'Class updated.' : 'Class added.');
    } finally {
      state.classBusy = false;
      renderWorkflowState();
    }
  });
});
$('run-class').addEventListener('change', () => {
  state.selectedClassId = $('run-class').value;
  loadClasses().catch((error) => message(userErrorMessage(error, 'faculty'), { persistent: true }));
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
  const source = state.sources.find((x) => x.id === $('source-select').value);
  $('source-preview').textContent = source?.content || 'No source selected.';
  const cov = source?.coverage || { topic: '', learningOutcome: '', proposedActivityType: '', evidence: '' };
  $('cov-topic').value = cov.topic || '';
  $('cov-outcome').value = cov.learningOutcome || '';
  $('cov-type').value = cov.proposedActivityType || '';
  $('cov-evidence').value = cov.evidence || '';
  renderWorkflowState();
}

$('source-select').addEventListener('change', displaySource);
$('load-sources').addEventListener('click', () => perform(loadSources));

for (const id of ['cov-topic', 'cov-outcome', 'cov-type', 'cov-evidence'])
  $(id).addEventListener('input', renderWorkflowState);

$('upload-source').addEventListener('click', () =>
  perform(async () => {
    const e = selected(),
      file = $('source-file').files[0];
    if (!file) throw new Error('Choose a source file.');
    const source = await extractFile(file);
    await request(`/api/instructor/assessments/${e.examId}/${e.version}/sources`, {
      method: 'POST',
      data: { filename: source.filename, content: source.content },
    });
    $('source-file').value = '';
    invalidateValidation();
    message(`Source added: ${source.sections} ${source.sectionLabel}. Coverage notes are optional.`);
    await loadSources();
  }),
);

$('save-coverage').addEventListener('click', () =>
  perform(async () => {
    const e = selected(),
      sourceId = $('source-select').value;
    if (!sourceId) throw new Error('Select a source first.');
    const cov = {
      topic: $('cov-topic').value.trim(),
      learningOutcome: $('cov-outcome').value.trim(),
      proposedActivityType: $('cov-type').value.trim(),
      evidence: $('cov-evidence').value.trim(),
    };
    if (Object.values(cov).some((value) => !value)) throw new Error('Complete all four coverage fields.');
    await request(`/api/instructor/assessments/${e.examId}/${e.version}/sources/${sourceId}`, {
      method: 'PUT',
      data: cov,
    });
    invalidateValidation();
    await loadSources();
    $('source-select').value = sourceId;
    displaySource();
    showStep('review');
    message('Teaching notes saved. We are checking the questions and scoring.');
  }),
);

async function validateCurrentDraft() {
  const exam = state.selectedExam;
  if (!exam || exam.status !== 'draft' || !state.examDetail || state.validationBusy) return;
  const epoch = state.validationEpoch,
    key = examKey(exam);
  state.validationBusy = true;
  $('validation-output').textContent = 'Checking questions and scoring…';
  renderWorkflowState();
  try {
    const result = await request(`/api/instructor/assessments/${exam.examId}/${exam.version}/validate`, {
      method: 'POST',
      data: {},
    });
    if (epoch !== state.validationEpoch || key !== examKey(state.selectedExam)) return;
    state.validationErrors = result.errors;
    state.validatedKey = result.errors.length ? null : key;
    $('validation-output').textContent = result.errors.length
      ? result.errors.map((item) => `• ${questionIssueText(item)}`).join('\n')
      : 'The question format and point totals are correct. Check the answers and teaching material before selecting Publish activity.';
    renderReview();
  } catch (error) {
    if (epoch === state.validationEpoch) {
      state.validationErrors = [error.message];
      $('validation-output').textContent = `(VALIDATION ERROR: ${userErrorMessage(error, 'faculty')})`;
    }
  } finally {
    state.validationBusy = false;
    renderWorkflowState();
  }
}

$('validate-package').addEventListener('click', () => perform(validateCurrentDraft));
$('review-edit-rules').addEventListener('click', () => showStep('rules'));
$('ai-check').addEventListener('click', () =>
  perform(async () => {
    const e = selected();
    const epoch = state.validationEpoch;
    const previous = state.aiSourceChecks ?? [];
    const activityIds = previous.filter(check => check.checked === false).map(check => check.activityId);
    const target = $('ai-check-results');
    state.aiSourceChecking = true;
    $('ai-check').disabled = true;
    let checks;
    try {
      checks = await request(`/api/instructor/ai/check/${e.examId}/${e.version}`, {
        method: 'POST',
        data: activityIds.length ? { activityIds } : {},
      });
    } finally {
      state.aiSourceChecking = false;
      renderWorkflowState();
    }
    if (state.validationEpoch !== epoch) return;
    if (activityIds.length) {
      const updated = new Map(checks.map(check => [check.activityId, check]));
      checks = previous.map(check => updated.get(check.activityId) ?? check);
    }
    state.aiSourceChecks = checks;
    clear(target);
    const scores = checks.map((check) => check.matchPercent).filter((score) => score !== null);
    const remaining = checks.length - scores.length;
    $('ai-check').textContent = remaining ? `Continue source review (${remaining})` : 'Compare with teaching material';
    const average =
      scores.length === checks.length && scores.length
        ? `${Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)}%`
        : `${scores.length} of ${checks.length} checked`;
    target.append(
      node('p', 'ai-score', `Source support · ${average} (AI estimate).`),
    );
    for (const check of checks) {
      const item = node('details', 'ai-question');
      item.append(
        node(
          'summary',
          '',
          `${check.matchPercent === null ? 'Unscored' : `${check.matchPercent}%`} · ${check.prompt.split('```')[0].trim().slice(0, 100) || 'Code question'}`,
        ),
      );
      item.append(renderPrompt(check.prompt));
      if (check.reason) item.append(node('p', '', check.reason));
      if (check.quote) item.append(node('blockquote', '', check.quote));
      target.append(item);
    }
  }),
);

function renderReview() {
  if (state.questionDirty) return;
  if (!state.examDetail) return;
  const exam = state.examDetail.public,
    grading = state.examDetail.private;
  const paperActivities = (exam.missions || []).flatMap((mission) => mission.activities || []);
  const pointsInput = $('paper-total-points');
  const versionKey = examKey(state.selectedExam);
  if (pointsInput.dataset.versionKey !== versionKey) {
    pointsInput.dataset.versionKey = versionKey;
    pointsInput.min = String(Math.max(1, paperActivities.length));
    pointsInput.value = String(
      paperActivities.reduce((sum, activity) => sum + (Number(activity.maxPoints) || 0), 0),
    );
  }
  const target = $('draft-preview');
  clear(target);
  const rules = $('review-rules-summary');
  clear(rules);
  const policies = (exam.missions || []).map((mission) => mission.retryPolicy || {});
  const uniform = policies.every((policy) => JSON.stringify(policy) === JSON.stringify(policies[0]));
  const first = policies[0] || {};
  rules.append(
    node('strong', '', `${exam.settings.durationMinutes} minutes`),
    node(
      'span',
      '',
      uniform && first.maxRetries !== undefined
        ? ` · ${retryPolicyText(first).replace('You can', 'Students can')}`
        : ' · Submission limits vary by question. Check the rules below.',
    ),
  );
  const selectedGuides = referenceTopics.filter((topic) => exam.settings.referenceGuides?.includes(topic.id));
  rules.append(
    node(
      'p',
      'small',
      selectedGuides.length
        ? 'Reference guides: ' + selectedGuides.map((topic) => topic.label).join(', ')
        : 'Reference guides: none',
    ),
  );
  const evidence = grading.evidence || [];
  for (const [missionIndex, mission] of (exam.missions || []).entries()) {
    const section = node('section', 'review-mission');
    section.append(node('h2', '', mission.title || mission.id));
    if (mission.story) section.append(node('p', 'small', mission.story));
    for (const activity of mission.activities ?? []) {
      const card = node('article', 'review-question');
      card.append(renderPrompt(activity.prompt, 'ai-prompt'));
      if (activity.type === 'code_writing') appendCodeExamples(card, activity.publicConfig);
      if (activity.type === 'web_project') appendExpectedOutput(card, activity.publicConfig);
      const choices = activity.publicConfig?.options || activity.publicConfig?.items;
      if (Array.isArray(choices) && choices.length) {
        const list = node('ol', 'ai-options');
        for (const choice of choices) list.append(node('li', '', choice.label || String(choice)));
        card.append(list);
      }
      const rule = grading.rules?.[activity.gradingRuleId];
      card.append(
        node(
          'p',
          'ai-answer',
          rule?.criteria?.every((item) => item.answer.kind === 'manual')
            ? 'Grading guide for faculty'
            : 'Correct answer',
        ),
        node('pre', 'answer-value', rule ? answerText(activity, rule) : 'No grading rule.'),
      );
      if (state.selectedExam?.status === 'draft' && rule) {
        const saveDraftQuestion = async (changes) => {
          const e = selected();
          await request(
            '/api/instructor/assessments/' + e.examId + '/' + e.version + '/questions/' + activity.id,
            {
              method: 'PUT',
              data: { ...changes, revision: state.examDetail.revision },
            },
          );
          state.questionDirty = '';
          invalidateValidation();
          await refreshLibrary();
          await loadSources();
          showStep('review');
        };
        const pointsForm = node('form', 'button-row');
        const pointsLabel = node('label', '', 'Question points');
        const pointsInput = node('input');
        pointsInput.type = 'number';
        pointsInput.min = String(rule.criteria.length);
        pointsInput.max = '10000';
        pointsInput.required = true;
        pointsInput.value = activity.maxPoints;
        pointsLabel.append(pointsInput);
        const savePoints = node('button', '', 'Save points');
        savePoints.type = 'submit';
        savePoints.disabled = true;
        pointsInput.addEventListener('input', () => {
          savePoints.disabled = pointsInput.valueAsNumber === activity.maxPoints;
        });
        pointsForm.addEventListener('submit', (event) => {
          event.preventDefault();
          perform(async () => {
            if (state.questionDirty) throw new Error('Save or cancel the current question changes first.');
            const points = pointsInput.valueAsNumber;
            state.questionDirty = activity.id;
            pointsInput.disabled = savePoints.disabled = true;
            savePoints.textContent = 'Saving points…';
            target.inert = true;
            renderWorkflowState();
            try {
              await saveDraftQuestion({ points });
              message(`Question points saved. This question is worth ${points} ${points === 1 ? 'point' : 'points'}.`);
            } finally {
              target.inert = false;
              pointsInput.disabled = savePoints.disabled = false;
              savePoints.textContent = 'Save points';
              if (state.questionDirty === activity.id) {
                state.questionDirty = '';
                renderWorkflowState();
              }
            }
          });
        });
        pointsForm.append(pointsLabel, savePoints);
        card.append(pointsForm);
        const model = editableQuestion(activity, rule);
        const editor = questionEditor(
          model,
          async (question) => {
            await saveDraftQuestion({ question });
            message('Question saved. Review the updated problem and grading reference.');
          },
          {
            saved: true,
            id: activity.id,
            points: activity.maxPoints,
            changed: (details) => {
              state.questionDirty = activity.id;
              for (const other of document.querySelectorAll('#draft-preview .ai-evidence'))
                if (other !== details) other.open = false;
              renderWorkflowState();
            },
            cancel: () => {
              state.questionDirty = '';
              renderReview();
              renderWorkflowState();
            },
          },
        );
        card.append(editor);
      } else card.append(node('p', 'small', `${activity.maxPoints} ${activity.maxPoints === 1 ? 'point' : 'points'}`));
      const proof = evidence.find((item) => item.activityId === activity.id);
      const refs = activity.sourceRefs || [];
      if (proof?.quote || refs.length || activity.manualRationale) {
        const source = node('details', 'ai-evidence');
        source.append(node('summary', '', 'Source evidence'));
        for (const ref of refs) source.append(node('p', 'small', `${ref.file} · ${ref.pageOrSlide}`));
        if (proof?.quote) source.append(node('blockquote', '', proof.quote));
        if (activity.manualRationale) source.append(node('p', 'small', activity.manualRationale));
        card.append(source);
      }
      const issues = state.validationErrors.filter(
        (issue) =>
          issue.includes(activity.id) ||
          issue.includes(mission.id) ||
          issue.includes(`Mission ${missionIndex + 1}`),
      );
      for (const issue of issues) card.append(node('p', 'ai-issue', `(VALIDATION ERROR: ${questionIssueText(issue)})`));
      section.append(card);
    }
    target.append(section);
  }
}

function openPrintCopy(includeAnswers) {
  const detail = state.examDetail;
  if (!detail?.public) {
    message('Select an activity first.');
    return;
  }
  const paperActivities = (detail.public.missions || []).flatMap((mission) => mission.activities || []);
  const totalPoints = Number($('paper-total-points').value);
  if (
    !Number.isInteger(totalPoints) ||
    totalPoints < Math.max(1, paperActivities.length) ||
    totalPoints > 10000
  ) {
    message(`Enter a whole number from ${Math.max(1, paperActivities.length)} to 10,000 points.`);
    $('paper-total-points').focus();
    return;
  }
  const questionPoints = distributePaperPoints(paperActivities, totalPoints);
  const pointsByActivity = new Map(
    paperActivities.map((activity, index) => [activity.id, questionPoints[index]]),
  );
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    message('Allow the print window, then try again.');
    return;
  }
  printWindow.opener = null;
  const doc = printWindow.document;
  doc.documentElement.lang = 'en';
  const title = `${detail.public.title || detail.public.examId} · ${includeAnswers ? 'Faculty answer key' : 'Paper backup'}`;
  doc.title = title;
  doc.head.replaceChildren();
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  const viewport = doc.createElement('meta');
  viewport.name = 'viewport';
  viewport.content = 'width=device-width, initial-scale=1';
  const stylesheet = doc.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('/print.css', window.location.href).href;
  doc.head.append(charset, viewport, stylesheet);
  const root = doc.createElement('main');
  const preparing = doc.createElement('p');
  preparing.className = 'print-preparing';
  preparing.textContent = 'Preparing print layout…';
  root.append(preparing);
  const heading = doc.createElement('h1');
  heading.textContent = title;
  root.append(heading);
  const meta = doc.createElement('p');
  meta.textContent = `${detail.public.subject || ''}${detail.public.settings?.durationMinutes ? ` · ${detail.public.settings.durationMinutes} minutes` : ''} · ${totalPoints} points`;
  root.append(meta);
  if (includeAnswers) {
    const notice = doc.createElement('p');
    notice.className = 'faculty-only';
    notice.textContent = 'FACULTY COPY · Contains correct answers. Keep separate from student copies.';
    root.append(notice);
  } else {
    const identity = doc.createElement('div');
    identity.className = 'paper-meta';
    for (const labelText of ['Student name', 'School ID', 'Section']) {
      const field = doc.createElement('div');
      field.className = 'paper-meta-field';
      const caption = doc.createElement('span');
      caption.className = 'paper-meta-label';
      caption.textContent = labelText;
      const line = doc.createElement('span');
      line.className = 'paper-line';
      field.append(caption, line);
      identity.append(field);
    }
    root.append(identity);
  }
  let questionNumber = 0;
  for (const mission of detail.public.missions || []) {
    const group = doc.createElement('section');
    const groupTitle = doc.createElement('h2');
    groupTitle.textContent = mission.title || mission.id;
    group.append(groupTitle);
    if (mission.story) {
      const story = doc.createElement('p');
      story.textContent = mission.story;
      group.append(story);
    }
    for (const activity of mission.activities || []) {
      questionNumber++;
      const card = doc.createElement('article');
      card.className = 'paper-question';
      const questionHeading = doc.createElement('div');
      questionHeading.className = 'question-title';
      const number = doc.createElement('span');
      number.textContent = `Question ${questionNumber}`;
      const points = doc.createElement('span');
      points.textContent = `${pointsByActivity.get(activity.id) ?? 0} pts`;
      questionHeading.append(number, points);
      card.append(questionHeading);
      card.append(renderPrompt(activity.prompt));
      const config = activity.publicConfig || {};
      if (!includeAnswers) appendPaperInput(doc, card, activity, config);
      if (includeAnswers) {
        const rule = detail.private?.rules?.[activity.gradingRuleId];
        const answerLabel = doc.createElement('h3');
        answerLabel.textContent = 'Correct answer';
        card.append(answerLabel);
        const answer = doc.createElement('pre');
        answer.className = 'answer';
        answer.textContent = rule ? answerText(activity, rule) : 'No grading rule found.';
        card.append(answer);
      }
      group.append(card);
    }
    root.append(group);
  }
  doc.body.replaceChildren(root);
  printWindow.focus();
  const cssReady = new Promise((resolve) => {
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
    window.setTimeout(() => {
      try {
        printWindow.print();
      } catch {
        /* print can be opened from this tab */
      }
    }, 150);
  })();
}

$('print-student-copy').addEventListener('click', () => openPrintCopy(false));
$('print-answer-key').addEventListener('click', () => openPrintCopy(true));

$('publish-package').addEventListener('click', () =>
  perform(async () => {
    const e = selected();
    if (state.publishBusy || state.rulesDirty || titleChanged() || state.validatedKey !== examKey(e)) return;
    if (!window.confirm(`Publish ${e.title} v${e.version}? Published versions cannot be edited.`)) return;
    state.publishBusy = true;
    renderWorkflowState();
    try {
      await request(`/api/instructor/assessments/${e.examId}/${e.version}/publish`, {
        method: 'POST',
        data: { approved: true },
      });
      invalidateValidation();
      message('Activity version published and locked.');
      await refreshLibrary();
      showStep(state.classes.length ? 'run' : 'classes');
    } finally {
      state.publishBusy = false;
      renderWorkflowState();
    }
  }),
);

$('create-run').addEventListener('click', () =>
  perform(async () => {
    const exam = selected();
    if (state.runBusy) return;
    const classId = $('run-class').value;
    if (!state.classes.some((item) => item.id === classId)) throw new Error('Choose a saved class first.');
    const days = Number($('run-duration-days').value);
    if (!Number.isInteger(days) || days < 1 || days > 365)
      throw new Error('Enter a joining window from 1 to 365 days.');
    const payload = {
      examId: exam.examId,
      version: exam.version,
      name: $('run-name-field').value.trim(),
      pin: $('run-pin-field').value,
      feedbackMode: $('run-feedback-mode').value,
      shuffleQuestions: $('run-shuffle-questions').checked,
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + days * 86400_000).toISOString(),
      classId,
    };
    state.runBusy = true;
    renderWorkflowState();
    try {
      const result = await request('/api/instructor/runs', { method: 'POST', data: payload });
      $('created-run').textContent =
        `${result.name} created for ${result.className} · ${result.rosterCount} students · ${result.feedbackMode === 'graded' ? 'Graded' : 'Practice'} feedback${result.shuffleQuestions ? ' · Questions shuffled' : ''}.`;
      const studentUrl = new URL('/app/student', window.location.href);
      studentUrl.searchParams.set('run', result.id);
      const linkLabel = ['localhost', '127.0.0.1'].includes(studentUrl.hostname)
        ? 'Student activity (this computer only)'
        : 'Student activity';
      $('run-access-text').value =
        `${linkLabel}: ${studentUrl.href}\nActivity code: ${result.id}\nActivity PIN: ${payload.pin}\nSign in with your School ID from the class roster.`;
      const accessSaved = saveRunAccess(result.id, { url: studentUrl.href, pin: payload.pin });
      $('run-access').classList.remove('hidden');
      message(
        accessSaved
          ? 'Class activity created.'
          : 'The class activity was created. This browser could not save a copy of the access details. Copy them now before leaving this page.',
      );
      await refreshLibrary();
      $('results-run').value = result.id;
      saveSelectedRun(result.id);
      syncRunName();
    } finally {
      state.runBusy = false;
      renderWorkflowState();
    }
  }),
);

$('load-results').addEventListener('click', () => perform(loadResults));
$('retry-grading').addEventListener('click', () =>
  perform(async () => {
    const runId = $('results-run').value;
    if (!runId) return;
    const result = await request(`/api/instructor/runs/${runId}/retry-grading`, { method: 'POST' });
    message(result.retried ? `Processing restarted for ${result.retried} interrupted ${result.retried === 1 ? 'submission' : 'submissions'}. Refresh results to check progress.` : 'There are no interrupted submissions to retry.');
    await loadResults();
  }),
);
$('publish-all-scores').addEventListener('click', () =>
  perform(async () => {
    const runId = $('results-run').value;
    if (!runId) throw new Error('Select a run.');
    if (
      !window.confirm(
        'Publish scores for every student who has completed this run? Students still in progress will keep their scores hidden.',
      )
    )
      return;
    const button = $('publish-all-scores');
    button.disabled = true;
    try {
      const result = await request(`/api/instructor/runs/${runId}/publish-scores`, { method: 'POST' });
      const latest = await loadResults();
      const stillHidden = latest.rows.filter(
        (row) => row.sessionId && !row.resultsReleased && ['submitted', 'expired'].includes(row.status),
      ).length;
      if (stillHidden)
        throw new Error('We could not confirm that students can see the scores. Refresh results before trying again.');
      publicationMessage(
        `Published ${result.publishedCount} completed ${result.publishedCount === 1 ? 'score' : 'scores'}. These students can now view their results.`,
        runId,
      );
    } catch (error) {
      button.disabled = false;
      throw error;
    }
  }),
);

async function loadProctorAccess() {
  const runId = $('results-run').value;
  $('proctor-access').classList.toggle('hidden', !runId);
  if (!runId) return;
  const access = await request(`/api/instructor/runs/${runId}/proctor-access`);
  if ($('results-run').value !== runId) return;
  const ended = Date.now() >= Date.parse(access.closesAt);
  $('proctor-access-status').textContent = ended
    ? 'This class activity has ended.'
    : access.enabled
      ? 'The proctor can sign in to monitor student progress. Create a new code if the old code was lost.'
      : 'Create a separate sign-in code for the proctor who will monitor this activity.';
  $('issue-proctor').textContent = access.enabled ? 'Replace access code' : 'Create access code';
  $('issue-proctor').disabled = ended || state.proctorBusy;
  $('revoke-proctor').classList.toggle('hidden', !access.issuedAt);
  $('revoke-proctor').disabled = state.proctorBusy;
}

$('issue-proctor').addEventListener('click', () =>
  perform(async () => {
    const runId = $('results-run').value;
    if (!runId || state.proctorBusy) return;
    const code = $('proctor-code-field').value.trim();
    if (code.length < 8 || code.length > 100)
      throw new Error('Choose a proctor code from 8 to 100 characters.');
    if (
      $('issue-proctor').textContent === 'Replace access code' &&
      !window.confirm('Replace this code? Signed-in proctors will lose access.')
    )
      return;
    state.proctorBusy = true;
    $('issue-proctor').disabled = true;
    $('revoke-proctor').disabled = true;
    try {
      const access = await request(`/api/instructor/runs/${runId}/proctor-access`, {
        method: 'POST',
        data: { code },
      });
      $('proctor-code-field').value = '';
      await loadProctorAccess();
      if ($('results-run').value !== runId) return;
      const url = new URL('/app/proctor', window.location.href);
      url.searchParams.set('run', runId);
      $('proctor-share-text').value =
        `Proctor view: ${url.href}\nActivity code: ${runId}\nProctor code: ${access.code}`;
      $('proctor-share').classList.remove('hidden');
      message('Proctor access code created. Copy it now; it will not be shown again.');
    } finally {
      state.proctorBusy = false;
      await loadProctorAccess();
    }
  }),
);

$('revoke-proctor').addEventListener('click', () =>
  perform(async () => {
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
    } finally {
      state.proctorBusy = false;
      await loadProctorAccess();
    }
  }),
);

$('copy-proctor').addEventListener('click', async () => {
  const field = $('proctor-share-text');
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(field.value);
    message('Proctor access details copied.');
  } catch {
    field.focus();
    field.select();
    message('Copy the selected details.');
  }
});

function responseText(question, submission) {
  if (!submission) return 'No answer submitted';
  const value = submission.value,
    config = question.publicConfig || {};
  const option = (id) => config.options?.find((item) => item.id === id)?.label ?? String(id);
  if (question.type === 'web_project' && value?.files)
    return (
      Object.entries(value.files)
        .map(([name, source]) => `--- ${name} ---\n${source}`)
        .join('\n\n') + (value.database ? '\n\nA saved copy of the project database is included.' : '')
    );
  if (question.type === 'single_choice') return option(value);
  if (question.type === 'multiple_choice')
    return Array.isArray(value) ? value.map(option).join(', ') : String(value);
  if (question.type === 'true_false') return value ? 'True' : 'False';
  if (question.type === 'numeric_entry') return `${value}${submission.unit ? ` ${submission.unit}` : ''}`;
  if (question.type === 'matching')
    return Object.entries(value || {})
      .map(([left, right]) => {
        const leftLabel = config.left?.find((item) => item.id === left)?.label ?? left;
        const rightLabel = config.right?.find((item) => item.id === right)?.label ?? right;
        return `${leftLabel}: ${rightLabel}`;
      })
      .join('\n');
  if (question.type === 'sequencing')
    return Array.isArray(value)
      ? value.map((id) => config.items?.find((item) => item.id === id)?.label ?? id).join(' → ')
      : String(value);
  if (question.type === 'data_inspection' && value && typeof value === 'object')
    return [
      `Rows per page: ${value.pageLength}`,
      `Page: ${(value.pageIndex ?? 0) + 1}`,
      `Search: ${value.globalSearch || '(none)'}`,
      `Column filters: ${
        Object.entries(value.columnSearch || {})
          .map(([key, term]) => `${key} = ${term}`)
          .join(', ') || '(none)'
      }`,
      `Order: ${(Array.isArray(value.order) ? value.order.filter((item) => item && typeof item === 'object') : []).map((item) => `${item.column} ${item.direction}`).join(', ') || '(none)'}`,
    ].join('\n');
  return typeof value === 'string' ? value : JSON.stringify(value);
}

const gradeDrafts = new Map();
function renderStudentReview(review) {
  if ($('results-run').value !== review.runId) return;
  $('student-review').classList.remove('hidden');
  $('results-table').before($('student-review'));
  $('student-review').querySelector('.review-navigation')?.remove();
  const reviewNavigation = node('div', 'button-row review-navigation');
  const reviewable = filterResultRows(state.results?.rows || [], {
    search: $('results-search').value,
    status: $('results-status').value,
    visibility: $('results-visibility').value,
  }).filter((row) => row.sessionId);
  const reviewIndex = reviewable.findIndex((row) => row.candidateId === review.candidateId);
  for (const [offset, label] of [
    [-1, 'Previous student'],
    [1, 'Next student'],
  ]) {
    const next = reviewIndex < 0 ? null : reviewable[reviewIndex + offset];
    const button = node('button', '', label);
    button.type = 'button';
    button.disabled = !next;
    button.addEventListener('click', () =>
      perform(async () => {
        const updated = await request(
          `/api/instructor/runs/${review.runId}/students/${encodeURIComponent(next.candidateId)}`,
        );
        renderStudentReview(updated);
        $('student-review').scrollIntoView({ block: 'start' });
      }),
    );
    reviewNavigation.append(button);
  }
  $('student-review').querySelector('.review-header').append(reviewNavigation);
  $('student-review-title').textContent = `Student answers · ${review.displayName}`;
  $('student-review-summary').textContent =
    `${review.candidateId} · ${attemptLabels[review.status] || review.status} · ${review.questions.some((q) => q.attempts.at(-1)?.result === 'pending_review' && !q.override) ? 'Awaiting grade' : `${review.score} / ${review.maxPoints} pts`}${review.canOverride ? '' : ' · Scores can be adjusted after the attempt ends.'}`;
  const target = $('student-review-questions');
  clear(target);
  if (!review.questions.length) {
    target.append(node('p', 'small', 'This student has not started or submitted an answer yet.'));
    return;
  }
  let previousMission = null;
  review.questions.forEach((question, index) => {
    if (question.missionId !== previousMission) {
      target.append(node('h3', 'review-group-title', question.missionTitle));
      previousMission = question.missionId;
    }
    const card = node('article', 'student-answer-card');
    const heading = node('div', 'review-header');
    heading.append(
      node('h4', '', `Question ${index + 1}`),
      node(
        'strong',
        '',
        question.attempts.at(-1)?.result === 'pending_review' && !question.override
          ? 'Awaiting grade'
          : `${question.effectivePoints} / ${question.maxPoints} pts`,
      ),
    );
    card.append(heading, renderPrompt(question.prompt));
    const latest = question.attempts.at(-1);
    card.append(
      node(
        'p',
        'small',
        `Student answer · ${question.attempts.length} submission${question.attempts.length === 1 ? '' : 's'}`,
      ),
      node('pre', 'answer-value', responseText(question, latest?.response)),
      node(
        'p',
        'small',
        ['code_writing', 'web_project'].includes(question.type) ? 'Grading reference' : 'Correct answer',
      ),
      node('pre', 'answer-value', question.expectedAnswer),
    );
    if (['code_writing', 'web_project'].includes(question.type)) {
      const label = [...card.children].find(
        (e) => e.tagName === 'P' && e.textContent === 'Grading reference',
      );
      if (label) {
        const reference = node('details', 'grading-reference');
        const content = label.nextElementSibling;
        label.replaceWith(reference);
        reference.append(node('summary', '', 'Grading reference'), content);
      }
    }
    if (latest)
      card.append(
        node(
          'p',
          'small',
          latest.result === 'pending_review'
            ? 'This answer needs a grade from faculty.'
            : `Last automatic check: ${latest.result.replaceAll('_', ' ')} · Automatic score: ${question.automaticPoints} pts`,
        ),
      );
    if (question.override)
      card.append(
        node('p', 'small', `Grade saved by faculty: ${question.override.points} pts · ${question.override.reason}`),
      );
    if (question.attempts.length > 1) {
      const history = node('details', 'answer-history');
      history.append(node('summary', '', `Previous submissions (${question.attempts.length - 1})`));
      for (const attempt of question.attempts.slice(0, -1)) {
        history.append(
          node(
            'p',
            'small',
            `${new Date(attempt.at).toLocaleString()} · ${attempt.result.replaceAll('_', ' ')}`,
          ),
          node('pre', 'answer-value', responseText(question, attempt.response)),
        );
      }
      card.append(history);
    }
    if (review.canOverride) {
      const adjust = node('details', 'score-adjust');
      adjust.open = latest?.result === 'pending_review' && !question.override;
      adjust.append(node('summary', '', question.override ? 'Edit grade' : 'Grade submission'));
      const form = node('form', 'score-adjust-form');
      const pointsLabel = node('label', '', 'Points');
      const points = node('input');
      points.type = 'number';
      points.min = '0';
      points.max = String(question.maxPoints);
      points.step = '1';
      points.required = true;
      points.value = String(question.override?.points ?? Math.max(0, question.automaticPoints));
      pointsLabel.append(points);
      const reasonLabel = node('label', '', 'Reason (optional)');
      const reason = node('textarea');
      reason.rows = 2;
      reason.maxLength = 300;
      reason.value = question.override?.reason ?? '';
      const draftKey = JSON.stringify([review.runId, review.candidateId, question.id]);
      const baseline = { points: points.value, reason: reason.value };
      const retained = gradeDrafts.get(draftKey);
      if (retained) { points.value = retained.points; reason.value = retained.reason; }
      const draftStatus = node('p', 'small');
      draftStatus.setAttribute('role', 'status');
      const retainGrade = () => {
        const value = { points: points.value, reason: reason.value };
        if (JSON.stringify(value) === JSON.stringify(baseline)) gradeDrafts.delete(draftKey);
        else gradeDrafts.set(draftKey, value);
        draftStatus.textContent = gradeDrafts.has(draftKey) ? 'Unsaved grade · kept while you review other students. Select Save score to record it.' : '';
      };
      points.addEventListener('input', retainGrade);
      reason.addEventListener('input', retainGrade);
      retainGrade();
      reasonLabel.append(reason);
      const actions = node('div', 'button-row');
      const save = node('button', 'primary', 'Save score');
      save.type = 'submit';
      actions.append(save);
      if (question.override) {
        const reset = node(
          'button',
          '',
          ['code_writing', 'web_project'].includes(question.type)
            ? 'Clear faculty grade'
            : 'Use automatic score',
        );
        reset.type = 'button';
        reset.addEventListener('click', () =>
          perform(async () => {
            reset.disabled = true;
            try {
              const updated = await request(
                `/api/instructor/runs/${review.runId}/students/${encodeURIComponent(review.candidateId)}/scores/${encodeURIComponent(question.id)}`,
                { method: 'DELETE' },
              );
              renderStudentReview(updated);
              await loadResults();
              message('Automatic score restored.');
            } finally {
              reset.disabled = false;
            }
          }),
        );
        actions.append(reset);
      }
      const aiCheck = node('button', '', 'Check answer with AI'); aiCheck.type = 'button';
      const aiNote = node('p', 'small', 'Optional: sends this question, grading reference and submitted answer to the configured AI provider. AI reviews the submitted content without running code. Review its suggestion before applying.');
      const aiFeedback = node('div', 'ai-grading-feedback'); aiFeedback.setAttribute('role','status');
      aiCheck.addEventListener('click', () => perform(async () => {
        aiCheck.disabled = true; aiCheck.textContent = 'Checking answer...'; aiFeedback.replaceChildren();
        try {
          const suggestion = await request(`/api/instructor/runs/${review.runId}/students/${encodeURIComponent(review.candidateId)}/scores/${encodeURIComponent(question.id)}/ai-check`, {method:'POST'});
          const explanation = node('p', '', `Suggested score: ${suggestion.points} / ${question.maxPoints}. ${suggestion.feedback}`);
          const apply = node('button', '', 'Use suggestion in grading form'); apply.type = 'button';
          apply.addEventListener('click', () => { points.value = String(suggestion.points); reason.value = ('AI-assisted: ' + suggestion.feedback).slice(0,300); retainGrade(); points.focus(); });
          aiFeedback.append(explanation, apply, node('p','small','This has not changed the saved score. Edit the points or reason, then select Save score.'));
        } catch (error) { aiFeedback.textContent = userErrorMessage(error, 'faculty'); }
        finally { aiCheck.disabled = false; aiCheck.textContent = 'Check answer with AI'; }
      }));
      form.append(aiNote, aiCheck, aiFeedback);
      form.append(pointsLabel, reasonLabel, draftStatus, actions);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        perform(async () => {
          save.disabled = true;
          const savingDraft = JSON.stringify({ points: points.value, reason: reason.value });
          try {
            const updated = await request(
              `/api/instructor/runs/${review.runId}/students/${encodeURIComponent(review.candidateId)}/scores/${encodeURIComponent(question.id)}`,
              {
                method: 'PUT',
                data: { points: Number(points.value), reason: reason.value.trim() },
              },
            );
            if (JSON.stringify(gradeDrafts.get(draftKey)) === savingDraft) gradeDrafts.delete(draftKey);
            renderStudentReview(updated);
            await loadResults();
            message('Score saved.');
          } finally {
            save.disabled = false;
          }
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
    clear($('results-summary'));
    clear($('results-table'));
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
      clear($('results-table'));
      clear($('results-summary'));
      $('results-table').append(
        node('p', 'inline-error', 'Results could not be loaded. Select Refresh results to try again.'),
      );
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
  const summary = $('results-summary');
  clear(summary);
  for (const [key, label] of [...Object.entries(attemptLabels), ['hidden', 'Scores hidden']]) {
    const card = node('button', 'summary-stat');
    card.type = 'button';
    card.dataset.status = key;
    card.append(node('strong', '', counts[key]), node('span', '', label));
    card.setAttribute(
      'aria-pressed',
      String(
        key === 'hidden'
          ? $('results-visibility').value === 'hidden'
          : $('results-status').value === key && $('results-visibility').value === 'all',
      ),
    );
    card.addEventListener('click', () => {
      const active = card.getAttribute('aria-pressed') === 'true';
      $('results-status').value = !active && key !== 'hidden' ? key : 'all';
      $('results-visibility').value = !active && key === 'hidden' ? 'hidden' : 'all';
      renderResults();
      $('results-summary').querySelector(`[data-status="${key}"]`)?.focus();
    });
    summary.append(card);
  }
  $('results-filters').classList.remove('hidden');
  const publishAll = $('publish-all-scores');
  publishAll.classList.toggle('hidden', result.feedbackMode !== 'graded');
  publishAll.textContent = counts.readyToPublish ? `Publish ${counts.readyToPublish} ${counts.readyToPublish === 1 ? 'score' : 'scores'}` : 'Publish scores';
  publishAll.disabled = !counts.readyToPublish;
  $('results-publication-message').textContent =
    state.publicationNotice?.runId === runId
      ? state.publicationNotice.text
      : result.feedbackMode === 'practice'
        ? 'Practice activity: students see automatically graded scores immediately. Answers graded by faculty must be checked first.'
        : counts.readyToPublish
          ? `${counts.readyToPublish} ${counts.readyToPublish === 1 ? 'student has' : 'students have'} finished. You can share ${counts.readyToPublish === 1 ? 'their score' : 'their scores'} now.`
          : result.rows.some((row) => row.pendingReview)
            ? 'Some answers need your grade. Open Review answers, grade them and save before sharing scores.'
            : counts.hidden
              ? 'Students cannot see scores until they finish and you select Publish score.'
              : 'There are no finished students with scores waiting to be shared.';
  const target = $('results-table');
  clear(target);
  const rows = filterResultRows(result.rows, {
    search: $('results-search').value,
    status: $('results-status').value,
    visibility: $('results-visibility').value,
  });
  target.append(
    node(
      'p',
      'small',
      `${rows.length} of ${result.rows.length} students${result.className ? ` · ${result.className}` : ''} · Maximum ${result.maxPoints} points`,
    ),
  );
  const wrap = node('div', 'table-wrap results-table-wrap');
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', 'Student results. Scroll horizontally for more columns.');
  const table = node('table', 'results-data-table');
  const caption = node('caption', 'sr-only', `${result.name} · ${result.title} v${result.version}`);
  table.append(caption);
  const head = node('thead'),
    tr = node('tr');
  for (const label of ['Student', 'Section', 'Attempt', 'Score', 'Score visibility', 'Actions']) {
    const th = node('th', '', label);
    th.scope = 'col';
    tr.append(th);
  }
  head.append(tr);
  table.append(head);
  const tbody = node('tbody');
  for (const row of rows) {
    const line = node('tr');
    const identity = node('th', 'student-identity');
    identity.scope = 'row';
    identity.append(node('strong', '', row.displayName), node('small', '', row.candidateId));
    const attempt = node('td');
    attempt.append(
      node('span', `status-badge status-${row.status}`, attemptLabels[row.status] || row.status),
    );
    if (row.finalizationPending)
      attempt.append(node('p', 'small', 'This student’s final submission is still being processed. Refresh the results shortly. If it stays unfinished, ask your technical administrator for help.'));
    if (row.failedCodingCount)
      attempt.append(node('p', 'small', 'Some answers could not be processed. Select Retry interrupted grading in Activity settings. If it fails again, ask your technical administrator for help.'));
    line.append(
      identity,
      node('td', '', row.section),
      attempt,
      node(
        'td',
        'score-cell',
        row.pendingReview ? 'Awaiting grade' : row.sessionId ? `${row.score} / ${result.maxPoints}` : '—',
      ),
    );
    const releaseCell = node('td');
    const visible = !!row.sessionId && row.resultsReleased;
    releaseCell.append(
      node(
        'span',
        `status-badge ${visible ? 'status-published' : ''}`,
        !row.sessionId ? 'No attempt' : visible ? 'Visible to student' : 'Hidden',
      ),
    );
    if (
      row.sessionId &&
      !row.resultsReleased &&
      !row.finalizationPending &&
      !row.pendingCoding &&
      !row.pendingReview &&
      ['submitted', 'expired'].includes(row.status)
    ) {
      const publish = node('button', 'text-button', 'Publish score');
      publish.type = 'button';
      publish.setAttribute('aria-label', `Publish score for ${row.displayName}`);
      publish.addEventListener('click', () =>
        perform(async () => {
          publish.disabled = true;
          publish.textContent = 'Publishing score…';
          try {
            await request(
              `/api/instructor/runs/${runId}/students/${encodeURIComponent(row.candidateId)}/publish-scores`,
              { method: 'POST' },
            );
            const latest = await loadResults();
            if (!latest.rows.find((item) => item.candidateId === row.candidateId)?.resultsReleased)
              throw new Error('We could not confirm that the student can see this score. Refresh results before trying again.');
            publicationMessage(
              `Score published for ${row.displayName}. It is now visible to this student.`,
              runId,
            );
          } catch (error) {
            publish.disabled = false;
            publish.textContent = 'Publish score';
            throw error;
          }
        }),
      );
      releaseCell.append(publish);
    }
    line.append(releaseCell);
    const actionCell = node('td', 'result-row-actions');
    const reviewButton = node('button', '', 'Review answers');
    reviewButton.type = 'button';
    reviewButton.disabled = !row.sessionId;
    reviewButton.setAttribute('aria-label', `Review answers for ${row.displayName}`);
    reviewButton.addEventListener('click', () =>
      perform(async () => {
        const review = await request(
          `/api/instructor/runs/${runId}/students/${encodeURIComponent(row.candidateId)}`,
        );
        if ($('results-run').value !== runId) return;
        renderStudentReview(review);
        $('student-review').scrollIntoView({ block: 'start' });
      }),
    );
    actionCell.append(reviewButton);
    const runOpen = Date.now() < Date.parse(result.closesAt);
    const canExtend = row.sessionId && runOpen && ['in_progress', 'expired'].includes(row.status);
    const canReopen = row.sessionId && runOpen && ['submitted', 'expired'].includes(row.status);
    if (canExtend || canReopen) {
      const details = node('details', 'student-recovery row-more');
      const more = node('summary', '', 'More');
      more.setAttribute('aria-label', `More actions for ${row.displayName}`);
      details.append(more);
      const addForm = (action, label) => {
        const form = node('form', 'recovery-form');
        const minutesLabel = node('label', '', 'Minutes');
        const minutes = node('input');
        minutes.type = 'number';
        minutes.min = '1';
        minutes.max = '120';
        minutes.value = '5';
        minutes.required = true;
        minutesLabel.append(minutes);
        const reasonLabel = node('label', '', 'Reason');
        const reason = node('input');
        reason.type = 'text';
        reason.minLength = 3;
        reason.maxLength = 300;
        reason.placeholder = 'Brief incident note';
        reason.required = true;
        reasonLabel.append(reason);
        const button = node('button', '', label);
        button.type = 'submit';
        form.append(minutesLabel, reasonLabel, button);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          perform(async () => {
            button.disabled = true;
            try {
              const updated = await request(
                `/api/instructor/runs/${runId}/students/${encodeURIComponent(row.candidateId)}/${action}`,
                {
                  method: 'POST',
                  data: { minutes: Number(minutes.value), reason: reason.value.trim() },
                },
              );
              details.open = false;
              renderStudentReview(updated);
              $('student-review').scrollIntoView({ block: 'start' });
              await loadResults();
              message(`${label} complete.`);
            } finally {
              button.disabled = false;
            }
          });
        });
        details.append(form);
      };
      if (canExtend) addForm('extend', 'Add time');
      if (canReopen) addForm('reopen', 'Reopen attempt');

      actionCell.append(details);
    }
    line.append(actionCell);
    tbody.append(line);
  }
  if (!rows.length) {
    const row = node('tr'),
      cell = node(
        'td',
        'empty-state',
        result.rows.length ? 'No students match these filters.' : 'No students in this run.',
      );
    cell.colSpan = 6;
    row.append(cell);
    tbody.append(row);
  }
  table.append(tbody);
  wrap.append(table);
  target.append(wrap);
}

for (const id of ['results-search', 'results-status', 'results-visibility'])
  $(id).addEventListener(id === 'results-search' ? 'input' : 'change', renderResults);

$('export-results').addEventListener('click', () =>
  perform(async () => {
    const runId = $('results-run').value;
    if (!runId) throw new Error('Select a run.');
    const blob = await request(`/api/instructor/runs/${runId}/export.csv`, { raw: true });
    const url = URL.createObjectURL(blob);
    const link = node('a');
    link.href = url;
    link.download = `gradebook-${runId.slice(0, 8)}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }),
);

await perform(loadConfig);
try {
  await request('/api/instructor/session', { silent: true });
  state.instructorAuthenticated = true;
} catch {
  /* Sign in to start a new faculty session. */
}
showInstructor();

window.addEventListener('beforeunload', (event) => {
  if (gradeDrafts.size || state.questionDirty || state.rulesDirty || titleChanged()) {
    event.preventDefault();
    event.returnValue = '';
  }
});

window.addEventListener('popstate', () =>
  showStep(new URL(location.href).searchParams.get('workspace') || 'exams'),
);
