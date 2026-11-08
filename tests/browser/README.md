# Browser regression

[Documentation contents](../../docs/README.md) · [Test plan](../../docs/reference/TEST_PLAN.md)

Start the fictional in-memory fixture server:

`node --import ./src/runtime-temp.mjs --import tsx --experimental-sqlite tests/browser/fixture-server.mjs`

Open a fresh Playwright CLI session at http://127.0.0.1:3397/app/faculty, then run:

`playwright-cli -s=regression run-code --filename tests/browser/workflows.js`

Against a fresh fixture server, faculty grading retention and filtered navigation can also be checked with:

`playwright-cli -s=grading run-code --filename tests/browser/faculty-grading.js`

Open that browser session at the fixture origin first. These checks cover navigation/close retention, failed saves, explicit saving, and exclusion of in-progress students from a submitted-only review queue.

Checks cover edit protection, Back navigation, pending grades, reauthentication, mobile geometry and runtime banners. No real assessment data, live AI or Docker execution is used. Stop the server after verification. Screenshots are written to output/playwright/.

After `workflows.js` has opened the student attempt, run `tests/browser/student-exam-layout.js` in the same browser session to check persisted review flags, flagged-question review, stacked task panes, keyboard resizing, and mobile fit.
