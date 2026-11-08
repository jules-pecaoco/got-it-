export function validateProject(project) {
  if (
    !project ||
    typeof project !== 'object' ||
    !project.files ||
    typeof project.files !== 'object' ||
    Array.isArray(project.files)
  )
    return ['Project files are required.'];
  const files = Object.entries(project.files);
  if (!files.length || files.length > 20) return ['Use 1–20 project files.'];
  if (!files.some(([name]) => name === 'index.php' || name === 'index.html'))
    return ['Include index.php or index.html.'];
  let total = 0;
  for (const [name, content] of files) {
    if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.(php|html|css|js|json|txt)$/.test(name) || name.length > 120)
      return ['Use relative PHP, HTML, CSS, JS, JSON or TXT filenames without dot segments.'];
    if (typeof content !== 'string' || content.length > 50000)
      return ['Each file must contain at most 50,000 characters.'];
    total += content.length;
  }
  if (total > 150000) return ['Project source exceeds 150,000 characters.'];
  if (
    project.database !== undefined &&
    (typeof project.database !== 'string' ||
      project.database.length > 1400000 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(project.database))
  )
    return ['Database snapshot is invalid or too large.'];
  if (Object.keys(project).some((key) => !['files', 'database'].includes(key)))
    return ['Unsupported project field.'];
  return [];
}
export function validateWebRule(config, rule) {
  const errors = validateProject({ files: config?.files });
  if (config?.seedSql !== undefined && (typeof config.seedSql !== 'string' || config.seedSql.length > 16000))
    errors.push('Database setup must contain at most 16,000 characters.');
  if (
    config?.expectedHtml !== undefined &&
    (typeof config.expectedHtml !== 'string' ||
      config.expectedHtml.length > 50000 ||
      /<script\b|<\?php/i.test(config.expectedHtml))
  )
    errors.push('Expected output must be static HTML/CSS up to 50,000 characters, without scripts or PHP.');
  for (const criterion of rule?.criteria ?? []) {
    const check = criterion.answer;
    if (!check || !['http', 'manual'].includes(check.kind)) {
      errors.push('Use HTTP checks or manual rubric criteria.');
      continue;
    }
    if (check.kind === 'manual') {
      if (typeof check.description !== 'string' || !check.description.trim())
        errors.push('Manual criteria need a description.');
      continue;
    }
    if (
      typeof check.path !== 'string' ||
      !/^\/[A-Za-z0-9_/?=&%.+\-]*$/.test(check.path) ||
      check.path.startsWith('//') ||
      check.path.length > 500 ||
      !Number.isInteger(check.status) ||
      check.status < 200 ||
      check.status > 599 ||
      typeof check.contains !== 'string' ||
      check.contains.length > 10000 ||
      (check.method !== undefined && !['GET', 'POST'].includes(check.method)) ||
      (check.body !== undefined && (typeof check.body !== 'string' || check.body.length > 16000))
    )
      errors.push('Invalid private HTTP check.');
  }
  if (!rule?.criteria?.length || rule.criteria.length > 10) errors.push('Provide 1–10 grading criteria.');
  return errors;
}

// Static reference only: no scripts, requests, forms, frames or navigation.
export function expectedOutputDocument(html) {
  const nonce =
    typeof document === 'undefined'
      ? ''
      : document.querySelector('meta[name="expected-output-style-nonce"]')?.content || '';
  // The parent permits only these style blocks; its script policy stays unchanged.
  if (/^[a-f0-9]{32}$/.test(nonce)) html = html.replace(/<style\b[^>]*>/gi, '<style nonce="' + nonce + '">');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'"></head><body>${html}</body></html>`;
}
export function appendExpectedOutput(target, config) {
  if (!config?.expectedHtml) return;
  const section = document.createElement('section');
  const heading = document.createElement('h4');
  heading.textContent = 'Example of the finished page';
  const frame = document.createElement('iframe');
  frame.title = 'Expected output reference';
  frame.className = 'web-preview';
  frame.setAttribute('sandbox', '');
  frame.referrerPolicy = 'no-referrer';
  frame.srcdoc = expectedOutputDocument(config.expectedHtml);
  section.append(heading, frame);
  target.append(section);
}
// Faculty editor for AI-generated web problems.
export function createWebQuestionEditor(activity) {
  const element = document.createElement('section');
  element.className = 'stack';
  const field = (label, value, tag = 'textarea', parent = element) => {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    const input = document.createElement(tag);
    input.value = value;
    input.spellcheck = false;
    if (tag === 'textarea') input.rows = 6;
    wrapper.append(input);
    parent.append(wrapper);
    return input;
  };
  const kind = field('Web workspace', '', 'select');
  for (const [value, label] of [
    ['frontend', 'Frontend (HTML, CSS, JS)'],
    ['php-web', 'PHP web app with SQLite'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    kind.append(option);
  }
  kind.value = activity.projectKind || 'frontend';
  const files = document.createElement('div');
  files.className = 'stack';
  element.append(files);
  const entries = [];
  const addFile = (name = '', source = '') => {
    const row = document.createElement('fieldset');
    row.className = 'stack';
    const filename = field('File name', name, 'input', row);
    const content = field('Starter code', source, 'textarea', row);
    const entry = { filename, content };
    entries.push(entry);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove file';
    remove.addEventListener('click', () => {
      entries.splice(entries.indexOf(entry), 1);
      row.remove();
      add.disabled = entries.length >= 20;
    });
    row.append(remove);
    files.append(row);
  };
  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = 'Add starter file';
  add.addEventListener('click', () => {
    addFile();
    add.disabled = entries.length >= 20;
  });
  for (const [name, source] of Object.entries(activity.files || {})) addFile(name, source);
  add.disabled = entries.length >= 20;
  element.append(add);
  const html = field('Example page · HTML/CSS, visible to students', activity.expectedHtml || '');
  const sql = field('SQLite setup SQL · PHP web app only', activity.seedSql || '');
  const rubric = field('Grading instructions · one item per line', (Array.isArray(activity.rubric) ? activity.rubric : []).join('\n'));
  return {
    element,
    read: () => ({
      projectKind: kind.value,
      files: (() => {
        const names = entries.map((entry) => entry.filename.value.trim());
        if (new Set(names).size !== names.length)
          throw new Error('Each starter file needs a different name.');
        return Object.fromEntries(entries.map((entry, index) => [names[index], entry.content.value]));
      })(),
      expectedHtml: html.value,
      seedSql: kind.value === 'php-web' ? sql.value : undefined,
      rubric: rubric.value
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    }),
  };
}
