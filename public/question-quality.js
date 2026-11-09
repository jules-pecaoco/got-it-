const labelText = (value) => String(value ?? '').trim();

export function questionQualityIssues(question) {
  const issues = [];
  const options = Array.isArray(question?.options) ? question.options.map(labelText) : [];
  if (['single_choice', 'multiple_choice'].includes(question?.type) && options.length >= 2) {
    const answers = new Set(
      (Array.isArray(question.answer) ? question.answer : [question.answer]).map(labelText),
    );
    const lengths = options.map((value) => value.length);
    const correct = options.filter((value) => answers.has(value));
    const distractors = options.filter((value) => !answers.has(value));
    if (
      correct.some(
        (value) =>
          value.length >= 30 &&
          distractors.length &&
          value.length >= Math.max(...distractors.map((item) => item.length)) * 1.8 &&
          value.length - Math.max(...distractors.map((item) => item.length)) >= 20,
      )
    )
      issues.push(
        'The correct option is much longer than the distractors. Balance their detail and plausibility.',
      );
    if (Math.max(...lengths) > 1500) issues.push('An option is too long. Keep choices concise.');
    if (options.some((value) => /\b(?:all|none) of the above\b|\b(?:option|choice) [A-F]\b/i.test(value)))
      issues.push(
        'A choice refers to another choice position. Rewrite it so choices can be shuffled safely.',
      );
  }
  if (question?.type === 'sequencing') {
    if (options.some((value) => /^(?:(?:step|stage|phase)\s*\d+\b|\d+[.)]\s)/i.test(value)))
      issues.push('Sequence labels contain numbering that may reveal the answer. Use neutral labels.');
  }
  return issues;
}

export function minimalGeneratedQuestion(question) {
  if (!question || typeof question !== 'object') return question;
  const item = { ...question };
  if (item.type === 'datatable_code' && item.table && typeof item.table === 'object')
    item.table = { ...item.table, scaffold: '// TODO: create the table and apply the requested settings.\n' };
  if (
    item.type === 'web_project' &&
    item.files &&
    typeof item.files === 'object' &&
    !Array.isArray(item.files)
  ) {
    item.files = Object.fromEntries(
      Object.keys(item.files).map((name) => [
        name,
        name.endsWith('.php')
          ? '<?php\n// TODO: implement the behavior described in the question.\n'
          : name.endsWith('.html')
            ? '<!-- TODO: build the page described in the question. -->\n'
            : name.endsWith('.css')
              ? '/* TODO: style the page. */\n'
              : name.endsWith('.js')
                ? '// TODO: implement the requested interactions.\n'
                : name.endsWith('.json')
                  ? '{}\n'
                  : '',
      ]),
    );
  }
  if (item.type === 'sequencing' && Array.isArray(item.options) && Array.isArray(item.answer)) {
    const neutral = (value) =>
      typeof value === 'string'
        ? value.replace(/^\s*(?:(?:step|stage|phase)\s*\d+\s*[:.)-]?\s*|\d+[.)]\s+)/i, '').trim()
        : value;
    const options = item.options.map(neutral);
    if (
      options.every((value) => typeof value === 'string' && value) &&
      new Set(options).size === options.length
    ) {
      item.options = options;
      item.answer = item.answer.map(neutral);
    }
  }
  return item;
}
