async (page) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole('checkbox', { name: 'Flag for review', exact: true }).check();
  await page.locator('#ibt-filter').selectOption('flagged');
  if (await page.locator('#ibt-question-list button').count() !== 1) throw new Error('Flag filter failed');
  await page.reload();
  await page.locator('#fullscreen-fallback').waitFor({ state: 'visible' });
  await page.locator('#fullscreen-fallback').click();
  await page.getByRole('checkbox', { name: 'Flag for review', exact: true }).waitFor();
  if (!await page.getByRole('checkbox', { name: 'Flag for review', exact: true }).isChecked()) throw new Error('Review flag lost on refresh');
  await page.locator('#ibt-review').click();
  await page.getByRole('button', { name: 'Question 1 · Flagged' }).waitFor();
  await page.getByRole('button', { name: 'Keep working' }).click();
  const question = await page.locator('#ibt-context').boundingBox();
  const answer = await page.locator('#exam-workspace').boundingBox();
  if (question.y >= answer.y || Math.abs(question.x - answer.x) > 1) throw new Error('Question and answer are not stacked');
  await page.locator('#ibt-divider').focus();
  const before = await page.locator('#ibt-divider').getAttribute('aria-valuenow');
  await page.keyboard.press('ArrowDown');
  if (await page.locator('#ibt-divider').getAttribute('aria-valuenow') === before) throw new Error('Keyboard resizing failed');
  await page.screenshot({ path: 'output/playwright/student-exam-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Mobile overflow');
  await page.screenshot({ path: 'output/playwright/student-exam-mobile.png' });
  return { flagPersistence: true, flaggedReview: true, stackedPanes: true, keyboardResize: true, mobileFits: true };
}
