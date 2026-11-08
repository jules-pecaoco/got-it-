import { mountLogic } from '/assets/workspaces.js';
import { codingLanguages } from './code-task.js';
const node = (tag, text, className = '') => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  element.className = className;
  return element;
};
export function appendCodeExamples(target, config) {
  const examples = node('div', undefined, 'coding-examples');
  config.samples.forEach((sample, index) => {
    const card = node('section', undefined, 'coding-sample');
    if (sample.transcript) { card.append(node('h4', `Example ${index + 1}`), node('p', 'Sample run · includes typed input', 'small'), node('pre', sample.transcript)); examples.append(card); return; }
    card.append(node('h4', `Example ${index + 1}`), node('p', config.language === 'sql' ? 'Database setup' : 'Sample input', 'small'),
      node('pre', sample.input || '(no input)'), node('p', 'Expected output', 'small'), node('pre', sample.output || '(empty output)'));
    examples.append(card);
  });
  examples.append(node('p', 'These examples show what your program should do. Your instructor grades the code you submit.', 'small'));
  if (config.language === 'sql') examples.append(node('p', 'Use SQLite SQL. Return one SELECT/WITH query. Columns print separated by tabs; rows print on separate lines.', 'small'));
  target.append(examples);
}
export function renderCodingQuestion(form, activity, runSamples, terminal, terminalUnavailable = false) {
  const target = document.createElement('div'); form.append(target);
  const workspace = mountLogic(target, activity, { run: runSamples, terminal, terminalUnavailable, changed: () => form.dispatchEvent(new Event('input', { bubbles: true })) });
  form._disposeWorkspace = workspace.unmount;
  return workspace.value;
}

export function createCodeQuestionEditor(activity) {
  const element = node('section', undefined, 'stack');
  const field = (labelText, value = '', tag = 'textarea', parent = element) => {
    const label = node('label', labelText), input = node(tag);
    input.value = value; if (tag === 'textarea') { input.rows = 4; input.spellcheck = false; }
    label.append(input); parent.append(label); return input;
  };
  const manual = Array.isArray(activity.rubric);
  const language = field('Solution language', '', 'select');
  for (const [value, label] of codingLanguages) { const option = node('option', label); option.value = value; language.append(option); }
  language.value = activity.language || 'python';
  const starter = field('Starter code · include TODOs for students', activity.starterCode || '');
  const reference = field('Reference solution · faculty only', activity.referenceCode || ''); reference.rows = 8;
  const comparison = field('Compare output', '', 'select');
  for (const [value, label] of [['whitespace', 'Ignore whitespace differences'], ['exact', 'Exact output'], ['numeric', 'Allow numeric tolerance']]) {
    const option = node('option', label); option.value = value; comparison.append(option);
  }
  comparison.value = activity.comparison?.mode || 'whitespace';
  const tolerances = node('div', undefined, 'ai-form-grid'); element.append(tolerances);
  const absolute = field('Absolute numeric tolerance', activity.comparison?.absoluteTolerance ?? 0.01, 'input', tolerances);
  const relative = field('Relative numeric tolerance (%)', (activity.comparison?.relativeTolerance ?? 0.001) * 100, 'input', tolerances);
  for (const input of [absolute, relative]) { input.type = 'number'; input.min = '0'; input.step = 'any'; }
  if (manual) { reference.parentElement.hidden = true; comparison.parentElement.hidden = true; }
  const rubric = manual ? field('Grading instructions · one item per line', activity.rubric.join('\n')) : null;
  const syncTolerance = () => { tolerances.hidden = manual || comparison.value !== 'numeric'; };
  comparison.addEventListener('change', syncTolerance); syncTolerance();
  element.append(node('p', manual ? 'Add 1–3 sample inputs and expected outputs for students.' : 'Add 2–6 faculty reference examples. Show 1–3 to students. Submitted code is graded manually.', 'small'));
  const tests = node('div', undefined, 'stack'); element.append(tests);
  const entries = [];
  const add = sample => {
    const card = node('section', undefined, 'coding-sample');
    const input = field(manual ? 'Sample input' : 'Reference input / SQL database setup', sample?.input || '', 'textarea', card);
    const output = field('Expected output', sample?.output || '', 'textarea', card);
    const transcript = field('Sample run dialogue · prompts and typed input (optional)', (Array.isArray(activity.samples) ? activity.samples : []).find(item => item.input === sample?.input)?.transcript || sample?.transcript || '', 'textarea', card);
    const label = node('label', ' Show this example to students', 'ai-approval');
    const visible = node('input'); visible.type = 'checkbox';
    visible.checked = manual || !!(Array.isArray(activity.samples) ? activity.samples : []).some(item => item.input === sample?.input && item.output === sample?.output);
    label.prepend(visible); if (!manual) card.append(label);
    const remove = node('button', manual ? 'Remove sample' : 'Remove reference example'); remove.type = 'button'; card.append(remove);
    const entry = { card, input, output, transcript, visible }; entries.push(entry);
    remove.addEventListener('click', () => { entries.splice(entries.indexOf(entry), 1); card.remove(); });
    tests.append(card);
  };
  for (const sample of Array.isArray(activity.tests) ? activity.tests : Array.isArray(activity.samples) ? activity.samples : [{ input: '', output: '' }, { input: '', output: '' }]) add(sample);
  const addButton = node('button', manual ? 'Add sample' : 'Add reference example'); addButton.type = 'button';
  addButton.addEventListener('click', () => { if (entries.length < (manual ? 3 : 6)) add(); }); element.append(addButton);
  return { element, value: () => ({ language: language.value, starterCode: starter.value, referenceCode: reference.value,
    comparison: comparison.value === 'numeric' ? { mode: 'numeric', absoluteTolerance: Number(absolute.value), relativeTolerance: Number(relative.value) / 100 } : { mode: comparison.value },
    ...(manual ? { rubric: rubric.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean) } : {}),
    tests: entries.map(entry => ({ input: entry.input.value, output: entry.output.value })),
    samples: entries.filter(entry => entry.visible.checked).map(entry => ({ input: entry.input.value, output: entry.output.value, ...(entry.transcript.value.trim() ? { transcript: entry.transcript.value } : {}) })) }) };
}
