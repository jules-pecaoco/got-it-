# Test evidence and remaining gates

**Audit remediation check (2026-11-02):** `npm test` passed **83/83** tests. `npm run format:check` and `git diff --check` also passed. New regressions cover 500 fictional students completing readiness and join sequentially through one IP, per-identity failed-login limits, released-score recovery for reopen and extension, addressable IDs, UTF-8 split at every byte, malformed UTF-8 and byte limits, HttpOnly cookie scope and cross-origin protection, logout/rejoin/expiry, legacy session migration, removal of persisted browser credentials, shared `.env` selection, and demo cleanup with dependent records. The 500-student admission scenario is not a concurrent load test.

In an isolated headless Chrome session, Faculty sign-in survived refresh and sign-out returned to sign-in; browser storage contained no bearer tokens or saved run PINs. A student joined with school ID and run PIN, saved a draft, refreshed into the same attempt with the draft restored, then left the session and remained signed out after refresh. A Proctor signed in to the fictional run, viewed participation, and signed out; refresh returned to Proctor sign-in. The checks used an in-memory database. Expected unauthenticated session checks returned 401; no application JavaScript exceptions were observed. The original audit evidence is retained in `artifacts/audit-2026-11-02/evidence.json`; the corrected probes pass and write `verification.json` beside it.

## Current working tree check (2026-11-01)

`npm test` passed **64/64** tests, including a regression test that custom faculty AI guidance reaches the model, stays out of saved public and private packages, and is limited to 2,000 characters. In headless Chrome against an isolated in-memory server, the Faculty paper-backup flow rendered both questions and proportional point values, loaded the same-origin print stylesheet with an 8 × 13 inch portrait `@page` rule, and omitted the expected correct answer from the student copy. A visual screenshot showed the page fitting its content cleanly. A delayed Faculty refresh displayed the request indicator while pending. A physical printer check remains outstanding.

## Formatted programming questions (2026-11-01)

`npm test` passed **59/59** tests. Prompt parsing tests confirm that fenced PHP, SQL, JavaScript, and Python snippets keep their original text and indentation. AI prompt tests confirm the generator requests fenced snippets. A browser check with fictional samples showed four syntax-colored code blocks, preserved Python indentation and PHP dollar signs, and verified `white-space: pre`. The temporary page was removed afterward. Existing published questions that describe code only in prose need an editable copy to show an actual snippet.

## Question order and faculty grading (2026-10-31)

`npm test` passed **57/57** tests. An HTTP test checks saved question order after resume, faculty-only access to response history and answer keys, blocking score changes during an active attempt, score bounds, override and reset, gradebook and CSV totals, and audit records. In an isolated browser run, Faculty enabled shuffle, reviewed a fictional student's answer, changed 20 points to 18, saw the gradebook update, and restored the automatic 20 points. At phone width, the layout stayed within the viewport; the results table scrolls horizontally.

## Graded feedback (2026-10-31)

`npm test` passed **56/56** tests. A new HTTP test confirms that Graded join, submission, session, and finalization responses omit correctness and score while the run is open, that Faculty still sees the score, and that student results appear after closure. An isolated browser run confirmed the Faculty feedback choice and a student save acknowledgment without correctness or a live score. Existing runs and demo fixtures retain Practice feedback.

## Proctor monitoring (2026-10-31)

`npm test` passed **55/55** tests. The new tests cover run-scoped proctor authentication, exclusion from faculty and student endpoints, a monitoring response without answers or grades, participation and submission progress, code replacement, and revocation. In an isolated in-memory browser run, Faculty issued a code, a Proctor signed in, and a fictional student's join and submission appeared after refresh. Student and status filters worked; Faculty and Proctor showed no browser console errors. Mobile browser layout and production load remain unverified.

## Executed

On 2026-10-28, `npm test` passed **13/13** tests on Node 22.14 with the `--experimental-sqlite` flag. The tests cover both unrelated fictional subjects, seven common validators, invalid package cases, source rationale and review gating, shuffled order and fixed-last position, immutable publication, version pinning, new-topic package import and approval, candidate-safe mission data, roster join, resume, token rotation, score isolation, criterion-level partial credit, idempotent repeated scoring, finalization, HTTP access controls, and CSV export.

The HTTP tests require local loopback access. In this workspace, the first sandboxed `npm test` run failed its two HTTP tests with `connect EACCES 127.0.0.1`; rerunning with local-network permission passed all tests.

A browser smoke check opened the local app, joined the fictional Garden Survey as a candidate, completed both activities, and observed the score change from 0/100 to 50/100 to 100/100 with the second mission unlocking after the first submission. Reloading after a server restart retained the order, deadline and score. The instructor dashboard then displayed the same 100/100 beside the fictional roster identity. The candidate layout was visually inspected at a narrow viewport.

## Not run or incomplete

- Automated browser accessibility audit and cross-browser testing.
- Concurrency or load test with representative student count.
- Full 40-minute pilot, timer boundary and recovery drill.
- Faculty review of a real question bank or source document ingestion.
- Security penetration test and production SSO/roster integration.

These gates remain required for a real graded release. The test suite verifies this demonstration's implemented contracts; it does not certify deployment readiness.

## Week 13 CTF version 4 (2026-10-29)

`npm test` passed **24/24** tests for the 40-minute, five-mission Campus Queue CTF. The tests check source references, six columns and 36 tickets, page 2 grading, both code missions, rejection of arbitrary JavaScript, source review, complete candidate progression, attempt limits, point and time deductions, answer formatting and editable copies. The full suite also checks separate student and faculty routes and CSV roster import. On 2026-10-30, the Faculty workflow was checked in desktop and narrow browser views; the Panel route now returns 404.

Coding coverage: `tests/coding.test.mjs` verifies all four languages and both Activity/CTF package paths, source-based AI instructions, expected-output examples, malformed test rejection, exact/whitespace/numeric comparisons, private-test grading, hardcoded-sample partial credit, server-only results, graded feedback, idempotency, late execution, outage handling and sandbox arguments/cleanup. The coding HTTP test verifies role access, public-example preview, ignored client-supplied fixtures/output, private-test isolation and closed attempts. `npm run verify:coding` is the explicit Docker integration check; it runs real programs in each of the four runtimes and checks syntax errors, SQLite write denial, timeout, output bounds, non-root UID and read-only root.

Mixed question coverage: `tests/question-mix.test.mjs` exercises all ten types in one Activity/CTF, exact type-count generation and repair, invalid count requests, per-pair matching scores, private table targets and computed rows, quoted searches, DataTables reference scripts and flags, and faculty changes to types/counts/languages. Existing unsupported-type tests now use an unregistered essay type because DataTables generation is supported.
