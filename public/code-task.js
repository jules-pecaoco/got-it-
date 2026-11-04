export const codingLanguages = Object.freeze([
  ['php', 'PHP'], ['python', 'Python'], ['sql', 'SQL (SQLite)'], ['javascript', 'JavaScript']
]);
export const codeLimit = 16000;
const text = (value, limit = codeLimit) => typeof value === 'string' && value.length <= limit;
export function validateCodeConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) return ['coding configuration required.'];
  if (Object.keys(config).some(key => !['language', 'starterCode', 'samples', 'comparison'].includes(key))) errors.push('coding configuration contains an unsupported field.');
  if (!codingLanguages.some(([name]) => name === config.language)) errors.push('coding language must be php, python, sql, or javascript.');
  if (!text(config.starterCode)) errors.push('starterCode must be a string of at most 16,000 characters.');
  if (!Array.isArray(config.samples) || config.samples.length < 1 || config.samples.length > 3 ||
    config.samples.some(sample => !sample || !text(sample.input) || !text(sample.output) ||
      Object.keys(sample).some(key => !['input', 'output'].includes(key)))) errors.push('provide 1–3 samples with only input and expected output strings.');
  const comparison = config.comparison;
  if (!comparison || !['exact', 'whitespace', 'numeric'].includes(comparison.mode)) errors.push('output comparison must be exact, whitespace, or numeric.');
  if (comparison && Object.keys(comparison).some(key => !['mode', 'absoluteTolerance', 'relativeTolerance'].includes(key))) errors.push('output comparison contains an unsupported field.');
  if (comparison?.mode === 'numeric' && ['absoluteTolerance', 'relativeTolerance'].some(key =>
    !Number.isFinite(comparison[key]) || comparison[key] < 0 || comparison[key] > 1000000)) errors.push('numeric output needs finite, nonnegative absolute and relative tolerances.');
  return errors;
}
export function validateCodeRule(config, rule) {
  const errors = validateCodeConfig(config);
  if (!text(rule?.referenceCode) || !rule.referenceCode.trim()) errors.push('a private reference solution is required (at most 16,000 characters).');
  if (!Array.isArray(rule?.criteria) || rule.criteria.length < 2 || rule.criteria.length > 6 ||
    rule.criteria.some(criterion => !text(criterion?.answer?.input) || !text(criterion?.answer?.output))) errors.push('coding questions need 2–6 test cases with input and output strings.');
  if (Array.isArray(config?.samples) && Array.isArray(rule?.criteria)) {
    if (config.samples.some(sample => !rule.criteria.some(test => test?.answer?.input === sample?.input && test?.answer?.output === sample?.output))) errors.push('every public sample must match a private test case.');
    if (!rule.criteria.some(test => !config.samples.some(sample => sample?.input === test?.answer?.input))) errors.push('include at least one additional private test input.');
    if (new Set(rule.criteria.map(test => test?.answer?.input)).size !== rule.criteria.length) errors.push('test inputs must be distinct.');
  }
  return errors;
}
const lineEndings = value => String(value).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
const numberToken = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
export function outputMatches(actual, expected, comparison) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  if (comparison.mode === 'exact') return lineEndings(actual) === lineEndings(expected);
  const tokens = value => value.trim() ? value.trim().split(/\s+/) : [];
  const left = tokens(actual), right = tokens(expected);
  if (left.length !== right.length) return false;
  return left.every((token, index) => {
    const wanted = right[index];
    if (comparison.mode !== 'numeric' || !numberToken.test(wanted) || !numberToken.test(token)) return token === wanted;
    const value = Number(token), target = Number(wanted);
    return Number.isFinite(value) && Number.isFinite(target) &&
      Math.abs(value - target) <= comparison.absoluteTolerance + comparison.relativeTolerance * Math.abs(target);
  });
}
export function comparisonText(comparison) {
  return comparison.mode === 'numeric'
    ? `Numeric values may differ by ${comparison.absoluteTolerance} plus ${comparison.relativeTolerance * 100}% of the expected value. Text and row order must match; whitespace may differ.`
    : comparison.mode === 'whitespace' ? 'Whitespace differences are ignored. Text, values, and order must match.'
      : 'Output must match exactly. Line endings and a final newline are ignored.';
}
