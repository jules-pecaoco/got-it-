import { parseTableCode } from './table-code.js';
import { parseRoster } from './roster-import.js';
import { answerText } from './answer-key.js';
import { renderPrompt } from './prompt-code.js';
import { beginRequestStatus } from './request-status.js';
import { icon } from './icons.js';

const $ = id => document.getElementById(id);
const workflowIcons = { exams: 'activity', rules: 'rules', sources: 'source', review: 'review', classes: 'people', run: 'run', results: 'results' };
for (const button of document.querySelectorAll('[data-step-link]')) button.prepend(icon(workflowIcons[button.dataset.stepLink]));
const state = {
  instructorToken: sessionStorage.getItem('instructorToken'),
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
  aiSaveQueue: Promise.resolve()
};

const node = (tag, className, content) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = String(content);
  return element;
};
const clear = element => element.replaceChildren();

const message = text => {
  const box = $('notice');
  box.textContent = text;
  if (text) window.setTimeout(() => { if (box.textContent === text) box.textContent = ''; }, 7000);
};

function requestLabel(path, method) {
  if (path.endsWith('/materials/extract')) return 'Extracting teaching material…';
  if (path.endsWith('/ai/propose') || path.endsWith('/ai/generate')) return 'Generating questions…';
  if (path.endsWith('/ai/approved-draft') || path.endsWith('/ai/draft')) return 'Saving activity draft…';
  if (path.includes('/ai/check/')) return 'Checking source support…';
  if (path.endsWith('/ai/inspect') || path.includes('/validate')) return 'Checking activity…';
  if (path.endsWith('/publish')) return 'Publishing activity…';
  if (path === '/api/instructor/runs' && method === 'POST') return 'Creating run…';
  if (path.endsWith('/results')) return 'Loading results…';
  if (path.endsWith('/export.csv')) return 'Preparing grade export…';
  if (path.endsWith('/extend') || path.endsWith('/reopen')) return 'Updating student attempt…';
  if (path.includes('/scores/')) return 'Saving score…';
  if (path.includes('/proctor-access')) return method === 'GET' ? 'Loading proctor access…' : 'Updating proctor access…';
  if (path.includes('/sources')) return method === 'GET' ? 'Loading teaching material…' : 'Saving source notes…';
  if (path.includes('/classes')) return method === 'GET' ? 'Loading classes…' : 'Saving class…';
  if (path.includes('/students/')) return 'Loading student answers…';
  if (path === '/api/instructor/assessments' && method === 'GET') return 'Loading activities…';
  if (path.includes('/assessments/')) return method === 'GET' ? 'Loading activity…' : 'Saving activity…';
  return method === 'GET' ? 'Loading Faculty Studio…' : 'Saving changes…';
}

async function request(path, { method = 'GET', data, raw = false, silent = false } = {}) {
  const finishStatus = silent ? () => {} : beginRequestStatus(requestLabel(path, method));
  const headers = {};
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  if (state.instructorToken) headers.Authorization = `Bearer ${state.instructorToken}`;
  try {
    const response = await fetch(path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
    if (raw && response.ok) return await response.blob();
    const result = await response.json();
    if (!response.ok) throw new Error(`${result.message} (${result.code})`);
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
  if (step === 'results') return state.runs.length > 0;
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
  if (state.libraryReady) {
    renderWorkflowState();
    if (step === 'review') {
      renderReview();
      if (state.selectedExam?.status === 'draft' && !state.validatedKey && !state.validationBusy)
        perform(validateCurrentDraft);
    }
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
  $('selected-exam-title').textContent = state.step === 'exams' && state.activityMode === 'create'
    ? 'New activity' : exam?.title || 'Select an activity';
  $('step-exams-title').textContent = state.activityMode === 'create' ? 'Create activity' : 'Activities';
  $('selected-exam-meta').textContent = state.step === 'exams' && state.activityMode === 'create'
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
    : !Number.isInteger(days) || days < 1 ? 'Enter a valid admission window.' : '';
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
    : state.step === 'run' ? runIssue || 'Ready to create a run.' : 'Choose a run to view results.';
  $('exam-title-input').disabled = !draft;
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
  else if (!Number.isInteger(aiMissions) || aiMissions < 1 || aiMissions > 5) generateHelp = 'Set 1–5 missions.';
  else if (isCtf && aiQuestions < aiMissions) generateHelp = `You set ${aiMissions} missions, so choose at least ${aiMissions} questions (one per mission).`;
  else if (isCtf && aiQuestions > aiMissions * 4) generateHelp = `${aiMissions} missions can contain up to ${aiMissions * 4} questions total.`;
  $('ai-generate').disabled = !!generateHelp;
  $('ai-generate-help').textContent = generateHelp || 'Ready to generate preview.';
  if (state.aiProposal && !aiConfigMatches()) $('ai-save').disabled = true;
  if (state.aiBusy) $('ai-save').disabled = true;
  $('ai-save-row').classList.toggle('hidden', !state.aiProposal);
  $('ai-discard').classList.toggle('hidden', !state.aiProposal);
}

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
  const hasToken = !!state.instructorToken;
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
        state.instructorToken = null;
        sessionStorage.removeItem('instructorToken');
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
    const result = await request('/api/instructor/login', {
      method: 'POST',
      data: { password: $('instructor-password').value }
    });
    state.instructorToken = result.token;
    sessionStorage.setItem('instructorToken', result.token);
    $('instructor-password').value = '';
    showInstructor();
    message('Faculty session authenticated.');
  });
});

$('instructor-logout').addEventListener('click', () => {
  state.instructorToken = null;
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
  sessionStorage.removeItem('instructorToken');
  showStep('exams');
  showInstructor();
});

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
    'ai-missions': saved.input.missionCount, 'ai-custom-prompt': saved.input.customPrompt || ''
  })) $(id).value = String(value ?? '');
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
  for (const value of ['single_choice', 'multiple_choice', 'true_false', 'text_entry', 'numeric_entry', 'sequencing']) {
    const option = node('option', '', value.replaceAll('_', ' ')); option.value = value; type.input.append(option);
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
  const sync = () => {
    const value = type.input.value;
    options.label.hidden = !['single_choice', 'multiple_choice', 'sequencing'].includes(value);
    options.input.required = !options.label.hidden;
    answer.label.hidden = ['true_false', 'numeric_entry'].includes(value);
    answer.input.required = !answer.label.hidden;
    truth.label.hidden = value !== 'true_false';
    for (const item of [numericValue, tolerance, unit]) {
      item.label.hidden = value !== 'numeric_entry';
      item.input.required = value === 'numeric_entry';
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
  const count = `${approvedMissions} ${word}${approvedMissions === 1 ? '' : 's'} · ${approvedQuestions} question${approvedQuestions === 1 ? '' : 's'} approved`;
  const average = selectedScores.length === approvedQuestions && selectedScores.length
    ? ` · ${Math.round(selectedScores.reduce((sum, score) => sum + score, 0) / selectedScores.length)}% source match (AI estimate)` : '';
  $('ai-selection').textContent = !state.aiProposal ? '' : overLimit ? `${count}. Limit: 4 questions per ${word}.`
    : approvedMissions > 5 ? `${count}. Limit: 5 ${word}s.`
      : count + average;
  const setupMatches = aiConfigMatches();
  if (state.aiProposal && !setupMatches)
    $('ai-selection').textContent = `Setup changed. Generate a new preview before saving. ${count}${average}.`;
  $('ai-save').disabled = !approvedQuestions || overLimit || approvedMissions > 5 || !setupMatches;
}

function renderAiPreview(proposal, selected = new Set(), openMissionIndex = 0) {
  const target = $('ai-preview');
  clear(target);
  state.aiEditors = [];
  target.append(node('h2', '', 'Review questions'));
  target.append(node('p', 'ai-score', `Source match: ${proposal.sourceMatchPercent === null ? 'unavailable' : `${proposal.sourceMatchPercent}%`} · AI estimate`));
  target.append(node('p', 'small', 'Review the questions and answers. You decide what to approve.'));
  const word = groupWord(state.aiInput);
  if (proposal.missions.length !== state.aiInput.missionCount)
    target.append(node('p', 'ai-issue', `AI returned ${proposal.missions.length} ${word}s; you requested ${state.aiInput.missionCount}.`));
  const generatedQuestions = proposal.missions.reduce((total, group) => total + group.questions.length, 0);
  if (generatedQuestions !== state.aiInput.questionCount)
    target.append(node('p', 'ai-issue', `AI returned ${generatedQuestions} questions; you requested ${state.aiInput.questionCount}.`));
  for (const [missionIndex, rawMission] of (Array.isArray(proposal.design?.missions) ? proposal.design.missions : []).entries()) {
    const mission = rawMission && typeof rawMission === 'object' ? rawMission : {};
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
    if (mission.story) section.append(node('p', 'small', mission.story));
    const editor = { mission: missionCheckbox, summary, heading, questions: [] };
    for (const [questionIndex, rawActivity] of (Array.isArray(mission.activities) ? mission.activities : []).entries()) {
      const activity = rawActivity && typeof rawActivity === 'object' ? rawActivity : {};
      const result = inspection.questions[questionIndex];
      const card = node('div', 'ai-question');
      const questionApproval = node('label', 'ai-approval');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      const eligible = result.ready;
      checkbox.disabled = !eligible;
      checkbox.checked = eligible && selected.has(`${missionIndex}:${questionIndex}`);
      questionApproval.append(checkbox, node('span', '', `Approve question ${questionIndex + 1}`));
      card.append(questionApproval);
      card.append(node('p', 'small', String(activity.type || 'Unknown type').replaceAll('_', ' ')));
      card.append(renderPrompt(activity.prompt || 'No question prompt', 'ai-prompt'));
      if (Array.isArray(activity.options)) {
        const options = node('ol', 'ai-options');
        for (const option of activity.options) options.append(node('li', '', option));
        card.append(options);
      }
      card.append(node('p', 'ai-answer', `Correct answer: ${answerPreview(activity.answer)}`));
      card.append(node('p', 'ai-score', `Source match: ${result.sourceMatchPercent === null ? 'unavailable' : `${result.sourceMatchPercent}%`}`));
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
        const nextDesign = structuredClone(state.aiProposal.design);
        nextDesign.missions[missionIndex].activities[questionIndex] = edited;
        const next = await request('/api/instructor/ai/inspect', { method: 'POST',
          data: { ...state.aiInput, design: nextDesign } });
        state.aiProposal = next;
        renderAiPreview(next, new Set(selectedAiQuestions()), missionIndex);
        queueAiWorkSave();
        message('Question updated. Check its format and answer before approval.');
      }));
      editor.questions.push({ checkbox, eligible, ready: result.ready, sourceMatchPercent: result.sourceMatchPercent, activity });
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

async function refreshLibrary() {
  const exams = await request('/api/instructor/assessments');
  const runs = await request('/api/instructor/runs');
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
  clear($('exam-library'));
  clear($('exam-history-list'));

  const renderRow = (e, target) => {
    const row = node('div', 'list-row');
    row.classList.toggle('selected', state.selectedExam?.examId === e.examId && state.selectedExam?.version === e.version);
    const text = node('div');
    text.append(node('strong', '', e.title), node('span', '', `${kindLabel(e)}${difficultyLabel(e)} · v${e.version} · ${e.archivedAt ? 'archived draft' : e.status}`));
    const actions = node('div', 'button-row');
    if (!e.archivedAt) {
      const select = node('button', '', examKey(e) === examKey(state.selectedExam) ? 'Selected' : 'Select');
      select.type = 'button';
      select.disabled = examKey(e) === examKey(state.selectedExam);
      select.addEventListener('click', () => perform(async () => {
        state.selectedExam = e;
        state.sources = [];
        invalidateValidation();
        await refreshLibrary();
        await loadSources();
      }));
      actions.append(select);
    }
    if (e.status === 'draft') {
      const toggle = node('button', '', e.archivedAt ? 'Restore' : 'Archive');
      toggle.type = 'button';
      toggle.addEventListener('click', () => perform(async () => {
        await request(`/api/instructor/assessments/${e.examId}/${e.version}/${e.archivedAt ? 'restore' : 'archive'}`, { method: 'POST' });
        state.sources = [];
        await refreshLibrary();
        await loadSources();
        message(e.archivedAt ? 'Draft restored.' : 'Draft archived.');
      }));
      actions.append(toggle);
    }
    row.append(text, actions);
    target.append(row);
  };
  for (const e of current) renderRow(e, $('exam-library'));
  if (!current.length) $('exam-library').append(node('p', 'small', 'No current activities.'));
  for (const e of history) renderRow(e, $('exam-history-list'));
  $('exam-history').hidden = history.length === 0;
  $('exam-history').querySelector('summary').textContent = `Older and archived versions (${history.length})`;

  const previousRun = $('results-run').value;
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
}

function syncRunName() {
  const run = state.runs.find(item => item.id === $('results-run').value);
  $('results-run-name').value = run?.name || '';
  $('results-feedback-mode').textContent = run
    ? `${run.feedbackMode === 'graded' ? 'Graded' : 'Practice'} feedback · ${run.shuffleQuestions ? 'Questions shuffled within groups' : 'Question order fixed'}` : '';
}

$('results-run').addEventListener('change', () => {
  syncRunName();
  clear($('results-table'));
  $('student-review').classList.add('hidden');
  clear($('student-review-questions'));
  $('proctor-share-text').value = '';
  $('proctor-share').classList.add('hidden');
  perform(loadProctorAccess);
  renderWorkflowState();
});

for (const id of ['exam-title-input', 'results-run-name', 'package-json', 'new-package-json', 'run-name-field', 'run-pin-field', 'run-duration-days',
  'ai-title', 'ai-subject', 'ai-duration', 'ai-questions', 'ai-missions', 'ai-custom-prompt'])
  $(id).addEventListener('input', () => { renderWorkflowState(); if (state.aiProposal) updateAiApprovals(); });
$('source-file').addEventListener('change', renderWorkflowState);
for (const id of ['ai-source', 'ai-kind', 'ai-difficulty'])
  $(id).addEventListener('change', () => { renderWorkflowState(); if (state.aiProposal) updateAiApprovals(); });

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

function distributePaperPoints(activities, totalPoints) {
  if (!activities.length) return [];
  const weights = activities.map(activity => Math.max(0, Number(activity.maxPoints) || 0));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0) || activities.length;
  const shares = weights.map((weight, index) => {
    const exact = totalPoints * (weightTotal === activities.length && weights.every(value => value === 0) ? 1 : weight) / weightTotal;
    return { points: Math.max(1, Math.floor(exact)), remainder: exact - Math.floor(exact), index };
  });
  let difference = totalPoints - shares.reduce((sum, share) => sum + share.points, 0);
  if (difference > 0) {
    const order = [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (let i = 0; i < difference; i++) order[i % order.length].points++;
  } else if (difference < 0) {
    const order = [...shares].sort((a, b) => a.remainder - b.remainder || b.index - a.index);
    while (difference < 0) {
      const share = order.find(item => item.points > 1);
      if (!share) break;
      share.points--;
      difference++;
    }
  }
  return shares.map(share => share.points);
}

function appendPaperInput(doc, card, activity, config) {
  const paragraph = (text, className = '') => {
    const p = doc.createElement('p'); p.className = className; p.textContent = text; card.append(p); return p;
  };
  const table = (columns, rows, className = 'paper-dataset') => {
    const wrap = doc.createElement('div'); wrap.className = className;
    const tableEl = doc.createElement('table');
    const head = doc.createElement('thead'), headRow = doc.createElement('tr');
    for (const column of columns) { const th = doc.createElement('th'); th.textContent = column.label; headRow.append(th); }
    head.append(headRow); tableEl.append(head);
    const body = doc.createElement('tbody');
    for (const row of rows) {
      const tr = doc.createElement('tr');
      for (const column of columns) { const td = doc.createElement('td'); td.textContent = String(row[column.id] ?? ''); tr.append(td); }
      body.append(tr);
    }
    tableEl.append(body); wrap.append(tableEl); card.append(wrap);
  };
  const lines = count => {
    const area = doc.createElement('div'); area.className = 'paper-response';
    for (let i = 0; i < count; i++) { const line = doc.createElement('div'); line.className = 'write-line'; area.append(line); }
    card.append(area);
  };
  if (activity.type === 'single_choice' || activity.type === 'multiple_choice' || activity.type === 'true_false') {
    const choices = activity.type === 'true_false' ? [{ label: 'True' }, { label: 'False' }] : config.options || [];
    const list = doc.createElement('ol'); list.className = 'paper-options';
    for (const choice of choices) { const item = doc.createElement('li'); item.textContent = `☐ ${choice.label}`; list.append(item); }
    card.append(list);
  } else if (activity.type === 'matching') {
    paragraph(`Match each item to one choice: ${(config.right || []).map(item => item.label).join(' · ')}`);
    for (const item of config.left || []) paragraph(`${item.label}  __________________________________________`);
  } else if (activity.type === 'sequencing') {
    paragraph(`Put these steps in order: ${(config.items || []).map(item => item.label).join(' · ')}`);
    for (let i = 0; i < (config.items || []).length; i++) paragraph(`Step ${i + 1}: __________________________________________`);
  } else if (activity.type === 'data_inspection' || activity.type === 'datatable_code') {
    if (config.columns?.length && config.rows?.length) {
      if (activity.type === 'datatable_code') {
        table([{ id: 'index', label: 'Column index' }, { id: 'label', label: 'Field' }],
          config.columns.map((column, index) => ({ index, label: column.label })), 'paper-dataset');
      }
      table(config.columns, config.rows);
    }
    if (activity.type === 'datatable_code') {
      if (config.scaffold) {
        paragraph('Code scaffold');
        const scaffold = doc.createElement('pre'); scaffold.textContent = config.scaffold; card.append(scaffold);
      }
      if (config.apiReference?.length) paragraph(`Reference: ${config.apiReference.map(item => `${item.api} — ${item.use}`).join(' · ')}`);
      paragraph('Write your completed code below.');
      const area = doc.createElement('div'); area.className = 'paper-response';
      for (let i = 0; i < 14; i++) { const line = doc.createElement('div'); line.className = 'write-line code-line'; area.append(line); }
      card.append(area);
    } else {
      const requestedRows = Number(/show\s+(\d+)\s+rows per page/i.exec(activity.prompt || '')?.[1]) || 5;
      const blankRows = Math.min(8, Math.max(1, requestedRows));
      paragraph('Table settings');
      paragraph('Rows per page: ______   Page: ______   Search: __________________   Column filter: __________________');
      paragraph('Primary order: __________________   Secondary order: __________________');
      table(config.columns, Array.from({ length: blankRows }, () => ({})), 'paper-blank-table');
    }
  } else {
    paragraph(activity.type === 'numeric_entry' ? 'Answer and unit:' : 'Answer:');
    lines(activity.type === 'text_entry' ? 2 : 3);
  }
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
  if (!Number.isInteger(days) || days < 1) throw new Error('Enter the number of days the run stays open.');
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
    $('run-access').classList.remove('hidden');
    message('Run created.');
    await refreshLibrary();
    $('results-run').value = result.id;
    syncRunName();
  } finally { state.runBusy = false; renderWorkflowState(); }
}));

$('load-results').addEventListener('click', () => perform(loadResults));

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
  if ($('issue-proctor').textContent === 'Replace access code' &&
    !window.confirm('Replace this code? Signed-in proctors will lose access.')) return;
  state.proctorBusy = true;
  $('issue-proctor').disabled = true;
  $('revoke-proctor').disabled = true;
  try {
    const access = await request(`/api/instructor/runs/${runId}/proctor-access`, { method: 'POST' });
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
  if (!runId) throw new Error('Select a run.');
  const result = await request(`/api/instructor/runs/${runId}/results`);
  const target = $('results-table');
  clear(target);
  const label = result.name === result.title ? `${result.title} · v${result.version}`
    : `${result.name} · ${result.title} v${result.version}`;
  target.append(node('p', 'small', `${label}${result.className ? ` · ${result.className}` : ''} · Maximum ${result.maxPoints} pts`));
  const wrap = node('div', 'table-wrap'), table = node('table');
  const head = node('thead'), tr = node('tr');
  for (const label of ['Candidate', 'Section', 'Status', 'Score', 'Answers', 'Recovery']) tr.append(node('th', '', label));
  head.append(tr);
  table.append(head);
  const tbody = node('tbody');
  for (const row of result.rows) {
    const line = node('tr');
    for (const cell of [`${row.displayName} (${row.candidateId})`, row.section, row.status, `${row.score} / ${result.maxPoints}`]) {
      line.append(node('td', '', cell));
    }
    const answerCell = node('td');
    const reviewButton = node('button', '', 'Review');
    reviewButton.type = 'button'; reviewButton.disabled = !row.sessionId;
    reviewButton.addEventListener('click', () => perform(async () => {
      const review = await request(`/api/instructor/runs/${runId}/students/${encodeURIComponent(row.candidateId)}`);
      renderStudentReview(review);
      $('student-review').scrollIntoView({ block: 'start' });
    }));
    answerCell.append(reviewButton); line.append(answerCell);
    const recoveryCell = node('td');
    const runOpen = Date.now() < Date.parse(result.closesAt);
    const canExtend = row.sessionId && runOpen && ['in_progress', 'expired'].includes(row.status);
    const canReopen = row.sessionId && runOpen && ['submitted', 'expired'].includes(row.status);
    if (canExtend || canReopen) {
      const details = node('details', 'student-recovery');
      details.append(node('summary', '', 'Recovery'));
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
      recoveryCell.append(details);
    } else recoveryCell.append(node('span', 'small', '—'));
    line.append(recoveryCell);
    tbody.append(line);
  }
  table.append(tbody);
  wrap.append(table);
  target.append(wrap);
}

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
showInstructor();
