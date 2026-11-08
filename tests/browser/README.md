# Browser regression

[Documentation contents](../../docs/README.md) · [Test plan](../../docs/reference/TEST_PLAN.md)

Start the fictional in-memory fixture server:

`node --import ./src/runtime-temp.mjs --import tsx --experimental-sqlite tests/browser/fixture-server.mjs`

Open a fresh Playwright CLI session at http://127.0.0.1:3397/app/faculty, then run:

`playwright-cli -s=regression run-code --filename tests/browser/workflows.js`

Checks cover edit protection, Back navigation, pending grades, reauthentication, mobile geometry and runtime banners. No real assessment data, live AI or Docker execution is used. Stop the server after verification. Screenshots are written to output/playwright/.
