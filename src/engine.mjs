import { createHash } from 'node:crypto';
import { parseTableCode } from '../public/table-code.js';
import { validateCodeRule } from '../public/code-task.js';
import { validateWebRule } from '../public/web-project.js';
import { validateReferenceSelection } from '../public/reference-topics.js';
import { assessmentLimits } from '../public/assessment-limits.js';
import { inspectRows } from '../public/table-state.js';
export { inspectRows } from '../public/table-state.js';

export const hash = value => createHash('sha256').update(value).digest('hex');
const asArray = value => Array.isArray(value) ? value : [];
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonblank = value => typeof value === 'string' && normalize(value).length > 0;
const same = (a, b) => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length && a.every((item, index) => same(item, b[index]));
  if (!record(a) || !record(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && same(a[key], b[key]));
};
const normalize = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
const defaultRetryPolicy = Object.freeze({ maxRetries: null, pointPenalty: 0, timePenaltySeconds: 0 });
export const resolveRetryPolicy = (mission, activity) => activity?.retryPolicy ?? mission?.retryPolicy ?? defaultRetryPolicy;
const validRetryPolicy = (policy, settings) => policy && typeof policy === 'object' && !Array.isArray(policy) &&
  Number.isInteger(settings.coreMaxPoints) && Number.isInteger(settings.durationMinutes) &&
  (policy.maxRetries === null || (Number.isInteger(policy.maxRetries) && policy.maxRetries >= 0 && policy.maxRetries <= 99)) &&
  Number.isInteger(policy.pointPenalty) && policy.pointPenalty >= 0 && policy.pointPenalty <= settings.coreMaxPoints &&
  Number.isInteger(policy.timePenaltySeconds) && policy.timePenaltySeconds >= 0 &&
  policy.timePenaltySeconds <= settings.durationMinutes * 60;

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
    if (expected.kind === 'visible_ids') return same(inspectRows(activity.publicConfig, value, { mode: 'datatable' }).visible.map(row => row.id), expected.value);
    return false;
  }
});
export const activityTypes = new Set(Object.keys(validatorRegistry));

export function validatePackage(pub, priv) {
  const errors = [];
  if (!record(pub) || !record(priv)) return ['Public and private package objects are required.'];
  // Reject unsupported JSON shapes and bound traversal before semantic validation.
  // Imported content can otherwise cause deep recursion or reach type coercions.
  const seen = new Set();
  let nodes = 0;
  function checkJson(value, path, depth = 0) {
    if (++nodes > 100000 || depth > 32) { errors.push(`${path}: package exceeds the supported size or depth.`); return; }
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || seen.has(value) || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) {
      errors.push(`${path}: a finite JSON value is required.`); return;
    }
    seen.add(value);
    for (const [key, item] of Object.entries(value)) {
      checkJson(item, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, depth + 1);
      if (nodes > 100000) break;
    }
    seen.delete(value);
  }
  checkJson(pub, 'public'); checkJson(priv, 'private');
  if (errors.length) return errors;
  if (pub.schemaVersion !== '1.0') errors.push('schemaVersion must be 1.0.');
  if (typeof pub.examId !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(pub.examId)) errors.push('examId must be a slug of 3–64 characters.');
  if (!Number.isInteger(pub.version) || pub.version < 1) errors.push('version must be a positive integer.');
  if (!nonblank(pub.title) || !nonblank(pub.subject)) errors.push('title and subject are required.');
  if (pub.kind !== undefined && !['activity', 'quiz', 'test', 'exam', 'ctf'].includes(pub.kind))
    errors.push('kind must be activity, quiz, test, exam, or ctf.');
  if (pub.difficulty !== undefined && !['easy', 'medium', 'hard'].includes(pub.difficulty))
    errors.push('difficulty must be easy, medium, or hard.');
  if (!record(pub.settings)) errors.push('settings: an object is required.');
  if (!record(priv.rules)) errors.push('rules: an object is required.');
  const s = record(pub.settings) ? pub.settings : {};
  errors.push(...validateReferenceSelection(s.referenceGuides));
  if (!Number.isInteger(s.durationMinutes) || s.durationMinutes < 1 || s.durationMinutes > 1440) errors.push('durationMinutes must be 1–1440.');
  if (!Number.isInteger(s.coreMaxPoints) || s.coreMaxPoints < 1) errors.push('coreMaxPoints must be positive.');
  if (!Number.isInteger(s.bonusMaxPoints) || s.bonusMaxPoints < 0) errors.push('bonusMaxPoints must be nonnegative.');
  if (pub.bonusActivities !== undefined && !Array.isArray(pub.bonusActivities)) errors.push('bonusActivities: an array is required.');
  if (asArray(pub.bonusActivities).length) errors.push('Bonus activities are not supported by this engine version.');
  if (!Array.isArray(pub.missions) || pub.missions.length === 0) errors.push('At least one mission is required.');
  const missions = asArray(pub.missions).filter((mission, index) => {
    if (record(mission)) return true;
    errors.push(`missions[${index}]: a mission object is required.`); return false;
  });
  if (missions.length > assessmentLimits.questions || missions.reduce((sum, mission) => sum + asArray(mission.activities).length, 0) > assessmentLimits.questions)
    return [...errors, `Assessments support at most ${assessmentLimits.questions} questions and missions.`];
  const missionIds = new Set(), activityIds = new Set(), ruleIds = new Set(), usedRules = new Set();
  let coreTotal = 0;
  for (let i = 0; i < missions.length; i++) {
    const m = missions[i];
    if (typeof m.id !== 'string') { errors.push(`missions[${i}].id: a string ID is required.`); continue; }
    if (!nonblank(m.title)) errors.push(`${m.id ?? `missions[${i}]`}: mission title required.`);
    if (m.dependsOn !== undefined && (!Array.isArray(m.dependsOn) || m.dependsOn.some(dep => !nonblank(dep)))) errors.push(`${m.id}: dependsOn must be an array of string IDs.`);
    if (m.shuffleGroup !== undefined && !nonblank(m.shuffleGroup)) errors.push(`${m.id}: shuffleGroup must be a nonblank string.`);
    if (m.fixedLast !== undefined && typeof m.fixedLast !== 'boolean') errors.push(`${m.id}: fixedLast must be boolean.`);
    if (!m.id || missionIds.has(m.id)) errors.push(`Mission ID ${m.id ?? '(missing)'} is missing or duplicated.`);
    if (typeof m.id !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(m.id)) errors.push('Mission IDs must use 1–80 letters, digits, or hyphens.');
    missionIds.add(m.id);
    if (m.fixedLast && i !== missions.length - 1) errors.push(`${m.id}: fixedLast mission must be last.`);
    if (m.fixedLast && m.shuffleGroup) errors.push(`${m.id}: fixedLast mission cannot be shuffled.`);
    if (!Number.isInteger(m.maxPoints) || m.maxPoints < 0) errors.push(`${m.id}: maxPoints must be nonnegative integer.`);
    if (m.retryPolicy !== undefined && !validRetryPolicy(m.retryPolicy, s)) errors.push(`${m.id}: invalid retry policy.`);
    coreTotal += Number.isInteger(m.maxPoints) ? m.maxPoints : 0;
    let activityTotal = 0;
    if (!Array.isArray(m.activities) || !m.activities.length) errors.push(`${m.id}: activities required.`);
    for (const [activityIndex, a] of asArray(m.activities).entries()) {
      if (!record(a)) { errors.push(`missions[${i}].activities[${activityIndex}]: an activity object is required.`); continue; }
      if (typeof a.id !== 'string') { errors.push(`missions[${i}].activities[${activityIndex}].id: a string ID is required.`); continue; }
      if (!a.id || activityIds.has(a.id)) errors.push(`Activity ID ${a.id ?? '(missing)'} is missing or duplicated.`);
      if (typeof a.id !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(a.id)) errors.push('Activity IDs must use 1–80 letters, digits, or hyphens.');
      activityIds.add(a.id);
      if (!activityTypes.has(a.type)) errors.push(`${a.id}: unsupported activity type.`);
      if (!Number.isInteger(a.maxPoints) || a.maxPoints < 0) errors.push(`${a.id}: invalid maxPoints.`);
      if (a.retryPolicy !== undefined && !validRetryPolicy(a.retryPolicy, s)) errors.push(`${a.id}: invalid retry policy.`);
      activityTotal += Number.isInteger(a.maxPoints) ? a.maxPoints : 0;
      if (!nonblank(a.prompt)) errors.push(`${a.id}: prompt required.`);
      if (!nonblank(a.gradingRuleId) || usedRules.has(a.gradingRuleId)) errors.push(`${a.id}: gradingRuleId missing or reused.`);
      if (typeof a.gradingRuleId !== 'string') continue;
      usedRules.add(a.gradingRuleId);
      const refs = asArray(a.sourceRefs);
      if (a.sourceRefs !== undefined && !Array.isArray(a.sourceRefs)) errors.push(`${a.id}: sourceRefs must be an array.`);
      if (a.manualRationale !== undefined && !nonblank(a.manualRationale)) errors.push(`${a.id}: manualRationale must be nonblank text.`);
      if (!refs.length && !nonblank(a.manualRationale)) errors.push(`${a.id}: sourceRefs or manualRationale required.`);
      for (const ref of refs) if (!record(ref) || !nonblank(ref.file) || !nonblank(ref.pageOrSlide)) errors.push(`${a.id}: incomplete source reference.`);
      const rule = record(priv.rules) && own(priv.rules, a.gradingRuleId) ? priv.rules[a.gradingRuleId] : null;
      if (!record(rule) || rule.type !== a.type || !Array.isArray(rule.criteria) || !rule.criteria.length) {
        errors.push(`${a.id}: matching private grading criteria required.`); continue;
      }
      let ruleTotal = 0;
      if (!['matching', 'data_inspection', 'datatable_code', 'code_writing', 'web_project'].includes(a.type) && rule.criteria.length !== 1) errors.push(`${a.id}: exactly one criterion required for this activity type.`);
      let validCriteria = true;
      for (const [criterionIndex, c] of rule.criteria.entries()) {
        if (!record(c)) { errors.push(`rules.${a.gradingRuleId}.criteria[${criterionIndex}]: a criterion object is required.`); validCriteria = false; continue; }
        if (!nonblank(c.id) || ruleIds.has(c.id)) errors.push(`${a.id}: criterion ID missing or duplicated.`);
        ruleIds.add(c.id);
        if (!Number.isInteger(c.points) || c.points < 1 || !own(c, 'answer')) errors.push(`${a.id}: invalid criterion points or answer.`);
        ruleTotal += Number.isInteger(c.points) ? c.points : 0;
      }
      if (ruleTotal !== a.maxPoints) errors.push(`${a.id}: criterion points do not equal activity maxPoints.`);
      if (!record(a.publicConfig)) errors.push(`${a.id}: publicConfig must be an object.`);
      else if (validCriteria) errors.push(...validateActivityConfig(a, rule).map(e => `${a.id}: ${e}`));
    }
    if (activityTotal !== m.maxPoints) errors.push(`${m.id}: activity points do not equal mission maxPoints.`);
  }
  if (coreTotal !== s.coreMaxPoints) errors.push('Core mission points do not equal coreMaxPoints.');
  const dependencyMissions = missions.filter(m => typeof m.id === 'string');
  for (const m of dependencyMissions) {
    for (const dep of asArray(m.dependsOn).filter(dep => typeof dep === 'string')) {
      if (!missionIds.has(dep) || dep === m.id) errors.push(`${m.id}: invalid dependency ${dep}.`);
    }
  }
  const byId = new Map(dependencyMissions.map(m => [m.id, m]));
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) { errors.push(`Dependency cycle at ${id}.`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of asArray(byId.get(id)?.dependsOn)) if (byId.has(dep)) visit(dep);
    visiting.delete(id); visited.add(id);
  }
  for (const m of dependencyMissions) visit(m.id);
  const groups = new Map();
  missions.forEach((m, i) => { if (typeof m.id === 'string' && typeof m.shuffleGroup === 'string' && m.shuffleGroup) {
    const positions = groups.get(m.shuffleGroup) ?? []; positions.push(i); groups.set(m.shuffleGroup, positions);
    if (asArray(m.dependsOn).length) errors.push(`${m.id}: shuffled missions must be independent.`);
  }});
  for (const [group, positions] of groups) {
    if (positions.at(-1) - positions[0] + 1 !== positions.length) errors.push(`Shuffle group ${group} must be contiguous.`);
    const ids = new Set(positions.map(i => missions[i].id));
    for (const m of dependencyMissions) if (asArray(m.dependsOn).some(d => ids.has(d)) && positions.includes(missions.indexOf(m))) errors.push(`${m.id}: shuffled dependency conflict.`);
  }
  for (const m of dependencyMissions) for (const dep of asArray(m.dependsOn).filter(dep => typeof dep === 'string')) {
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
  const labels = (items, path) => {
    if (!Array.isArray(items) || items.length < 2) { errors.push(`${path}: at least two labeled items required.`); return false; }
    const ids = new Set();
    let valid = true;
    items.forEach((item, index) => {
      if (!record(item) || !nonblank(item.id) || !nonblank(item.label)) {
        errors.push(`${path}[${index}]: nonblank string id and label required.`); valid = false;
      } else if (ids.has(item.id)) { errors.push(`${path}[${index}].id: duplicate ID.`); valid = false; }
      else ids.add(item.id);
    });
    return valid;
  };
  if (a.type === 'web_project') errors.push(...validateWebRule(cfg, rule));
  if (a.type === 'code_writing') {
    errors.push(...validateCodeRule(cfg, rule));
    if (own(a, 'tests')) errors.push('coding tests belong in the private grading rule.');
  }
  const options = asArray(cfg.options);
  if (['single_choice', 'multiple_choice'].includes(a.type)) {
    labels(cfg.options, 'publicConfig.options');
    const ids = new Set(options.filter(record).map(x => x.id));
    const answers = a.type === 'multiple_choice' ? asArray(first) : [first];
    if (!answers.length || new Set(answers).size !== answers.length || answers.some(x => !ids.has(x))) errors.push('private option answer is invalid.');
  }
  if (a.type === 'true_false' && typeof first !== 'boolean') errors.push('boolean private answer required.');
  if (a.type === 'text_entry' && (!Array.isArray(first) || !first.length || first.some(x => !nonblank(x)))) errors.push('accepted text array with nonblank normalized answers required.');
  if (a.type === 'numeric_entry' && (!record(first) || !Number.isFinite(first.value) || !Number.isFinite(first.tolerance) || first.tolerance < 0 || first.unit !== undefined && typeof first.unit !== 'string')) errors.push('numeric answer with tolerance and optional text unit required.');
  if (a.type === 'matching') {
    const leftValid = labels(cfg.left, 'publicConfig.left'), rightValid = labels(cfg.right, 'publicConfig.right');
    if (rule.criteria.length !== asArray(cfg.left).length) errors.push('matching labels and one criterion per left item required.');
    if (new Set(rule.criteria.map(c => c.answer?.left)).size !== rule.criteria.length) errors.push('each left item requires one distinct criterion.');
    for (const c of rule.criteria) if (!record(c.answer) || !nonblank(c.answer.left) || !nonblank(c.answer.right) ||
      !leftValid || !rightValid || !cfg.left.some(x => x.id === c.answer.left) || !cfg.right.some(x => x.id === c.answer.right)) errors.push('private pair references invalid label.');
  }
  if (a.type === 'sequencing') {
    labels(cfg.items, 'publicConfig.items');
    const ids = asArray(cfg.items).filter(record).map(x => x.id);
    if (ids.length < 2 || !ids.every(nonblank) || new Set(ids).size !== ids.length || !Array.isArray(first) || !first.every(nonblank) || !same([...first].sort(), [...ids].sort())) errors.push('sequence must contain each public item once.');
  }
  if (['data_inspection', 'datatable_code'].includes(a.type)) {
    const columns = asArray(cfg.columns), rows = asArray(cfg.rows), lengths = asArray(cfg.pageLengths);
    const validColumns = labels(cfg.columns, 'publicConfig.columns');
    const validRows = rows.length >= 6 && rows.every(x => record(x) && nonblank(x.id) &&
      validColumns && columns.every(c => own(x, c.id) && (x[c.id] === null || ['string', 'boolean', 'number'].includes(typeof x[c.id])))) &&
      new Set(rows.map(x => x.id)).size === rows.length;
    if (!validRows) errors.push('publicConfig.rows: inspection needs at least six rows with unique string IDs and primitive cells for every column.');
    const validLengths = lengths.length > 0 && lengths.every(x => Number.isInteger(x) && x > 0) && new Set(lengths).size === lengths.length;
    if (!validLengths) errors.push('positive unique pageLengths required.');
    if (rule.criteria.some(c => !record(c.answer) || !nonblank(c.answer.kind))) {
      errors.push('table criteria require an answer object with a string kind.'); return errors;
    }
    const kinds = new Set(rule.criteria.map(c => c.answer?.kind));
    const requiredKinds = a.type === 'datatable_code'
      ? ['flags', 'page_length', 'length_menu', 'global_search', 'column_search', 'order', 'visible_ids']
      : ['page_length', ...(kinds.has('page_index') ? ['page_index'] : []), 'global_search', ...(kinds.has('column_search') ? ['column_search'] : []), 'order', 'visible_ids'];
    if (rule.criteria.length !== requiredKinds.length || !same([...kinds].sort(), [...requiredKinds].sort())) errors.push(`${a.type} needs one of each required criterion kind.`);
    const target = {
      ...(a.type === 'datatable_code' ? { flags: rule.criteria.find(c => c.answer?.kind === 'flags')?.answer.value } : {}),
      pageLength: rule.criteria.find(c => c.answer?.kind === 'page_length')?.answer.value,
      globalSearch: rule.criteria.find(c => c.answer?.kind === 'global_search')?.answer.value,
      columnSearch: (() => { const value = rule.criteria.find(c => c.answer?.kind === 'column_search')?.answer.value; return typeof value?.column === 'string' && value.column ? { [value.column]: value.term } : {}; })(),
      order: rule.criteria.find(c => c.answer?.kind === 'order')?.answer.value,
      pageIndex: rule.criteria.find(c => c.answer?.kind === 'page_index')?.answer.value ?? 0
    };
    if (!validColumns || !validRows || !validLengths || !validInspectionState(cfg, target)) errors.push('inspection target state is invalid.');
    else {
      const result = inspectRows(cfg, target, { mode: a.type === 'datatable_code' ? 'datatable' : 'inspection' });
      if (!result.visible.length) errors.push('inspection target must contain a visible row.');
      if (!same(result.visible.map(row => row.id), rule.criteria.find(c => c.answer?.kind === 'visible_ids')?.answer.value)) errors.push('private visible_ids do not match the target state.');
    }
    const filter = rule.criteria.find(c => c.answer?.kind === 'column_search')?.answer.value;
    if (kinds.has('column_search') && (!record(filter) || !nonblank(filter.column) || !columns.some(column => column?.id === filter.column) || typeof filter.term !== 'string' || filter.term.length > 100)) errors.push('column_search needs a valid column and text term.');
    if (a.type === 'datatable_code') {
      if (typeof cfg.selector !== 'string' || !/^#[A-Za-z][\w-]*$/.test(cfg.selector)) errors.push('code activity needs a table selector.');
      if (typeof cfg.scaffold !== 'string' || cfg.scaffold.length > 8000) errors.push('code scaffold must be text up to 8,000 characters.');
      if (!record(target.flags) || Object.keys(target.flags).length !== 3 || ['paging', 'searching', 'ordering'].some(key => typeof target.flags[key] !== 'boolean')) errors.push('flags must contain boolean paging, searching, and ordering.');
      const menu = rule.criteria.find(c => c.answer?.kind === 'length_menu')?.answer.value;
      if (!Array.isArray(menu) || !menu.length || !menu.includes(target.pageLength) || menu.some(length => !lengths.includes(length)) || new Set(menu).size !== menu.length) errors.push('length_menu must contain unique allowed page lengths including page_length.');
    }
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
