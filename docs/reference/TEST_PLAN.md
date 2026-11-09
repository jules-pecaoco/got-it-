# Test and release plan

[Documentation contents](../README.md) · Reviewed against scripts and tests on 7 November 2026.

Use the commands below to verify the revision you plan to run. Historical pass counts belong to earlier revisions; a documentation update does not rerun application tests.

## Checks to run

| Command or procedure                                | What it checks                                                                                   | What it does not prove                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `npm run check`                                     | Type checking, JavaScript syntax, scoped formatting, editor build and automated regression tests | Real Docker behavior, live AI accuracy or classroom capacity |
| `npm run verify:coding`                             | Real installed language runtimes, input/output and sandbox limits                                | Acceptable throughput for a full class                       |
| `npm run verify:web`                                | Real frontend/PHP preview behavior, SQLite, assets and isolation                                 | Every possible student project or browser interaction        |
| `npm run verify:recovery` | Independent workspace lifetime after its Node owner exits, normal close, and expired-workspace detection | Off-host database recovery or whole-host failure |
| `npm run verify:console-recovery` | PHP and SQL console containers stop after their disposable Node owner is terminated | Recovery from a Docker engine or host failure |
| `npm run test:load:mixed` | Current autosaves, interactive terminals, preview POSTs/checkpoints/replacement, rejoin and manual-review finalization | Docker capacity in its default simulated mode |
| [Browser regression](../../tests/browser/README.md) | Maintained UI workflows against fictional in-memory records                                      | Live AI, real execution or deployment security               |
| Restore drill                                       | Verified snapshot, selected target, records and recovery                                         | Protection against host loss without off-host copies         |

The package's `check` command does not run the browser workflows or real-Docker verification. CI runs formatting, types, syntax and `npm test`, plus a separate execution/recovery job with pinned Docker images and a four-student mixed workflow; see [ci.yml](../../.github/workflows/ci.yml). Run builds and container/load checks outside active assessments.

## Current coverage

The current tests exercise grading rules, retry limits, deadlines, draft revisions, expiry settlement, idempotency, ownership, session isolation, queue recovery, material extraction and project archives. They also cover the following newer behavior:

- Console submissions wait for faculty grading; publication requires required manual review.
- Console sample transcripts remain separate from execution input/output.
- AI grade suggestions are bounded, advisory, owner-scoped and rejected after stale review; provider errors do not overwrite faculty grades.
- Grading reasons may be blank, while recovery reasons remain required.
- Run edits protect active deadlines. Run/activity deletion checks ownership, active attempts and pending grading, and preserves unrelated versions.
- Reference selection, editor state, terminal isolation and execution-service boundaries have dedicated coverage.

Fixtures are fictional and are not loaded during normal startup. Live provider answer quality is not established by mocked tests.

## Current load rehearsals

`npm run test:load` now verifies public preview execution and console submissions pending manual review, rather than expecting automatically awarded points. `npm run test:load:mixed` additionally exercises repeated saves, live terminal input/output, PHP POSTs, durable snapshots, preview replacement, rejoin, finalization and hidden results. Both commands default to simulated execution and fictional in-memory records.

For an explicit real-Docker rehearsal on PowerShell or another shell, use:

```powershell
node --import ./src/runtime-temp.mjs --import tsx --experimental-sqlite scripts/load-test-mixed.mts --docker --students=8
```

Choose 1–80 fictional students. The mixed scenario runs at most eight workflows simultaneously to respect the default terminal limit; the automated capacity regression separately verifies all 80 preview slots can replace their workspaces. Query timings include API calls; these short rehearsals do not replace a full-duration classroom pilot or public-network measurements. A simulated worker cannot establish Docker throughput. The historical automatic-grading results remain in [test history](../archive/TEST_HISTORY.md).

## Before a graded deployment

- Pass the applicable build/regression, real-runtime and browser checks on the intended revision and host.
- Configure institutional HTTPS, separate preview routing and restricted worker access where used.
- Complete authentication/roster and data-governance reviews, including the shared run-PIN/proctor model.
- Run a representative full-duration supervised pilot with the intended simultaneous terminal/preview load.
- Test expiry, interrupted jobs, restart/rejoin and off-host backup/restore.
- Review keyboard/assistive-technology access and deployment security on the actual lab browsers.
- Investigate the historical host-contention grading mismatch before relying on corresponding automated grading paths.

The default terminal capacity is eight, configurable only after measurement. Past screenshots and audit outcomes remain in [the archived UX report](../archive/APPLICATION_UX_AUDIT_2026-11-07.md); they do not certify every assessment or future revision.
