# Application and student audit — 8 November 2026

[Documentation contents](../README.md)

The current working tree passes its automated checks and real execution rehearsals, but the student workflow still has defects that can affect submitted evidence and recovery. Fix the PHP database-evidence gap first, followed by student sign-in recovery and synchronization of faculty time extensions. The shared student PIN remains a material identity limitation for unsupervised use.

This audit reviewed the files on disk, including the substantial pre-existing uncommitted changes. It covered student admission, answering, autosave/recovery, submission, deadlines, results, code execution, PHP previews, faculty workflows, proctor monitoring, access boundaries, dependencies, responsiveness and targeted accessibility checks. Application source was not changed. Browser/API exercises used fictional records and isolated in-memory databases; the normal application database and external AI providers were not used.

**Priorities**

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| S1 | P1 | Database-only PHP work can be absent from final submissions | Reproduced with real PHP/SQLite in two scenarios |
| S2 | P1 for unsupervised deployment | A shared run PIN and another student's school ID permit takeover of that attempt | Reproduced; existing documented identity model |
| S3 | P2 | Faculty time extensions do not update the active student's countdown | Reproduced across a heartbeat interval |
| S4 | P2 | An invalidated student sign-in blocks saving and leaving without offering reauthentication | Reproduced in the browser |
| S5 | P2 | Partial sequencing answers pass the saved-answer checks and are finalized despite stricter manual-submit validation | Reproduced against the store; UI behavior traced |
| S6 | P2 | The web editor starts below the visible answer pane on both phones and laptops | Measured and visually inspected |
| S7 | P2 | Faculty/proctor fetches have no application timeout or cancellation | Source-reviewed resilience gap |
| S8 | P3 | Finished students are promised submission review but receive only a summary and score | Reproduced in the browser |

P1 means a submission/identity issue to address before depending on the affected flow. P2 affects normal operation or recovery. S2 is a known product constraint, not a newly discovered bypass of stronger authentication. S7 was identified from source; an extended proxy/network stall was not timed in this audit.

**S1. Include database changes in the submitted answer, independently of source edits**

The web workspace calls its answer-change callback for source edits, file changes, imports and database reset. Normal preview opening and subsequent PHP form POSTs do not make the answer dirty. The preview service correctly checkpoints the database, but finalization only processes `answer_drafts`.

Two real-container reproductions used a fictional starter application with a working database form:

1. Join, run the starter without editing source, add a record through the preview, then finish. The preview showed three rows and a durable checkpoint existed, but the finished attempt had **zero submitted answers**.
2. Save and explicitly submit the source first, add a record through the still-open preview, then finish. The attempt retained one submission, but its database snapshot differed from the latest durable checkpoint. Faculty submission evidence omitted the later database work.

The database was checkpointed; the defect is its omission from the graded submission evidence. It should not be described as a failure of checkpoint persistence.

Relevant code: [WebWorkspace.vue:60](../../web/WebWorkspace.vue#L60), [web-preview.mts:112](../../src/web-preview.mts#L112), [attempt-settlement.mjs:6](../../src/attempt-settlement.mjs#L6), and [store.mjs:1004](../../src/store.mjs#L1004).

Record a versioned candidate answer when meaningful preview/database changes occur, and reconcile that version with the durable checkpoint during finish/expiry. Preserve draft-conflict and retry-limit rules; avoid silently charging another attempt merely for opening or viewing a preview. Acceptance checks should include both scenarios above, ordinary source-plus-database edits, deadline expiry, and exhausted retries.

Evidence: [real database reproduction](../../output/playwright/system-audit-2026-11-08-web-database.log), [reproduction script](../../output/playwright/system-audit-web-database.mts).

**S2. Strengthen student identity and second-session handling**

Admission checks the run, roster school ID and shared run PIN. Joining an existing attempt rotates its token immediately. Using the same fictional school ID and PIN from a separate client successfully replaced the active student's access. That client can continue the same attempt and access its work; the original page receives 401 responses.

This matches the constraint already described in [Security](SECURITY.md). A shared PIN is distributed to the class, so knowledge of another roster ID is sufficient to act as that student. Supervision is currently the identity check.

Relevant code: [store.mjs:679](../../src/store.mjs#L679) and [store.mjs:713](../../src/store.mjs#L713).

For unsupervised or consequential use, introduce an individual join credential or institutional sign-in. Give legitimate students a deliberate recovery path for changing devices, and distinguish that from an unexpected second-client takeover. Any takeover confirmation must avoid revealing another student's answers before authorization.

**S3. Synchronize deadline changes during an active attempt**

The student heartbeat returns an acknowledgement but no authoritative attempt/deadline state. The active page checks results only after its local attempt is finished, so a faculty extension is invisible while the student continues answering.

Measured reproduction: the faculty API moved the deadline from `2026-11-08T10:54:24.231Z` to `2026-11-08T10:59:24.231Z`. After 16 seconds, including a heartbeat interval, the student countdown still read **39:43** while approximately **44 minutes** remained on the server. At the stale deadline, `updateTimer()` can show completion and unmount the workspace until a later results refresh discovers the extended attempt. The backend extension itself is saved correctly.

Relevant code: [student.mjs:60](../../src/routes/student.mjs#L60), [student.js:374](../../public/student.js#L374), and [student.js:462](../../public/student.js#L462).

Include status, deadline and server time in a lightweight authenticated heartbeat response, and reconcile them without replacing the current editor or unsaved work. Announce added time. Apply the same principle to faculty reopening. The proctor countdown also uses the device's wall clock directly; verify it on deliberately misconfigured lab clocks.

Evidence: [measured browser results](../../output/playwright/system-audit-2026-11-08-focused-browser.log), [countdown screenshot](../../output/playwright/system-audit-clock-extension.png).

**S4. Provide student reauthentication that preserves local work**

After an existing attempt is joined from another client, editing on the original page produces: “Answer not saved. Your sign-in has expired. Sign in again to continue.” There is no sign-in action in that workspace. Selecting Leave activity tries to save again, fails, and shows: “Some answers are not saved. Select Try saving again beside those questions before leaving.” The join panel stays hidden. Retrying the same expired credentials cannot resolve this state.

A local answer copy was present in the reproduction. Reloading and rejoining can recover it, but the interface neither offers that path nor explains how to preserve the answer safely. Offline draft recovery itself succeeded in a separate refresh exercise.

Relevant code: [student.js:99](../../public/student.js#L99), [student.js:288](../../public/student.js#L288), and [student.js:374](../../public/student.js#L374).

Handle student 401 responses centrally. Offer sign-in over the preserved workspace, then reconcile the local answer against its server revision. Provide a recovery download if reconciliation fails. Ensure leaving an expired session does not require a successful authenticated save first.

Evidence: [final browser results](../../output/playwright/system-audit-2026-11-08-final-browser.log), [recovery screenshot](../../output/playwright/system-audit-auth-recovery.png).

**S5. Distinguish an incomplete sequence from a complete saved answer**

For a valid three-step sequencing question, saving `['a', '', '']` returns `gradable: true`, adds the question to `savedAnswers`, and finalization submits it as incorrect for zero points. The browser's manual Submit answer path instead rejects missing items and duplicates with “Choose each sequence item once.” The matrix and finish-review logic use saved-answer presence rather than completeness, so a partly filled sequence can appear accounted for when finishing.

Relevant code: [store.mjs:49](../../src/store.mjs#L49), [student.js:1143](../../public/student.js#L1143), and [student.js:716](../../public/student.js#L716).

Continue saving incomplete work for recovery, but track completeness separately. Require the full set of valid, distinct sequence items for a complete answer, and list incomplete questions in review. Define whether finishing intentionally submits an incomplete answer for zero points; make that choice visible instead of applying a different validation path silently.

Evidence: [partial-answer reproduction](../../output/playwright/system-audit-2026-11-08-partial-answer.json), [reproduction script](../../output/playwright/system-audit-partial-answer.mjs).

**S6. Give the web source editor usable initial space**

The web workspace opens its expected-output example before import/export, file controls and the source editor. Its preview iframe has a 28rem minimum height. With a small fictional example page, the source editor was entirely below the visible answer pane:

| Viewport | Visible answer pane | Editor top in viewport coordinates | Editor initially visible |
| --- | --- | --- | --- |
| 390 × 844 | y=421, height=367 | y=1346 | No |
| 320 × 740 | y=417, height=267 | y=1386 | No |
| 1366 × 768 | y=88, height=624 | y=937 | No |

The preview-unconfigured notice in these fixture screenshots is intentional and is not a diagnosis of the normal installation. It takes additional vertical space, but the expanded example and tools put the source well outside the answer pane even on the laptop. No horizontal document overflow was measured.

Relevant code: [WebWorkspace.vue:126](../../web/WebWorkspace.vue#L126) and [workspaces.css:40](../../web/workspaces.css#L40).

Use compact Prompt / Code / Preview access on narrow screens, with the example available on demand. Put source and Run controls first, and move import/export and file creation to a compact toolbar. Preserve file-switching behavior and keyboard access. The console editor is improved compared with the earlier audit, but still has several nested scroll areas on a small phone; test with a real virtual keyboard.

Evidence: [web measurements](../../output/playwright/system-audit-2026-11-08-web-ux.log), [390px web screenshot](../../output/playwright/system-audit-web-390.png), [320px console screenshot](../../output/playwright/system-audit-student-320.png).

**S7. Bound faculty and proctor requests**

The faculty and proctor request helpers call `fetch()` without an abort signal or action timeout. During a stalled response, loading states and disabled controls depend on the request eventually settling. In the proctor view, `state.loading` also suppresses automatic refresh and further manual refresh calls. Explicit HTTP errors and ordinary network failures are handled; an application-controlled upper bound is missing.

Relevant code: [faculty.js:255](../../public/faculty.js#L255), [proctor.js:24](../../public/proctor.js#L24), and [proctor.js:118](../../public/proctor.js#L118).

Use different timeout budgets for normal reads, uploads and long AI operations. Keep stale proctor data visibly timestamped and permit retry after timeout. For mutations, preserve idempotency/reconciliation so a timeout does not imply the server failed to save. Verify with a response that remains pending, rather than only a mocked 500 or disconnected request.

**S8. Align the completed-student screen with its promise**

Readiness labels the completed-attempt action “View submission and score” and says the student can view the submission. The finished workspace hides the question area and provides a received-answer count, aggregate score and refresh action; no submitted-answer review action was present. Publication itself worked: the synthetic objective student saw **50 out of 100 points** after faculty publication.

Relevant code: [student.js:193](../../public/student.js#L193), [student.js:1418](../../public/student.js#L1418), and [student.html:147](../../public/student.html#L147).

Either provide a read-only receipt of that student's submitted answers, respecting assessment disclosure policy, or change the action to “View status and score.” A receipt should distinguish saved/submitted, pending review and published score, and should not expose private answer keys before release.

**Further UI, accessibility and maintenance improvements**

| Area | Improvement |
| --- | --- |
| Destructive web actions | Confirm database reset with a clear explanation of what will be erased. Offer an export before replacing an imported project. The reset button currently calls the reset operation directly. |
| Faculty mobile results | Reduce the stack of service notice, workspace selector, run introduction, actions and summary cards before the first student. Keep the selected run and next review action prominent. |
| Student answer status | Present separate concepts for locally retained, server saved, complete, submitted and awaiting grade. This also makes S1 and S5 easier to explain. |
| Preview input | The iframe offers generic busy/ended responses. Give the outer workspace a clear preview lifecycle status and a convenient reopen action without losing source. |
| Browser security | The application sets CSP, origin checks and scoped cookies, but its own response policy has no `frame-ancestors` directive or X-Frame-Options. Add an explicit embedding policy unless an intended integration requires framing. The application's `frame-src` only controls frames it loads. Actual public proxy headers were not inspected. |
| Shared lab privacy | Local draft expiry is checked when that draft is read. Consider a bounded sweep of expired recovery copies and explicit cleanup on successful recovery/completion, while preserving copies still needed to resolve a conflict. |
| Accessibility follow-up | Targeted axe checks returned no definite WCAG A/AA violations in the nine states checked. They left incomplete checks for `.terminal-output`, `#proctor-counts`, and `#open-ai-settings`; these are unresolved manual checks, not passes or confirmed violations. Review semantic naming, dialog relationships, keyboard navigation, screen-reader announcements and zoom. |
| Browser coverage | CI runs code checks and execution/recovery verification but not the maintained browser workflow script. Add isolated UI checks for database-only evidence, reauthentication, extension updates, partial sequences and mobile web editing. |
| Maintainability | Consolidate overlapping layout rules in `styles.css`, `ui-refinements.css`, `student-ibt.css`, `app-theme.css` and workspace styles. Prefer focused components/state transitions over additional imperative DOM moves in the growing faculty/student entry points. |

**Verification completed**

| Check | Observed result |
| --- | --- |
| `npm run check` | Passed: types, syntax, scoped formatting, build, **191 tests**, zero failures |
| Maintained browser regression | **8 checks passed**, including protected edits, browser history, faculty reauthentication, pending grades and mobile geometry |
| Additional browser checks | Reproduced S3/S4/S6/S8; offline draft survived refresh; objective score publication displayed correctly |
| Targeted axe A/AA checks | Nine states: student active/completed, proctor dashboard, and desktop/mobile faculty Activities/Classes/Results; no definite violations; incomplete checks retained above |
| `npm run verify:coding` | Real JavaScript, Python, PHP and SQL passed; invalid code, time/output bounds, non-root execution and read-only root verified |
| `npm run verify:web` | Real PHP HTTP, SQLite CRUD, static assets, filesystem boundary, database recovery/reset, proxy/console bridge, cookie scope and expired access passed |
| `npm run verify:recovery` | Normal close and independent expiry after owner-process exit passed |
| Simulated mixed rehearsal | **80 students**, at most 8 concurrent workflows, **1,280 requests**, 2.83 seconds, request p95 **37.06 ms** |
| Real Docker mixed rehearsal | **4 simultaneous fictional students**, **73 requests**, 9.04 seconds, request p95 **2,284.04 ms**; terminal, preview/recovery and pending review checks passed |
| Database-only evidence reproduction | Both S1 cases reproduced with real PHP/SQLite |
| Partial-sequence reproduction | Incomplete draft marked gradable and finalized for zero points |
| `npm audit --json` | User-approved registry check completed: **zero reported vulnerabilities** |

The first sandboxed HTTP test run encountered `EACCES` on loopback. The complete rerun with localhost access passed; the permission failures are not counted as application failures. The build emitted the existing Vite warning about `NODE_ENV=production` in `.env` but completed successfully.

The short four-student Docker result is not evidence of full-class Docker capacity. The 80-student result uses simulated execution and cannot establish that capacity either. Live AI output quality, public-host/proxy security, whole-host failure, off-host restore, full-duration classroom load, real mobile keyboards and assistive-technology testing remain unverified by this audit.

Prioritize S1, then S3/S4 and S5. Resolve the identity model before unsupervised deployment. Follow with S6, request timeout recovery and the smaller UI improvements. The existing suite provides a useful baseline, but its passing status does not cover the newly reproduced student cases.

Raw logs, scripts and screenshots use the `system-audit-` prefix in [output/playwright](../../output/playwright/). That directory is ignored by Git. This report and the [measurements](SYSTEM_STUDENT_AUDIT_MEASUREMENTS_2026-11-08.json) preserve the findings and key results in the repository.
