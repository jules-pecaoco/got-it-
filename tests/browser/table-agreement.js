async (page) => {
  page.setDefaultTimeout(15000);
  const checks = [];
  const check = (name, value) => { if (!value) throw new Error(name); checks.push(name); };
  const runId = await page.evaluate(async () => {
    const { browserSessionHeaders } = await import('/browser-session.js');
    const response = await fetch('/api/instructor/runs', { headers: browserSessionHeaders('instructor') });
    return (await response.json()).data.find(run => run.name === 'Table agreement').id;
  });
  await page.addInitScript(() => Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => false }));
  await page.goto('http://127.0.0.1:3397/app/student');
  await page.locator('#join-run').fill(runId);
  await page.locator('#candidate-id').fill('AUDIT-001');
  await page.locator('#run-pin').fill('4242');
  await page.locator('#join-form button[type=submit]').click();
  await page.locator('#begin-attempt').click();
  if (await page.locator('#fullscreen-fallback').isVisible()) await page.locator('#fullscreen-fallback').click();
  const script = "const table = new DataTable('#studentTable', {paging:true,searching:true,ordering:true,pageLength:2,lengthMenu:[2,5,10],order:[[0,'asc']]}); table.search('Alex BSIT').draw(); table.column(1).search('BSIT').draw();";
  await page.getByRole('textbox', { name: 'DataTables JavaScript', exact: true }).fill(script);
  await page.getByRole('button', { name: 'Run code in preview', exact: true }).click();
  await page.getByText('Code applied to DataTables preview.', { exact: true }).waitFor();
  const names = await page.locator('.code-preview tbody tr td:first-child').allTextContents();
  check('Smart search matches words across columns', JSON.stringify(names) === JSON.stringify(['<b>Alex</b>', 'Alex Quinn']));
  check('Table cells render as text', await page.locator('.code-preview tbody b').count() === 0);
  const submitted = page.waitForResponse(response => /\/api\/me\/activities\/[^/]+\/submit$/.test(response.url()) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Submit answer', exact: true }).click();
  const data = (await (await submitted).json()).data;
  check('Browser script earns all grading criteria', data.result === 'correct' && data.score === 10);
  await page.screenshot({ path: 'output/playwright/engine-table-agreement.png' });
  return checks;
}
