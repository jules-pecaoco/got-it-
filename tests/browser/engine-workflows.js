async (page) => {
  page.setDefaultTimeout(15000);
  const checks = [];
  const check = (name, value) => { if (!value) throw new Error(name); checks.push(name); };
  const source = { name: 'quality-source.txt', mimeType: 'text/plain', buffer: Buffer.from('Search filters matching rows before pagination. Ordering arranges the matching rows. These fictional questions explain how table views respond to filtering, ordering and paging operations.') };
  await page.goto('http://127.0.0.1:3397/app/faculty');
  if (await page.locator('#instructor-login-panel').isVisible()) {
    await page.locator('#instructor-password').fill('product-audit-only');
    await page.locator('#instructor-login button[type=submit]').click();
  }
  await page.locator('#instructor-workspace').waitFor({ state: 'visible' });
  await page.locator('#new-activity').click();
  check('Question input supports200', await page.locator('#ai-questions').getAttribute('max') === '200');
  await page.locator('#ai-title').fill('Two hundred question browser proof');
  await page.locator('#ai-subject').fill('Fictional table concepts');
  await page.locator('#ai-kind').selectOption('quiz');
  await page.locator('#ai-question-mode').selectOption('objective');
  await page.locator('#ai-questions').fill('200');
  await page.locator('#ai-source').setInputFiles(source);
  await page.locator('#ai-generate').click();
  for (let batch = 1; batch <= 10; batch++) {
    if (batch < 10) {
      await page.waitForFunction(count => document.getElementById('ai-status').textContent.includes(`${count} / 200 saved`), batch * 20);
      check(`Batch ${batch} saved before pause`, await page.locator('#ai-job-resume').isVisible());
      if (batch === 1) {
        await page.reload();
        await page.locator('#ai-job-resume').waitFor({ state: 'visible' });
        check('Paused progress recovers after reload', (await page.locator('#ai-status').textContent()).includes('20 / 200 saved'));
      }
      await page.locator('#ai-job-resume').click();
      if (batch === 9) await page.reload();
    }
  }
  await page.waitForFunction(() => document.getElementById('ai-status').textContent.includes('200 questions ready'));
  check('All200 questions are reviewable', await page.locator('#ai-preview .ai-question').count() === 200);
  const first = page.locator('#ai-preview .ai-question').first();
  await first.locator('summary').filter({ hasText: 'Edit question' }).click();
  await first.locator('.ai-edit-form textarea').first().fill('Faculty wording survives reload.');
  await first.getByRole('button', { name: 'Save question', exact: true }).click();
  const reviewSaved = page.waitForResponse(response => response.url().endsWith('/api/instructor/ai/proposal') && response.request().method() === 'PUT' && response.request().postDataJSON().selected?.length === 1);
  await page.locator('#ai-preview .ai-question').first().getByRole('checkbox', { name: 'Approve question 1', exact: true }).check();
  await reviewSaved;
  await page.reload();
  await page.locator('#ai-preview .ai-question').first().getByText('Faculty wording survives reload.', { exact: true }).waitFor();
  check('Faculty approval survives reload', await page.locator('#ai-preview .ai-question').first().getByRole('checkbox', { name: 'Approve question 1', exact: true }).isChecked());
  check('Completed job does not overwrite faculty edits', await page.locator('#ai-preview .ai-question').count() === 200);
  await page.screenshot({ path: 'output/playwright/engine-200-review.png' });
  await page.locator('#ai-discard').click();
  await page.locator('#ai-title').fill('Cancelled batch proof');
  await page.locator('#ai-questions').fill('40');
  await page.locator('#ai-source').setInputFiles(source);
  await page.locator('#ai-generate').click();
  await page.locator('#ai-job-resume').waitFor({ state: 'visible' });
  await page.locator('#ai-job-cancel').click();
  await page.waitForFunction(() => document.getElementById('ai-status').textContent.includes('Generation cancelled'));
  check('Cancelled partial preview becomes editable', await page.locator('#ai-preview .ai-question').first().getByRole('checkbox', { name: 'Approve question 1', exact: true }).isEnabled());
  return checks;
}
