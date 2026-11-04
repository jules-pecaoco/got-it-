# Got It! system audit and migration plan

Date: 4 November 2026. Scope: current working tree, including existing uncommitted changes. StudentID and PIN are accepted design constraints; every assessment has a proctor. This report proposes changes; no application implementation or assessment records were changed.

## Executive assessment

### Confirmed policy decisions — follow-up

- Preserve the most recent answer/draft across interruptions. Server persistence covers acknowledged saves; recovery of edits during a client disconnect requires local draft persistence and reconnection synchronization. Server failure recovery additionally requires durable storage/backups. Do not describe these as equivalent guarantees.
- Graded scores require explicit faculty publication; run closure must not automatically release them. This changes current release behavior and requires server/API/browser regression coverage.
- At expiry, include submitted answers and saved drafts in grading. For a question with both, the recommended interpretation is to grade its latest acknowledged draft as a final submission, then retain accumulated criterion awards according to the existing scoring policy. Confirm replacement precedence if another interpretation is intended. Finalization must be idempotent and infrastructure failures must not consume retries.
- One faculty member manages each assessment; multiple faculty may manage different classes. Model faculty ownership and enforce it on every assessment, class, run, result, export and mutation. Collaborative authoring is unnecessary. The current shared faculty access is insufficient for ownership isolation if multiple faculty use the same deployment.

### External code editor workflow

Recommended: retain an optional browser editor, add **Download starter file** and **Upload solution**, and permit students to edit/run locally in their preferred editor. Scaffold export must contain only public instructions, starter code, sample tests/input, and a README describing language/runtime and submission requirements. Never export private test fixtures, answer keys or reference solutions. A website cannot reliably open an arbitrary installed editor; downloads and file selection are the portable workflow.

On upload, validate extension, bytes, encoding and configured language; treat source as text, show a preview, and persist it as the latest draft with an acknowledgement before allowing submission. Do not execute uploaded programs in the API process. Start with one source file per coding question and a documented UTF-8 contract. Multi-file projects and ZIP uploads require a separate contract, archive safety controls and entry-point rules. Preserve a consistent runtime specification to reduce differences between local tests and assessment grading.

Editing and execution are separate decisions:

1. **Preferred editor plus automatic grading:** students work locally and upload source. A protected server worker or external judge still executes it against private tests; the application owns receipts and score awards. Local execution does not establish a trustworthy grade.
2. **No platform execution:** upload source for faculty/manual rubric grading, optionally supplemented by a proctor demonstration. Store the submission as pending review, support criterion-level marking, and publish only after grading completes. This removes automatic coding feedback and changes the current coding workflow.
3. **External judge:** delegate execution through a server-side adapter with authenticated requests, result correlation, idempotency, timeouts and outage handling. The institution must evaluate privacy, cost, supported runtimes and service reliability. Never trust a browser-submitted pass/fail report.

Important recovery boundary: the website cannot recover edits that exist only in an external editor and were never uploaded. Tell students to save locally and upload checkpoints; show the last acknowledged upload time/version. Uploading a checkpoint should save a draft without consuming a graded retry. At expiry, grade the last accepted upload/draft, never claim to collect the local file automatically.

Confirmed requirements from the owner: 40–80 simultaneous students, virtual machine/server hosting, one maintainer, TypeScript preference, and retained accumulated-criteria scoring. Outage support is desired; whether this means loss of internet, LAN, or the server still needs clarification. These requirements favor a small TypeScript deployment with one API and SQLite initially, plus a separately isolated execution worker when capacity/security warrants it. PostgreSQL is a growth option rather than the default first migration. Keep accumulated-criteria scoring and document it; do not change it to latest-answer scoring.

The application has a credible assessment core: server-owned grading and deadlines, immutable published packages, roster snapshots, transactional score awards, submission idempotency, separated role APIs, and isolated code execution. Its main limitations are operational maturity, implicit grading rules, coupling between features, and coding throughput. A rewrite would risk losing working behavior without resolving those issues automatically.

Recommended direction: incrementally adopt TypeScript, Fastify, and Vue 3 with Vite; retain a modular monolith for the application and separate code execution into a worker. Keep SQLite for a measured single-host pilot. Introduce PostgreSQL when concurrent classes, multiple application instances, or independent workers justify it. Team expertise may change the frontend or backend choice.

## Evidence and limits

- Reviewed README, existing audit and deployment/security documentation, HTTP/session handling, store/schema, grading and coding execution, queue, materials extraction, backup, load harness, browser modules, and CI.
- The full suite passed: **104 tests, 104 passes**. The first restricted run had 80 passes and 24 HTTP connection failures, including explicit loopback EACCES. Repeating with permitted local connectivity passed all tests. Logs: `artifacts/audit-2026-11-04-tests.txt` and `artifacts/audit-2026-11-04-tests-permitted.txt`.
- The earlier audit contains historical findings already fixed. Those should not be reported as fresh defects.
- No live student database inspection, deployed-host penetration test, browser accessibility audit, live AI request, real Docker capacity measurement, or full-duration classroom rehearsal was performed in this audit. Passing automated tests does not establish those properties.
- Existing caching, prepared-statement caching, batch results aggregation, WAL, extraction limits, CSV escaping, and queue persistence were observed. They are existing improvements, not missing features.

## 1. Improvements, accepting supervised student admission

| Priority | Evidence / current behavior | Improvement and acceptance condition |
|---|---|---|
| Before graded pilot | `src/config.mjs` enables demo mode unless explicitly disabled; documented fallback faculty password exists. | Make production configuration explicit and fail closed. Deployment checks must reject demo mode and missing HTTPS origin. A production launch must not silently seed demos. |
| Before graded pilot | Faculty authentication is shared and audit actors are generic, such as `instructor` and `ai-faculty`. | Add individually identified faculty accounts and scoped permissions; record the authenticated actor on changes. This is independent of retaining student PIN/StudentID. Staff SSO is optional where available. |
| Before graded pilot | API run creation defaults omitted `feedbackMode` to Practice (`src/store.mjs`), while Faculty defaults to Graded. | Require an explicit feedback mode on new API contracts, or adopt a versioned Graded default. Preserve existing run values. Verify omitted mode cannot accidentally expose correctness in a new graded workflow. |
| Before graded pilot | `saveDraft` persists only before a first submission; mission loading restores a draft only when no submission exists. | Persist revisions separately from the last submitted answer, with revision numbers. Show saved draft, submitted answer, and graded answer distinctly. Test submit → revise → refresh → recover without changing the grade. |
| Before graded pilot | Score awards accumulate unique criteria across submissions rather than representing only the latest answer. | Make scoring policy explicit per published assessment: accumulated criteria, best whole submission, or latest submission. Keep historical policies immutable. Verify partial credit, penalties, overrides, and CSV against worked examples. |
| Before graded pilot | Scores may release automatically at run close; completion of a section means every question was submitted, not necessarily correct. | Document and obtain faculty agreement on both policies. Offer explicit publication policy and mastery prerequisites only where pedagogically required. Preserve current runs. |
| Before graded pilot | Verified SQLite backup exists; restore is an operator procedure. | Add scheduled off-host backups, retention, restore instructions and a timed restore drill. Verify restored submissions, deadlines, pending jobs, and grade totals, not just database integrity. Set recovery objectives with the institution. |
| Before graded pilot | Proctor monitoring shows participation and submission timing, not proof of an active browser. | Add a clearly labeled last-seen heartbeat and connection-stale state if operationally useful. Never equate stale connectivity with misconduct. Add incident notes and a documented faculty handoff for recovery. |
| Next | Browser fullscreen and text-selection restrictions are deterrents. | Prioritize keyboard access, screen readers, zoom, accommodations and reliable recovery over stronger browser restrictions. Test code, matching and sequencing controls manually with assistive technologies. |
| Next | AI source-match percentages are advisory; source text and draft answers go to the provider. | Label percentages as estimates rather than probabilities of correctness. Require rubric review, keep provider/model provenance, and define permitted source material. Keep AI availability outside the active exam dependency path. |

A proctor workflow should cover identity check, approved seat/device changes, stale connections, accidental finalization, server interruption, and incident recording. The system should support the proctor's decisions with evidence and audited faculty actions. This audit does not recommend changing student admission credentials.

## 2. Optimization

### Measure the actual bottleneck

Measure request p50/p95/p99 by endpoint, event-loop delay, CPU, memory, database latency, lock waits, queue depth, oldest queued age, execution duration, and infrastructure failures. Never log answers, codes, PINs, cookies or private test content in general request logs.

Suggested initial objectives to validate with faculty: p95 ordinary save under 500 ms on the intended network; p95 receipt acknowledgement under one second; no lost acknowledged submissions or duplicate retry charges. These are proposed targets, not measured results or guarantees. Coding completion needs its own objective derived from real hardware and test count.

### Coding throughput is the largest predictable capacity risk

`src/coding-queue.mjs` defaults to two active jobs and capacity 160, permits one pending job per student, and prioritizes submissions over previews. `evaluateCode` launches a new container for every criterion sequentially. Approximate drain time for a burst is:

`students × average whole-job seconds / active jobs`

For illustration only, 80 students, five private tests, and one second per container/test imply about 200 seconds to drain two workers, before extra overhead. Measure rather than treating this example as a benchmark.

1. Benchmark real Docker with realistic languages, test counts, timeouts and simultaneous students. The default simulated load test verifies coordination and scores; it does not measure Docker capacity.
2. Move execution away from the API host. Preserve the accepted-at receipt, idempotency and server-owned scoring.
3. Add worker leases, atomic claims, attempt counts, bounded infrastructure retries, heartbeat/lease expiry, and cancellation policy. Keep infrastructure failures separate from incorrect answers.
4. Do not run multiple current queue owners against one database: each constructor requeues all running jobs, while claim selection and update rely on one process. A second owner can duplicate execution or disrupt another owner's work.
5. Cap active containers by measured memory/CPU headroom. Raising concurrency without measurement may make every job slower.
6. Consider running multiple test processes inside one fresh submission container only after checking isolation between tests. Never reuse a writable sandbox across students or allow one test to contaminate another.
7. Give previews a bounded share of capacity so they do not starve indefinitely during submission bursts; graded receipts still take priority near deadlines.

### API, browser and persistence

- Synchronous SQLite calls block the API event loop while running. Profile slow queries and extraction before choosing a new database solely for speed.
- Cache parsed immutable published packages by version/content hash. Keep candidate authorization and mutable progress outside that cache, and never leak private objects into response DTOs.
- Inspect query plans for frequently polled progress, session views and grade totals. Add indexes only where measured plans justify them. Results already batch score aggregation; preserve that implementation.
- Add server pagination/search for large faculty lists and roster/result responses where payload measurements justify it. Avoid returning entire historical collections on every navigation.
- Debounce drafts, skip unchanged payloads, serialize per-answer writes, and reject stale revisions. Jitter polling and reduce polling for hidden tabs. Preserve a manual refresh path.
- Start with polling; consider Server-Sent Events for one-way run/queue updates if measurements show polling is material. Authenticate each stream and limit reconnection rates. WebSockets are unnecessary unless bidirectional real-time behavior is required.
- Move CPU-heavy material extraction to a bounded worker. Existing byte/page/text/uncompressed-size limits are valuable; add execution-time and concurrent-job bounds.
- Existing assets have ETags and cached bytes. Add deployment-managed compression and immutable caching only for fingerprinted build assets; keep authenticated/API responses private and uncached.
- Define cleanup/retention for completed coding payloads, expired sessions, proposals, logs and backups. Protect assessment history needed for appeals.

## 3. Framework and technology recommendation

This is a fit assessment for this repository, not a universal ranking.

| Choice | Fit and tradeoff | Recommendation |
|---|---|---|
| TypeScript + Fastify | Preserves Node ecosystem and grading code; gives explicit routes, hooks, validation and response schemas with incremental adoption. Requires discipline for module boundaries. | Preferred backend given current code and unknown team skills. |
| NestJS | Useful for teams that benefit from enforced dependency-injection/module conventions; more ceremony and migration work. | Prefer if the maintenance team already knows it or needs those conventions. |
| Laravel | Reasonable for an established PHP team with institutional hosting support, but requires backend/grading porting and behavior parity work. Student PHP support is not a reason to port the application. | Choose for team/hosting fit, not as an automatic upgrade. |
| Django | Reasonable for an established Python team needing administrative workflows; also requires backend porting and parity work. | Conditional alternative. |
| Vue 3 + Vite + TypeScript | Componentizes the large Faculty/Student pages while keeping a straightforward SPA deployment. | Preferred UI if the team has no strong existing preference. |
| React + Vite + TypeScript | Also suitable; migration success depends more on state and component design than this choice. | Prefer if maintainers already know React. |
| SQLite | Low operational cost; appropriate for a measured single-host deployment. Current synchronous calls and queue ownership constrain expansion. | Retain for the first pilot unless measured limits require change. |
| PostgreSQL | Better fit for independent workers and multiple API instances, with explicit transactions and concurrent row operations. Adds hosting, migration and restore responsibilities. | Target for institutional growth, not a mandatory first step. |

Do not add SSR, Kubernetes, a distributed cache, or many services without a requirement. The main UI is authenticated and interactive. One application plus one execution worker is an appropriate initial boundary. A PostgreSQL jobs table can be enough; add a broker only when delivery/rate/scale needs justify its operations.

Fastify supports JSON Schema request validation and response serialization; use application-owned schemas, not untrusted uploaded schemas: [official documentation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/). Vue documents shared-state patterns and Pinia for larger applications: [official guide](https://vuejs.org/guide/scaling-up/state-management). PostgreSQL documents MVCC and explicit locking, which still require correct application transactions: [official documentation](https://www.postgresql.org/docs/18/mvcc-intro.html).

Pin the deployed Node version and verify the SQLite API status for that exact version. The tested checkout emits an experimental warning; runtime stability should not be inferred from a different Node release's documentation.

### Migration sequence and gates

Indicative effort: 8–14 engineer-weeks for an experienced full-time developer, subject to discovery; institutional authentication, hosting procurement, accessibility remediation and new product features can extend this. Do not commit dates until scale, team and operating requirements are answered.

| Phase | Work | Exit gate |
|---|---|---|
| 0: baseline, about 1 week | Inventory workflows, settle grading/release policies, preserve current tests, anonymize fixtures, define capacity/recovery targets and architecture decisions. | Reproducible baseline, documented policies, verified backup and restore. |
| 1: boundaries, 1–2 weeks | Add TypeScript gradually, extract pure domain functions and public/private contracts, introduce repository/runner/clock interfaces. | Existing behavior passes unchanged; dependency rules prevent private grading entering browser bundles. |
| 2: HTTP migration, 1–2 weeks | Replace native routing with Fastify route modules behind existing URLs; preserve cookies, origin checks, role checks, status codes, errors and idempotency. | Old/new API contract comparisons and role isolation tests pass on fictional data. |
| 3: UI migration, 2–4 weeks | Migrate one role/page at a time; reusable editors, explicit draft/submission state and typed API client. Start with Proctor, then Faculty, then Student. | Keyboard and browser workflow tests pass, including refresh/rejoin and failed-save recovery. No active run changes frontend mid-attempt. |
| 4: execution worker, 1–2 weeks | Durable atomic job claims, leases, bounded retries, authenticated worker boundary, isolated execution host, metrics. | Worker kill/restart and deadline-boundary tests preserve receipts and award scores once. Real Docker load meets the chosen target. |
| 5: database if needed, 1–2 weeks | Implement PostgreSQL adapter and numbered migrations; migrate a backup into staging, reconcile identities, counts, JSON and scores. | Repository tests pass on both stores; representative results and exports match exactly. |
| 6: rollout, about 1 week | Full-duration proctored rehearsal, restore drill, runbooks, monitoring and controlled cutover between runs. | Operational owner signs off on agreed gates and recovery procedure. |

For PostgreSQL cutover: stop new joins and writes between runs, drain queued jobs, take a verified final backup, import, compare every run/session mapping and grade total, then switch traffic. Avoid dual writing for this scale. Retain the original database read-only. If the new system has accepted writes, rollback requires reconciling those writes; restoring an old snapshot blindly would lose acknowledged work.

## 4. Maintainability, extensibility and modularity

Current concentrations: `public/faculty.js` is about 2,232 lines, `public/student.js` 987, and `src/store.mjs` 983. Size alone is not a defect, but these files mix UI/workflow or persistence/domain responsibilities and increase the number of places each feature touches. Backend code also imports helpers from `public/`; shared code should live in an explicitly neutral package rather than the static directory.

Suggested structure:

```text
apps/api/src/modules/
  assessments/   # drafts, validation, publication, immutable versions
  classes/       # roster maintenance and delivery snapshots
  runs/          # scheduling, admission, settings
  attempts/      # timing, drafts, submissions, completion, recovery
  grading/       # grading policies, awards, penalties, overrides
  reporting/     # read models, exports, publication
  staff-access/  # staff identities, permissions, proctor scope
  materials/     # extraction, sources, AI proposals
apps/web/src/features/   # faculty, student, proctor workflows
apps/runner/src/         # isolated execution adapter and job handling
packages/contracts/     # public DTOs and runtime schemas
packages/grading/       # server-only evaluators/private contracts
packages/question-ui/   # public renderers, editors and answer inputs
```

Within each backend module, keep route validation, application use cases, pure rules and SQL adapters distinct. Use interfaces where a dependency is genuinely replaceable: repositories, clock, AI provider, runner and job dispatcher. Avoid a generic base repository or extensive dependency-injection machinery without a concrete use.

Build an explicit question-type registry. Public metadata, answer schema, renderer/editor and server evaluator should agree on a stable type identifier and contract version. Server-only evaluators and private rubrics must never be re-exported through a browser entry point. A new type should require a defined plugin/registration and contract tests, rather than edits to unrelated workflow switches.

Version both package format and grading algorithm. Retain published content hashes, scoring policy, runtime image digest and evaluator version so appeals can explain how a grade was produced. Preserve raw submissions; regrading should create a new audited result version rather than overwrite evidence silently.

Replace accumulated startup ALTER checks with numbered, tracked migrations. Back up before destructive changes and test upgrades from previous supported schemas. Add state-machine rules for attempts and jobs, with explicit transitions for recovery, expiry, pending evaluation and publication.

Expand CI from three-file formatting to changed application code; add linting, type checks, runtime contract validation, supported runtime tests and meaningful browser journeys. Retain current engine/store tests. Add failure tests for duplicate requests, stale drafts, restart after execution before acknowledgement, worker lease expiry, and public/private response separation. Include vendored browser libraries in the dependency inventory.

## 5. Other matters and open questions

1. What is the maximum simultaneous student count, concurrent run count, questions per exam and private tests per coding question? How bursty are coding submissions?
2. Is hosting a faculty laptop, school server, LAN-only machine or managed cloud? Who is responsible for operating it during an exam?
3. Must an exam continue during internet loss, local network loss, or server loss? These require different solutions. A cloud-hosted app cannot become offline-capable merely through browser caching.
4. Which languages/frameworks can the future maintainers confidently operate? Is there a deployment budget and institutional hosting restriction?
5. Should retry credit accumulate criteria, use the best whole submission, or use the latest submission? Can a question score become negative after penalties?
6. Should run closure automatically release scores, or should every graded result require explicit faculty publication? Are rubric explanations released separately?
7. Should deadlines finalize saved drafts, or should only explicitly submitted answers count? What should happen to revisions at expiry?
8. Should a pending coding receipt permit navigation/finalization, and what happens if its infrastructure retries outlast the run? Who resolves a permanently failed job?
9. Does the proctor need to record incidents, approve seat/device changes or request extensions? Which actions must remain faculty-only?
10. Are multiple faculty authors editing the same draft? If so, add optimistic concurrency/revision conflicts before real-time collaborative editing.
11. What accommodations are required: extra time, alternate formats, keyboard-only input, screen readers, mobile devices or different lab browsers?
12. What student fields are actually necessary? Who can export records, how long must submissions be retained, and how are appeals and deletion requests handled? Obtain institutional policy rather than assuming a retention period.
13. Are LMS grade export, roster synchronization, reusable question banks, item analytics or learning outcomes required? These change module boundaries and migration priorities.
14. What data-loss and outage duration are acceptable? Where will off-host backups live, and who has practiced restoring them?

Recommended immediate sequence: settle the three grading/release/draft policies; fix revision persistence and explicit feedback mode; establish deployment and restore gates; perform a realistic coding-capacity rehearsal; then extract module boundaries and migrate incrementally. Keep the supervised student admission model unchanged.

### Deployment refinement for the confirmed class size

For 40–80 students and one TypeScript maintainer, start with a Linux VM, supported pinned Node runtime, Fastify API, Vue/Vite frontend, SQLite on local persistent storage, HTTPS reverse proxy, process supervision, metrics, and off-host backups. Keep a single API/queue owner until worker coordination is replaced. Give the execution host no access to the application database, answer keys or server secrets; return execution output for application-owned grading. VM/container resource sizing must come from the real 80-student coding rehearsal, not student count alone.

For internet-outage continuity, a school-LAN-reachable server with local DNS, assets and runtimes can continue serving students while external internet is unavailable; AI drafting remains unavailable. An off-site VM is not reachable during campus internet loss without a separate connectivity path. For temporary client disconnects, persist unsubmitted drafts locally only under a defined privacy policy, show that they are unsynced, and reconcile revision numbers after reconnecting. Never promise graded acceptance after a server deadline based on an untrusted browser timestamp. Full offline graded submissions need an explicit fairness and proctor reconciliation policy and are a separate feature. UPS coverage and a restore drill address different failure modes from browser reconnection.
