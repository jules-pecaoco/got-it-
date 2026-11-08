# Reliability and performance audit — 8 November 2026

Implementation follow-up: the seven code findings below are addressed in the [resolution and verification report](../reference/RELIABILITY_RESOLUTION_2026-11-08.md). This audit preserves the original observations.

Reviewed revision: `c025b8c`, with a clean working tree at the start. This is an audit, not an implementation change. Application source, configuration, database access, execution services, browser save flows, operational scripts, CI and regression tests were reviewed. No classroom database or real student records were opened. All probes used fictional in-memory records, a fake execution worker, or disposable Docker workspaces.

The strongest existing safeguards are draft revision checks, transactional submissions, submission retry keys, durable coding jobs with recovery leases, explicit result publication, consistent SQLite backups, pinned runtime images, and constrained Docker execution. The main remaining risks concern preview database recovery, process/container lifecycle, and capacity under concurrent use.

## Verification results

| Check                                                                                                         | Observed result                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                                                               | Type checking and syntax passed. Formatting failed in `src/store-schema.mjs`, `src/routes/faculty.mjs`, `public/web-project.js`, and `src/ai-provider.mjs`; the combined command stopped before its test step. |
| `npm test`, with the existing local configuration and loopback access                                         | **176 passed, 1 failed**, of 177. The failure is described below.                                                                                                                                              |
| `npm test`, with `PREVIEW_ORIGIN`, `EXECUTION_ORIGIN` and `PUBLIC_ORIGIN` explicitly empty in the child shell | **177 passed, 0 failed**.                                                                                                                                                                                      |
| `npm run verify:coding`                                                                                       | Passed real JavaScript, Python, PHP and SQL checks, invalid-code rejection, time/output bounds, non-root execution and read-only root checks.                                                                  |
| `npm run verify:web`                                                                                          | Passed real PHP HTTP, SQLite CRUD, asset serving, filesystem boundary, recovery/reset, preview proxy and access-expiry checks.                                                                                 |
| `npm run test:load -- --students=1`                                                                           | Failed with `/api/me/coding-jobs/undefined: NOT_FOUND`, confirming the stale scenario even for one simulated student.                                                                                          |
| `npm audit --omit=dev --json`                                                                                 | Zero known production dependency vulnerabilities reported by npm. Development dependencies and container-image advisories were not scanned.                                                                    |
| Isolated preview/control-flow probes                                                                          | Reproduced full-capacity replacement rejection and reopening from an old browser database snapshot after expiry.                                                                                               |
| Disposable Docker lifecycle probe                                                                             | Confirmed a PHP workspace remains running after its owning application process exits without cleanup. The exact audit container was subsequently removed.                                                      |

Sandbox-only HTTP failures were excluded from the conclusions: loopback tests were rerun with network access. The build produced `workspaces.js` at **884.91 kB**, with Vite estimating **279.76 kB gzip**. No real-browser regression, full-duration classroom rehearsal, public-network measurement, or off-host restore drill was performed.

Local verification logs and reproducible probes are under `output/audit-*-2026-11-08.*`. That directory is ignored by Git; preserve those artifacts separately if sharing this report.

## Prioritized findings

### 1. High: preview expiry can restore an older database despite a newer persisted checkpoint

**Evidence:** `src/web-preview.mts:101`, `src/web-preview.mts:117`, `src/routes/student.mjs:180`, `web/WebWorkspace.vue:12`, `web/WebWorkspace.vue:65`.

The cleanup timer removes an expired preview and closes its workspace. Reopening can preserve database state only if the old preview still exists in the map. After cleanup, the web-preview route passes the browser's project directly to `open()` without recovering the database from the saved answer draft. The browser updates its database variable when it opens a preview; background server checkpoints do not update that variable.

The isolated probe created a newer server-side checkpoint, expired and removed the preview, and reopened using the unchanged browser project. The reopened workspace used the **older browser snapshot**, and the returned warning was **absent**. A subsequent save can replace the newer persisted database with this older state. This is a control-flow reproduction with a simulated worker, not a measurement of SQLite corruption.

**Improve:** resolve the most recent authoritative database snapshot on the server when reopening, with an explicit generation/revision. Preserve a final checkpoint before ordinary preview eviction where possible. Treat deliberate database reset and project import as explicit replacement operations so normal recovery does not undo them. Surface a warning when recovery is incomplete. Review project ZIP download at `web/WebWorkspace.vue:76` as well: it exports the browser database variable without first obtaining the latest preview snapshot.

**Acceptance:** mutate a preview database, checkpoint it, expire its workspace, reopen from the same browser, then verify records survive. Repeat across an application/worker restart and verify export contains the latest acknowledged state.

### 2. High: application termination leaves PHP containers outside the new process's capacity accounting

**Evidence:** `src/server.mjs:214`, `src/server.mjs:232`, `scripts/start-migration.mjs:13`, `scripts/serve-local.mjs:43`, `src/php-workspace.mts:31`, `src/php-workspace.mts:47`.

The application attaches cleanup to the HTTP server's `close` event, but does not install signal handlers that close the server and await workspace cleanup. The launchers terminate the child process. PHP workspaces run detached, and their PHP server has no container-wide wall-clock lifetime. The in-memory preview registry and its capacity counter disappear with the application process. `--rm` removes a container after that container exits; it does not tie its lifetime to the Node process.

A disposable real-Docker probe confirmed the container was still running after its application process exited. The probe removed only its own named container afterward. The remote execution worker has graceful-close handlers, but abrupt worker termination can still orphan these detached containers.

**Improve:** drain requests and checkpoint active work on normal shutdown, then await terminals, previews, queue shutdown and database close. Add a scoped execution-host instance identifier, independent container lifetime enforcement, and startup reconciliation for abandoned workspaces. Reconciliation must distinguish the current instance from other running instances; do not indiscriminately remove labeled containers on a shared Docker host.

**Acceptance:** demonstrate graceful stop, forced process termination, restart, and eventual container cleanup without deleting another instance's workspaces. Confirm resource accounting remains accurate after repeated restarts.

### 3. Medium: all 80 occupied preview slots prevent existing students from rerunning updated projects

**Evidence:** `src/web-preview.mts:113`, `src/web-preview.mts:135`, `src/execution-worker.mts:91`.

The preview capacity guard runs before looking up the student's existing workspace. Replacement starts a new workspace before removing the old one. With all 80 slots occupied, a student cannot replace their own preview, even though the intended steady-state workspace count would stay at 80. The isolated fake-worker probe reproduced `WEB_CAPACITY` for a replacement at exactly 80 occupied slots. The remote worker also has an 80-workspace guard, so an API-only guard adjustment would leave a second constraint.

**Improve:** design replacement capacity jointly in the API and worker. Options include safely updating the existing workspace or reserving bounded replacement headroom while keeping the old preview available until the new one is ready. Preserve its database before release.

**Acceptance:** fill the configured capacity and verify an existing student can rerun changed files. Verify a new student still receives a clear capacity response and concurrent replacements cannot exceed the intended resource budget.

### 4. Medium: results and autosave perform excessive synchronous database work

**Evidence:** `src/store.mjs:194`, `src/store.mjs:832`, `src/store.mjs:861`, `src/store.mjs:1074`, `src/store.mjs:1115`.

`results()` calls `hasPendingReview()` twice per session. Each call reloads and parses the assessment and looks up the latest submission question by question, even for objective-only assessments. Draft saving calls `missionView()` to check access, which also loads every question's submission, draft and attempt count.

The instrumented in-memory probe measured the following on this host, using a valid synthetic objective assessment with 40 questions and no submitted answers:

| Operation      | Students | Statement executions | Synchronous elapsed time |
| -------------- | -------: | -------------------: | -----------------------: |
| Results view   |       80 |                7,047 |                 25.40 ms |
| Results view   |      500 |               44,007 |                256.19 ms |
| One draft save |       80 |                  136 |                  0.99 ms |
| One draft save |      500 |                  136 |                  0.78 ms |

These are single local observations with statement-count instrumentation, not production percentiles or HTTP throughput measurements. They exclude real disk latency and realistic large answer payloads. The synchronous work occupies the same Node event loop that handles saves, admissions and terminal polling.

**Improve:** compute pending-review state for a run in grouped queries, calculate it once per session, skip unnecessary submission lookups for objective-only questions, and separate access validation from rendering complete mission responses. Reuse parsed immutable published assessments with ownership checks preserved; use revision-aware invalidation for drafts. Inspect query plans before adding indexes.

**Acceptance:** compare query counts and endpoint p95/p99 latency using the same assessment and realistic saved answers. Verify a faculty refresh does not cause student autosave latency spikes.

### 5. Medium: a busy preview can delay checkpointing and automatic expiry settlement for other students

**Evidence:** `src/web-preview.mts:56`, `src/web-preview.mts:182`, `src/attempt-settlement.mjs:43`, `src/server.mjs:217`.

Requests and snapshots join one promise chain per preview. That preserves consistency, but the pending request chain has no explicit queue length or total wait deadline. The checkpoint sweep visits sessions sequentially. The application's single `settling` flag remains set while it awaits the entire sweep, so subsequent automatic expiry ticks are skipped until the sweep finishes. A slow workspace or a burst of requests can therefore delay settlement across the class. Remote calls have a 20-second timeout individually; the full sweep has no equivalent total bound.

This is a source-supported scheduling risk; a representative classroom stall was not induced during this audit. Server-side deadline checks still reject late answers, so delayed settlement should not be described as granting extra answer time.

**Improve:** bound preview backlog and reject excess work, prioritize checkpoints, add per-session budgets, and run checkpointing separately from expiry scheduling. Use small bounded concurrency across independent sessions while retaining serialization within a workspace. Expose checkpoint age and settlement lag, including errors, to operations.

**Acceptance:** hold one student's preview busy and verify another student's expired attempt settles within the agreed deadline. Verify consistent SQLite snapshots during concurrent preview writes.

### 6. Medium: the standard release command is red, and test behavior depends on deployment settings

**Evidence:** `src/config.mjs:10`, `src/server.mjs:24`, `tests/audit-fixes.test.mjs:55`, `package.json:29`.

The four formatting failures prevent `npm run check` from reaching its regression step. Separately, `loadConfig()` loads the project's `.env` even in test mode. A configured preview origin disables automatic Store settlement, while the expired-attempt publication regression expects that behavior. With local settings, the suite reported 176/177 and `ATTEMPT_IN_PROGRESS`; with deployment origins explicitly empty in the child shell, all 177 passed. This demonstrates test-environment leakage, not evidence that the corresponding production HTTP route is broken.

**Improve:** resolve formatting and introduce a deliberate test configuration that does not implicitly import deployment credentials/origins. Configure external-service tests explicitly. Continue running real Docker and browser verification separately, or add an appropriate dedicated CI job.

**Acceptance:** the documented check command passes on a clean checkout and on a developer machine with production-like `.env` settings, without using real external services.

### 7. Medium: the available load rehearsal models the previous grading workflow

**Evidence:** `scripts/load-test-local.mjs:56`, `scripts/load-test-local.mjs:62`, `scripts/load-test-local.mjs:67`, `docs/reference/TEST_PLAN.md`.

The load script submits console code, assumes a `jobId`, then expects automatically earned points. Console submissions now save work for manual faculty review and do not supply that asynchronous grading receipt. A one-student simulated run failed with `/api/me/coding-jobs/undefined: NOT_FOUND`. The documentation correctly acknowledges this mismatch. The script also does not model the main present-day load: interactive terminal use, repeated autosaves, PHP requests, checkpoints and faculty/proctor refreshes.

**Improve:** replace the scenario with the current workflow before using it to select deployment size or student limits. Add synchronized starts and deadlines, realistic think time, terminal input/output, preview renewal at capacity, connection interruption, worker outage, application restart and recovery verification. Track accepted-answer correctness as well as latency.

**Acceptance:** the rehearsal completes against current behavior, distinguishes simulated execution from real Docker, and produces usable throughput, tail-latency, resource and recovery results.

## Other improvement opportunities and decisions

| Topic                 | What to decide or improve                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classroom capacity    | Agree on simultaneous students, terminal users and PHP previews, plus an acceptable wait policy. The local Docker daemon reports 4 CPUs and approximately 7.65 GiB RAM. Eight live terminals is the default; 80 PHP previews at their individual 128 MiB limits allow up to 10 GiB collectively, before the app, terminals and replacement workspaces. These are limits, not measured reservations or a capacity guarantee. Use a representative rehearsal before raising limits.                              |
| Backup and recovery   | Choose an acceptable recovery point and recovery time. `serve:local` schedules hourly full snapshots; ordinary `npm start` does not. Maintenance commands use the configured source database, whereas normal startup uses its migration target. The documentation explains this, but the CLI still permits backing up the wrong existing file. Prefer one explicit active-database resolver and a visible active-path check. Add verified off-host copies, retention, disk-pressure alerts and restore drills. |
| Student identity      | Joining/resuming uses school ID plus a shared run PIN, and resuming rotates the session token. Decide whether this meets the institution's identity requirements or needs individual admission secrets/SSO and an explicit takeover/recovery policy. The failed-login limiter checks failures after credential evaluation; do not treat its 429 responses alone as proof that further PIN guesses are no longer evaluated (`src/server.mjs:78`).                                                               |
| Delivery speed        | The editor bundle is loaded through a static import on the student page, including for objective-only work. Consider loading it when a coding workspace is needed and splitting language support. The application's asset responses do not compress content; verify compression at the actual proxy or add precompressed asset delivery. Preserve correct invalidation when changing cache policy.                                                                                                             |
| Operations visibility | Existing metrics are useful but process-local and limited. Add terminal/workspace counts and rejection rates, orphan counts, queue retries, last successful backup, checkpoint age, settlement lag, disk usage and latency windows. Readiness currently tests `SELECT 1`; expose execution/backup health separately so an optional AI outage does not unnecessarily remove the assessment API from service.                                                                                                    |
| Service recovery      | Define handling for unexpected clean child exits as well as crashes. `serve:local` does not restart a child that exits with code zero. On Windows, validate stop/restart of the launcher and its child with the intended service manager. Test resource cleanup and records recovery together.                                                                                                                                                                                                                 |
| Data governance       | Agree on retention for answers, source text, drafts, audit events and full database snapshots; who can access exports; and when material may be sent to the selected AI provider. Local snapshots contain private grading data and require the same access care as the active database.                                                                                                                                                                                                                        |
| Maintainability       | Core behavior remains in a large `store.mjs` and large page scripts. Current TypeScript coverage focuses on `.mts`/Vue; `checkJs` is false. Gradually add typed contracts around admission, drafts, settlement and grading, and split those responsibilities after protecting their behavior with meaningful integration checks. A framework or database replacement is not needed to address the measured query multiplication first.                                                                         |

## Recommended sequence

1. Fix database recovery on preview reopening and add expiry/restart coverage. Include the stale project-export path in that review.
2. Implement graceful application shutdown and scoped orphan reconciliation with independent workspace lifetimes.
3. Restore a green, isolated check command and replace the stale load scenario.
4. Fix replacement capacity, remove repeated database lookups, and separate checkpoint scheduling from expiry scheduling.
5. Agree on class size, identity policy and recovery objectives; rehearse the actual deployment and complete an off-host restore drill before consequential graded use.

The existing regression and Docker checks establish useful functional coverage. They do not yet establish classroom capacity or uninterrupted recovery under the combined workload described above.
