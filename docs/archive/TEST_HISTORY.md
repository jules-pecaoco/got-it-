# Verification and release gates

> Historical verification notes, retained on 7 November 2026. Entries describe successive revisions, including features later removed. Test counts and Docker/load results apply to those revisions. Use the [current test plan](../reference/TEST_PLAN.md) for commands, coverage and outstanding work; start from the [documentation contents](../README.md) for current product instructions.

Run `npm run check` for type, syntax, formatting, build and automated regression checks.

The suite covers grading and accumulated criteria, deadlines, draft revisions and conflicts, expiry finalization, idempotent submissions, faculty ownership, role/session isolation, package validation, queue leases/recovery, material extraction, project archives, backup consistency and original-database preservation. Fictional fixtures in `tests/fixtures/` are not seeded during normal operation.

Run `npm run verify:coding` and `npm run verify:web` against Docker for actual execution and sandbox checks. The PHP verification exercises HTTP, SQLite CRUD, database recovery/reset, static assets, filesystem restrictions, preview console bridging, cookie scope and expired access.

Browser checks verified the logic editor, refresh recovery, sample results, disconnect/reconnect recovery, and cross-origin PHP preview with console messages.

The real 80-student Docker rehearsal verified every score and drained the queue in 119.55 seconds with two Python tests per student. [Rehearsal output](../../artifacts/migration-load80-docker.txt) and [verification summary](../../artifacts/migration-verification.json) retain the results. A restore drill compared nine table counts and six grades across baseline and migrated copies.

Remaining release gates:

- Investigate the grading mismatch observed when a real rehearsal competed with build/regression work; the isolated run passed. Do not build or perform maintenance during an exam.
- Configure institutional HTTPS hosting and separate preview/worker access.
- Run a representative full-duration proctored pilot.
- Complete accessibility and security reviews on the intended deployment.

The preserved baseline tag and historical rollback procedure are in [the migration record](MIGRATION_2026-11-04.md). Use [backup and recovery](../operations/BACKUP_AND_RECOVERY.md) for the current database-selection procedure. Older audit logs and one-off samples remain available in Git history.

AI response checks cover thought-part filtering, JSON fences, truncated output, bounded retries, quota/safety responses and safe diagnostics. A live synthetic request returned four Python coding questions, all ready for faculty review; no assessment records were created.

Current coding workflow: students run code with sample or custom input and see output/errors, without test comparisons. Submissions and final drafts require faculty grading before score publication. All 121 regression tests pass; Python, JavaScript, PHP and SQL execution was verified with the installed Docker runtimes. Earlier automatic-grading load results above describe the previous workflow. No assessment data was changed.

Five assessment starters are available: PHP console, Python, JavaScript console, frontend HTML/CSS/JS and PHP + SQLite web app. All use manual rubrics. Template validation, authenticated creation and publication guards pass in the 123-test suite. Docker checks verified frontend assets and PHP/SQLite preview. Frontend startup without seed SQL is covered by verify:web.

Faculty UI review: verified starter/AI/import switching without losing AI form entries, frontend draft creation, direct draft editing, collapsed paper tools, Classes/Results navigation and 390px mobile layout without horizontal overflow. Browser checks used an isolated in-memory database. Starter/rubric editing still uses the advanced JSON editor. Screenshots are under output/playwright/.

AI-first creation and web expected output: 126 checks pass. Mock-provider tests cover frontend/PHP web generation, private manual rubrics, static reference validation and approval. Browser checks verified faculty editing, student display, CSS nonces and independence from student source edits using an isolated in-memory database. Live synthetic provider checks returned a timeout and then 503 busy; live web generation remains unverified in this run.

Fixed starter creation was removed from the faculty screen and API. AI generation is the direct creation flow; JSON import remains under Advanced. Existing assessment records are unchanged. The legacy PHP scaffold is retained only as a test fixture.

Faculty-facing JSON import, raw package editing and coverage JSON were removed. AI question editing remains available before saving; web files use filename and starter-code fields. Browser verification covered web-question edits and creation navigation in an isolated database.

Saved-draft form editor: tests round-trip all supported question types, preserve legacy HTTP checks/weights, validate points, reject invalid/stale edits and enforce ownership/published immutability. Browser checks verified saved frontend prompt/points/reference/rubric edits, cancellation, Python sample persistence, unsaved-edit publication blocking and a 390px layout. Tests use in-memory databases; the reset application databases remain untouched.

Student console samples are always-visible blocks above the editor. Type checking, build, and desktop/mobile browser checks passed, including multiline input preservation and static expected output independent of source edits.

Minimal console starters: 128 regression checks passed. Real Docker execution verified top-level scripts and student-defined functions in Python, JavaScript and PHP, without mandatory entry-point wrappers.

Live terminal: owner isolation, reply/EOF validation, capacity, output/time bounds, startup cancellation and closed-attempt cleanup are covered. Real Docker checks passed for Python/JavaScript/PHP prompts and replies, EOF and Stop; an authenticated remote worker path also passed. Browser checks verified collapsing samples, Enter-to-send without answer submission, greeting output, Stop and 390px layout. These checks used synthetic data and in-memory databases. An 80-student live-terminal pilot is still required; default capacity is 8.

Reference guides: catalog/search/selection validation and server authorization tests pass. Browser verification covered faculty selection/preview/persistence, student allowed-topic filtering, multi-word/code search, empty results, inert HTML examples, cached offline reading, Escape/focus handling, fullscreen preservation, unchanged editor content and a 390px drawer. Tests use in-memory databases. Existing assessments default to no guides.

Syntax editor: browser checks passed for six language modes, indentation, undo, per-file histories, keyboard exit, maximum-length rejection, draft recovery after refresh, import/download equality and a 390px layout. Normal typing/paste caused no CSP violations. Mocked terminal responses verified Run source and live-reply wiring; current real execution verification was blocked by an unresponsive Docker engine. The stale-backend capability guard passed. Existing Docker integration checks from prior work remain separate from this UI verification.
