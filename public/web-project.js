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
