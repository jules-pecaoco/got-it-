import { createHash } from 'node:crypto';
import { parseTableCode } from '../public/table-code.js';
import { validateCodeRule } from '../public/code-task.js';
import { validateWebRule } from '../public/web-project.js';
import { validateReferenceSelection } from '../public/reference-topics.js';

export const hash = value => createHash('sha256').update(value).digest('hex');
const asArray = value => Array.isArray(value) ? value : [];
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalize = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
const defaultRetryPolicy = Object.freeze({ maxRetries: null, pointPenalty: 0, timePenaltySeconds: 0 });
export const resolveRetryPolicy = (mission, activity) => activity?.retryPolicy ?? mission?.retryPolicy ?? defaultRetryPolicy;
const validRetryPolicy = (policy, settings) => policy && typeof policy === 'object' && !Array.isArray(policy) &&
  (policy.maxRetries === null || (Number.isInteger(policy.maxRetries) && policy.maxRetries >= 0 && policy.maxRetries <= 99)) &&
  Number.isInteger(policy.pointPenalty) && policy.pointPenalty >= 0 && policy.pointPenalty <= settings.coreMaxPoints &&
  Number.isInteger(policy.timePenaltySeconds) && policy.timePenaltySeconds >= 0 &&
  policy.timePenaltySeconds <= settings.durationMinutes * 60;

export function inspectRows(config, state) {
  const columns = new Set((config.columns ?? []).map(column => column.id));
  const search = normalize(state?.globalSearch);
  const order = Array.isArray(state?.order) ? state.order : [];
  let rows = [...(config.rows ?? [])];
  if (search && state?.flags?.searching !== false) rows = rows.filter(row => [...columns].some(column => normalize(row[column]).includes(search)));
  for (const [column, term] of Object.entries(state?.columnSearch ?? {})) {
    if (state?.flags?.searching !== false && columns.has(column) && normalize(term)) rows = rows.filter(row => normalize(row[column]).includes(normalize(term)));
  }
  rows.sort((left, right) => {
    for (const item of state?.flags?.ordering === false ? [] : order) {
      if (!columns.has(item.column) || !['asc', 'desc'].includes(item.direction)) continue;
      const sign = item.direction === 'desc' ? -1 : 1;
      const compared = String(left[item.column] ?? '').localeCompare(String(right[item.column] ?? ''), 'en', { numeric: true });
      if (compared) return compared * sign;
    }
    return 0;
  });
  const pageLength = Number.isInteger(state?.pageLength) && state.pageLength > 0 ? state.pageLength : 1;
  const pageIndex = Number.isInteger(state?.pageIndex) && state.pageIndex >= 0 ? state.pageIndex : 0;
  return { filteredCount: rows.length, visible: state?.flags?.paging === false ? rows : rows.slice(pageIndex * pageLength, (pageIndex + 1) * pageLength) };
}

export function validInspectionState(config, value) {
  if (!Array.isArray(config.columns) || !Array.isArray(config.pageLengths) ||
    !value || typeof value !== 'object' || !config.pageLengths.includes(value.pageLength) ||
    typeof value.globalSearch !== 'string' || value.globalSearch.length > 100 ||
    !Number.isInteger(value.pageIndex) || value.pageIndex < 0 || !Array.isArray(value.order) || value.order.length > 2) return false;
  const columns = new Set(config.columns.map(column => column.id));
  if (value.columnSearch !== undefined && (!value.columnSearch || typeof value.columnSearch !== 'object' || Array.isArray(value.columnSearch) ||
    Object.entries(value.columnSearch).some(([column, term]) => !columns.has(column) || typeof term !== 'string' || term.length > 100))) return false;
  return value.order.length > 0 &&
    value.order.every(item => item && columns.has(item.column) && ['asc', 'desc'].includes(item.direction)) &&
    new Set(value.order.map(item => item.column)).size === value.order.length;
}

export const validatorRegistry = Object.freeze({
  web_project: () => { throw Object.assign(new Error('Web projects require isolated execution.'), { code: 'CODE_EXECUTION_REQUIRED', status: 422 }); },
  code_writing: () => { throw Object.assign(new Error('Coding answers require isolated execution.'), { code: 'CODE_EXECUTION_REQUIRED', status: 422 }); },
  single_choice: (submission, expected) => submission?.value === expected,
  multiple_choice: (submission, expected) => Array.isArray(submission?.value) && same([...new Set(submission.value)].sort(), [...expected].sort()),
  true_false: (submission, expected) => submission?.value === expected,
  text_entry: (submission, expected) => typeof submission?.value === 'string' && expected.some(x => normalize(x) === normalize(submission.value)),
  numeric_entry: (submission, expected) => typeof submission?.value === 'number' && Number.isFinite(submission.value) && Math.abs(submission.value - expected.value) <= expected.tolerance && normalize(submission.unit) === normalize(expected.unit),
  matching: (submission, expected) => submission?.value && typeof submission.value === 'object' && submission.value[expected.left] === expected.right,
  sequencing: (submission, expected) => Array.isArray(submission?.value) && same(submission.value, expected),
  data_inspection: (submission, expected, activity) => {
    const value = submission?.value, config = activity.publicConfig;
    if (!validInspectionState(config, value)) return false;
    if (expected.kind === 'page_length') return value.pageLength === expected.value;
    if (expected.kind === 'page_index') return value.pageIndex === expected.value;
    if (expected.kind === 'global_search') return normalize(value.globalSearch) === normalize(expected.value);
    if (expected.kind === 'column_search') return normalize(value.columnSearch?.[expected.value.column]) === normalize(expected.value.term);
    if (expected.kind === 'order') return same(value.order, expected.value);
    if (expected.kind === 'visible_ids') return same(inspectRows(config, { ...value, flags: undefined }).visible.map(row => row.id), expected.value);
    return false;
  },
  datatable_code: (submission, expected, activity) => {
    const value = submission?.parsedCodeState;
    if (!value || !validInspectionState(activity.publicConfig, value)) return false;
    if (expected.kind === 'flags') return same(value.flags, expected.value);
    if (expected.kind === 'page_length') return value.pageLength === expected.value;
    if (expected.kind === 'length_menu') return same(value.lengthMenu, expected.value);
    if (expected.kind === 'global_search') return normalize(value.globalSearch) === normalize(expected.value);
    if (expected.kind === 'column_search') return normalize(value.columnSearch?.[expected.value.column]) === normalize(expected.value.term);
    if (expected.kind === 'order') return same(value.order, expected.value);
    if (expected.kind === 'visible_ids') return same(inspectRows(activity.publicConfig, value).visible.map(row => row.id), expected.value);
    return false;
  }
});
export const activityTypes = new Set(Object.keys(validatorRegistry));

export function validatePackage(pub, priv) {
  const errors = [];
  if (!pub || typeof pub !== 'object' || !priv || typeof priv !== 'object') return ['Public and private package objects are required.'];
  if (pub.schemaVersion !== '1.0') errors.push('schemaVersion must be 1.0.');
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(pub.examId ?? '')) errors.push('examId must be a slug of 3–64 characters.');
  if (!Number.isInteger(pub.version) || pub.version < 1) errors.push('version must be a positive integer.');
  if (!pub.title || !pub.subject) errors.push('title and subject are required.');
  if (pub.kind !== undefined && !['activity', 'quiz', 'test', 'exam', 'ctf'].includes(pub.kind))
    errors.push('kind must be activity, quiz, test, exam, or ctf.');
  if (pub.difficulty !== undefined && !['easy', 'medium', 'hard'].includes(pub.difficulty))
    errors.push('difficulty must be easy, medium, or hard.');
  const s = pub.settings ?? {};
  errors.push(...validateReferenceSelection(s.referenceGuides));
  if (!Number.isInteger(s.durationMinutes) || s.durationMinutes < 1 || s.durationMinutes > 1440) errors.push('durationMinutes must be 1–1440.');
  if (!Number.isInteger(s.coreMaxPoints) || s.coreMaxPoints < 1) errors.push('coreMaxPoints must be positive.');
  if (!Number.isInteger(s.bonusMaxPoints) || s.bonusMaxPoints < 0) errors.push('bonusMaxPoints must be nonnegative.');
  if (asArray(pub.bonusActivities).length) errors.push('Bonus activities are not supported by this engine version.');
  if (!Array.isArray(pub.missions) || pub.missions.length === 0) errors.push('At least one mission is required.');
  const missions = asArray(pub.missions);
  const missionIds = new Set(), activityIds = new Set(), ruleIds = new Set(), usedRules = new Set();
  let coreTotal = 0;
  for (let i = 0; i < missions.length; i++) {
    const m = missions[i];
    if (!m || typeof m !== 'object') { errors.push(`Mission ${i + 1} is invalid.`); continue; }
    if (!m.id || missionIds.has(m.id)) errors.push(`Mission ID ${m.id ?? '(missing)'} is missing or duplicated.`);
    if (typeof m.id !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(m.id)) errors.push('Mission IDs must use 1–80 letters, digits, or hyphens.');
    missionIds.add(m.id);
    if (m.fixedLast && i !== missions.length - 1) errors.push(`${m.id}: fixedLast mission must be last.`);
    if (m.fixedLast && m.shuffleGroup) errors.push(`${m.id}: fixedLast mission cannot be shuffled.`);
    if (!Number.isInteger(m.maxPoints) || m.maxPoints < 0) errors.push(`${m.id}: maxPoints must be nonnegative integer.`);
    if (m.retryPolicy !== undefined && !validRetryPolicy(m.retryPolicy, s)) errors.push(`${m.id}: invalid retry policy.`);
    coreTotal += Number(m.maxPoints) || 0;
    let activityTotal = 0;
    if (!Array.isArray(m.activities) || !m.activities.length) errors.push(`${m.id}: activities required.`);
    for (const a of asArray(m.activities)) {
      if (!a || typeof a !== 'object') { errors.push(`${m.id}: invalid activity.`); continue; }
      if (!a.id || activityIds.has(a.id)) errors.push(`Activity ID ${a.id ?? '(missing)'} is missing or duplicated.`);
      if (typeof a.id !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(a.id)) errors.push('Activity IDs must use 1–80 letters, digits, or hyphens.');
      activityIds.add(a.id);
      if (!activityTypes.has(a.type)) errors.push(`${a.id}: unsupported activity type ${a.type}.`);
      if (!Number.isInteger(a.maxPoints) || a.maxPoints < 0) errors.push(`${a.id}: invalid maxPoints.`);
      if (a.retryPolicy !== undefined && !validRetryPolicy(a.retryPolicy, s)) errors.push(`${a.id}: invalid retry policy.`);
      activityTotal += Number(a.maxPoints) || 0;
      if (!a.prompt || typeof a.prompt !== 'string') errors.push(`${a.id}: prompt required.`);
      if (!a.gradingRuleId || usedRules.has(a.gradingRuleId)) errors.push(`${a.id}: gradingRuleId missing or reused.`);
      usedRules.add(a.gradingRuleId);
      const refs = asArray(a.sourceRefs);
      if (!refs.length && !a.manualRationale) errors.push(`${a.id}: sourceRefs or manualRationale required.`);
      for (const ref of refs) if (!ref?.file || !ref?.pageOrSlide) errors.push(`${a.id}: incomplete source reference.`);
      const rule = priv.rules?.[a.gradingRuleId];
      if (!rule || rule.type !== a.type || !Array.isArray(rule.criteria) || !rule.criteria.length) {
        errors.push(`${a.id}: matching private grading criteria required.`); continue;
      }
      let ruleTotal = 0;
      if (!['matching', 'data_inspection', 'datatable_code', 'code_writing', 'web_project'].includes(a.type) && rule.criteria.length !== 1) errors.push(`${a.id}: exactly one criterion required for this activity type.`);
      for (const c of rule.criteria) {
        if (!c.id || ruleIds.has(c.id)) errors.push(`${a.id}: criterion ID missing or duplicated.`);
        ruleIds.add(c.id);
        if (!Number.isInteger(c.points) || c.points < 1 || !own(c, 'answer')) errors.push(`${a.id}: invalid criterion points or answer.`);
        ruleTotal += Number(c.points) || 0;
      }
      if (ruleTotal !== a.maxPoints) errors.push(`${a.id}: criterion points do not equal activity maxPoints.`);
      errors.push(...validateActivityConfig(a, rule).map(e => `${a.id}: ${e}`));
    }
    if (activityTotal !== m.maxPoints) errors.push(`${m.id}: activity points do not equal mission maxPoints.`);
  }
  if (coreTotal !== s.coreMaxPoints) errors.push('Core mission points do not equal coreMaxPoints.');
  for (const m of missions) {
    for (const dep of asArray(m?.dependsOn)) {
      if (!missionIds.has(dep) || dep === m.id) errors.push(`${m.id}: invalid dependency ${dep}.`);
    }
  }
  const byId = new Map(missions.map(m => [m.id, m]));
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) { errors.push(`Dependency cycle at ${id}.`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of asArray(byId.get(id)?.dependsOn)) if (byId.has(dep)) visit(dep);
    visiting.delete(id); visited.add(id);
  }
  for (const m of missions) visit(m.id);
  const groups = new Map();
  missions.forEach((m, i) => { if (m.shuffleGroup) {
    const positions = groups.get(m.shuffleGroup) ?? []; positions.push(i); groups.set(m.shuffleGroup, positions);
    if (asArray(m.dependsOn).length) errors.push(`${m.id}: shuffled missions must be independent.`);
  }});
  for (const [group, positions] of groups) {
    if (positions.at(-1) - positions[0] + 1 !== positions.length) errors.push(`Shuffle group ${group} must be contiguous.`);
    const ids = new Set(positions.map(i => missions[i].id));
    for (const m of missions) if (asArray(m.dependsOn).some(d => ids.has(d)) && positions.includes(missions.indexOf(m))) errors.push(`${m.id}: shuffled dependency conflict.`);
  }
  for (const m of missions) for (const dep of asArray(m.dependsOn)) {
    const depIndex = missions.findIndex(x => x.id === dep);
    const ownIndex = missions.indexOf(m);
    if (depIndex >= ownIndex) errors.push(`${m.id}: prerequisite ${dep} must precede it.`);
  }
  for (const id of Object.keys(priv.rules ?? {})) if (!usedRules.has(id)) errors.push(`Unused private rule ${id}.`);
  if (containsAnswerKeys(pub)) errors.push('Public package contains answer-like key names.');
  return [...new Set(errors)];
}

function containsAnswerKeys(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) =>
    /^(answer|answers|correct|correctAnswer|expected|solution|referenceCode|privateTests|privateGrading)$/i.test(key) || containsAnswerKeys(item));
}

function validateActivityConfig(a, rule) {
  const errors = [], cfg = a.publicConfig ?? {}, first = rule.criteria[0]?.answer;
  if (a.type === 'web_project') errors.push(...validateWebRule(cfg, rule));
  if (a.type === 'code_writing') {
    errors.push(...validateCodeRule(cfg, rule));
    if (own(a, 'tests')) errors.push('coding tests belong in the private grading rule.');
  }
  const options = asArray(cfg.options);
  if (['single_choice', 'multiple_choice'].includes(a.type)) {
    if (options.length < 2 || options.some(x => !x?.id || !x?.label) || new Set(options.map(x => x.id)).size !== options.length) errors.push('at least two unique labeled options required.');
    const ids = new Set(options.map(x => x.id));
    const answers = a.type === 'multiple_choice' ? asArray(first) : [first];
    if (!answers.length || new Set(answers).size !== answers.length || answers.some(x => !ids.has(x))) errors.push('private option answer is invalid.');
  }
  if (a.type === 'true_false' && typeof first !== 'boolean') errors.push('boolean private answer required.');
  if (a.type === 'text_entry' && (!Array.isArray(first) || !first.length || first.some(x => typeof x !== 'string'))) errors.push('accepted text array required.');
  if (a.type === 'numeric_entry' && (!first || !Number.isFinite(first.value) || !Number.isFinite(first.tolerance) || first.tolerance < 0)) errors.push('numeric answer with tolerance required.');
  if (a.type === 'matching') {
    if (!Array.isArray(cfg.left) || !Array.isArray(cfg.right) || rule.criteria.length !== cfg.left.length) errors.push('matching labels and one criterion per left item required.');
    if (new Set(rule.criteria.map(c => c.answer?.left)).size !== rule.criteria.length) errors.push('each left item requires one distinct criterion.');
    for (const c of rule.criteria) if (!cfg.left?.some(x => x.id === c.answer?.left) || !cfg.right?.some(x => x.id === c.answer?.right)) errors.push('private pair references invalid label.');
  }
  if (a.type === 'sequencing') {
    const ids = asArray(cfg.items).map(x => x.id);
    if (ids.length < 2 || new Set(ids).size !== ids.length || !Array.isArray(first) || !same([...first].sort(), [...ids].sort())) errors.push('sequence must contain each public item once.');
  }
  if (['data_inspection', 'datatable_code'].includes(a.type)) {
    const columns = asArray(cfg.columns), rows = asArray(cfg.rows), lengths = asArray(cfg.pageLengths);
    if (columns.length < 2 || columns.some(x => !x?.id || !x?.label) || new Set(columns.map(x => x.id)).size !== columns.length) errors.push('table columns must have unique IDs and labels.');
    if (rows.length < 6 || rows.some(x => !x?.id || columns.some(c => x[c.id] === undefined)) || new Set(rows.map(x => x.id)).size !== rows.length) errors.push('inspection needs at least six rows with unique IDs and complete columns.');
    if (!lengths.length || lengths.some(x => !Number.isInteger(x) || x < 1)) errors.push('positive pageLengths required.');
    const kinds = new Set(rule.criteria.map(c => c.answer?.kind));
    const requiredKinds = a.type === 'datatable_code'
      ? ['flags', 'page_length', 'length_menu', 'global_search', 'column_search', 'order', 'visible_ids']
      : ['page_length', ...(kinds.has('page_index') ? ['page_index'] : []), 'global_search', ...(kinds.has('column_search') ? ['column_search'] : []), 'order', 'visible_ids'];
    if (rule.criteria.length !== requiredKinds.length || !same([...kinds].sort(), [...requiredKinds].sort())) errors.push(`${a.type} needs one of each required criterion kind.`);
    const target = {
      ...(a.type === 'datatable_code' ? { flags: rule.criteria.find(c => c.answer?.kind === 'flags')?.answer.value } : {}),
      pageLength: rule.criteria.find(c => c.answer?.kind === 'page_length')?.answer.value,
      globalSearch: rule.criteria.find(c => c.answer?.kind === 'global_search')?.answer.value,
      columnSearch: (() => { const value = rule.criteria.find(c => c.answer?.kind === 'column_search')?.answer.value; return value?.column ? { [value.column]: value.term } : {}; })(),
      order: rule.criteria.find(c => c.answer?.kind === 'order')?.answer.value,
      pageIndex: rule.criteria.find(c => c.answer?.kind === 'page_index')?.answer.value ?? 0
    };
    if (columns.length >= 2 && rows.length >= 6 && !validInspectionState(cfg, target)) errors.push('inspection target state is invalid.');
    else if (!same(inspectRows(cfg, target).visible.map(row => row.id), rule.criteria.find(c => c.answer?.kind === 'visible_ids')?.answer.value)) errors.push('private visible_ids do not match the target state.');
    if (a.type === 'datatable_code' && (typeof cfg.selector !== 'string' || !cfg.selector.startsWith('#'))) errors.push('code activity needs a table selector.');
  }
  return errors;
}

export function assignedOrder(missions, random = Math.random) {
  const result = missions.map(m => m.id);
  for (let i = 0; i < missions.length;) {
    const group = missions[i].shuffleGroup;
    if (!group) { i++; continue; }
    let end = i + 1;
    while (end < missions.length && missions[end].shuffleGroup === group) end++;
    for (let j = end - 1; j > i; j--) {
      const k = i + Math.floor(random() * (j - i + 1));
      [result[j], result[k]] = [result[k], result[j]];
    }
    i = end;
  }
  return result;
}

export function hasSubmittableCode(submission) {
  const code = submission?.value;
  return typeof code === 'string' && code.length <= 16000 && code.trim().length > 0;
}

export function evaluate(a, rule, submission) {
  if (a.type === 'code_writing') {
    if (!hasSubmittableCode(submission))
      throw Object.assign(new Error('Enter 1–16,000 characters of code.'), { code: 'INVALID_CODE', status: 400 });
    return { result: 'pending_review', feedbackCode: 'MANUAL_REVIEW', awarded: [] };
  }
  const awarded = [];
  const validator = validatorRegistry[a.type];
  if (!validator) throw new Error(`No validator registered for ${a.type}.`);
  let checkedSubmission = submission;
  if (a.type === 'datatable_code') {
    let parsedCodeState = null;
    try { parsedCodeState = parseTableCode(submission?.value, a.publicConfig); } catch { /* invalid code earns no criteria */ }
    checkedSubmission = { parsedCodeState };
  }
  for (const criterion of rule.criteria) {
    if (validator(checkedSubmission, criterion.answer, a)) awarded.push({ id: criterion.id, points: criterion.points });
  }
  return {
    result: awarded.length === rule.criteria.length ? 'correct' : awarded.length ? 'partially_correct' : 'incorrect',
    awarded,
    feedbackCode: awarded.length === rule.criteria.length ? 'ALL_CRITERIA_MET' : awarded.length ? 'SOME_CRITERIA_MET' : 'TRY_AGAIN'
  };
}
