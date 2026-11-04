# Verification and release gates

Run `npm run check` for type, syntax, formatting, build and automated regression checks.

The suite covers grading and accumulated criteria, deadlines, draft revisions and conflicts, expiry finalization, idempotent submissions, faculty ownership, role/session isolation, package validation, queue leases/recovery, material extraction, project archives, backup consistency and original-database preservation. Fictional fixtures in `tests/fixtures/` are not seeded during normal operation.

Run `npm run verify:coding` and `npm run verify:web` against Docker for actual execution and sandbox checks. The PHP verification exercises HTTP, SQLite CRUD, database recovery/reset, static assets, filesystem restrictions, preview console bridging, cookie scope and expired access.

Browser checks verified the logic editor, refresh recovery, sample results, disconnect/reconnect recovery, and cross-origin PHP preview with console messages.

The real 80-student Docker rehearsal verified every score and drained the queue in 119.55 seconds with two Python tests per student. [Rehearsal output](../artifacts/migration-load80-docker.txt) and [verification summary](../artifacts/migration-verification.json) retain the results. A restore drill compared nine table counts and six grades across baseline and migrated copies.

Remaining release gates:

- Investigate the grading mismatch observed when a real rehearsal competed with build/regression work; the isolated run passed. Do not build or perform maintenance during an exam.
- Configure institutional HTTPS hosting and separate preview/worker access.
- Run a representative full-duration proctored pilot.
- Complete accessibility and security reviews on the intended deployment.

Rollback instructions and the preserved baseline tag are in [MIGRATION.md](MIGRATION.md). Older audit logs and one-off samples remain available in Git history.
