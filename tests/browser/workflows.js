async (page) => {
  const results = [];
  const check = (name, pass) => {
    if (!pass) throw new Error(name);
    results.push({ name, pass: true });
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:3397/app/faculty');
  if (await page.locator('#instructor-login-panel').isVisible()) {
    await page.locator('#instructor-password').fill('product-audit-only');
    await page.locator('#instructor-login button[type=submit]').click();
  }
  await page.locator('#instructor-workspace').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Activities', exact: true }).click();
  await page
    .locator('#exam-library article')
    .filter({ hasText: 'Input and output practice' })
    .getByRole('button', { name: 'Continue draft' })
    .click();
  await page.locator('#exam-title-input').fill('Protected draft name');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  check(
    'Unsaved name survives Refresh',
    (await page.locator('#exam-title-input').inputValue()) === 'Protected draft name',
  );
  await page.locator('#exam-title-input').fill('Input and output practice');
  await page.locator('#review-edit-rules').click();
  const duration = page.locator('#policy-editor input[type=number]').first();
  const original = await duration.inputValue();
  await duration.fill('55');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  check('Unsaved rules survive Refresh', (await duration.inputValue()) === '55');
  await duration.fill(original);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Classes', exact: true }).click();
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  await page.goBack();
  check('Browser Back restores Classes', page.url().includes('workspace=classes'));
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  const run = await page
    .locator('#results-run option')
    .filter({ hasText: 'Programming fundamentals' })
    .getAttribute('value');
  await page.locator('#results-run').selectOption(run);
  await page.getByText('Awaiting grade', { exact: true }).first().waitFor({ state: 'visible' });
  check('Pending manual grades are explicit', true);
  await page.route('**/api/instructor/runs/*/results', (r) =>
    r.fulfill({ status: 401, json: { ok: false, code: 'UNAUTHORIZED', message: 'Session expired' } }),
  );
  await page.getByRole('button', { name: 'Refresh results', exact: true }).click();
  await page.locator('#instructor-login-panel').waitFor({ state: 'visible' });
  await page.unroute('**/api/instructor/runs/*/results');
  await page.locator('#instructor-password').fill('product-audit-only');
  await page.locator('#instructor-login button[type=submit]').click();
  await page.locator('#instructor-workspace').waitFor({ state: 'visible' });
  check('Reauthentication restores workspace', true);
  await page.route('**/api/me/code/status', r => r.fulfill({json:{ok:true,data:{available:false,docker:'unavailable',languages:[],webPreviewConfigured:false,message:'Execution is temporarily unavailable.'}}}));
  await page.goto('http://127.0.0.1:3397/app/student');
  await page.addInitScript(() =>
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => false }),
  );
  await page.reload();
  if (await page.locator('#join-panel').isVisible()) {
    await page.locator('#join-run').fill(run);
    await page.locator('#candidate-id').fill('AUDIT-001');
    await page.locator('#run-pin').fill('4242');
    await page.locator('#join-form button[type=submit]').click();
    await page.locator('#begin-attempt').click();
  }
  await page.locator('.cm-editor').waitFor({ state: 'visible' });
  await page.locator('#request-status').waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 390, height: 844 });
  const editor = await page.locator('.cm-editor').boundingBox();
  check('Editor starts within mobile viewport', editor.y < 700);
  check(
    'Mobile page does not overflow horizontally',
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await page.locator('#student-runtime-status').waitFor({state:'visible'});
  check('Runtime banner remains visible', await page.locator('#student-runtime-status').evaluate(e => { const b=e.getBoundingClientRect(); return !!document.elementFromPoint(b.x+b.width/2,b.y+10)?.closest('#student-runtime-status'); }));
  await page.screenshot({ path: 'output/playwright/fixed-student-mobile.png' });
  return results;
}
