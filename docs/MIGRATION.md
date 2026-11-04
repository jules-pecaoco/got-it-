# Migration and rollback

Baseline: local Git tag `codex/pre-migration-2026-11-04`, commit `3a3aeb7`.
Migration branch: `codex/assessment-migration`.
Verified original database backup: `data/backups/studio-2026-11-04T03-17-08-580Z-fda05cf7.sqlite`.

## Run safely

Runtime temporary files and Node/tsx caches use `data/tmp` on the project drive (`D:\code\ctfv1\data\tmp` here). Project npm cache uses `data/npm-cache`. Application, build, test and maintenance entry points set TEMP, TMP and TMPDIR for their own processes and children; Windows-wide settings are unchanged. `RUNTIME_TEMP_DIR` optionally selects another project-relative or absolute directory. Docker Desktop's disk images were verified at `D:\docker\DockerDesktopWSL`.

`npm ci`, then `npm run typecheck`, `npm test`, and `npm start`.

`npm start` builds the editors and starts the migration on a separate database ending in `.migration.sqlite`. The original configured database stays unchanged. Explicit `MIGRATION_DATA_FILE` selects another migration copy. Never point the original server at an upgraded database.

Student work accepted by the migration exists in its database. Returning to the baseline database will not transfer that work. Cut over between runs; export and reconcile migration results before rollback if real submissions were accepted.

## Roll back code and data

1. Stop the migration server and execution worker between runs.
2. Preserve the migration database with `npm run backup` using its explicit `DATA_FILE`, and export needed results.
3. Keep any uncommitted migration changes before switching: commit them locally or save a patch.
4. `git switch --detach codex/pre-migration-2026-11-04`
5. `npm ci`, then `npm test` and `npm start`. The baseline uses the original configured database.

To work on the migration again: `git switch codex/assessment-migration`, `npm ci`, `npm start`.

If the original database needs recovery, `npm run restore -- BACKUP.sqlite NEW.sqlite` creates a new verified copy and reports record counts. Set `DATA_FILE` to that copy only after inspection. Restore never overwrites a running database. Keep the baseline checkout for a baseline restore command if necessary (`node --experimental-sqlite scripts/backup.mjs NEW.sqlite` with `DATA_FILE` set to the backup).

## Faculty accounts

Existing records belong to username `faculty`, which retains the configured faculty password until an account is provisioned. Set `DATA_FILE` to the migration database before account maintenance. Set `FACULTY_PASSWORD` in the environment and run `npm run faculty -- USERNAME`. Password changes revoke existing sessions. New faculty see only their own classes, assessments, runs, results and audit records. Existing content remains with `faculty`; moving ownership is a deliberate maintenance operation.

## Execution host

The API can use local restricted Docker for a single-host pilot, or a separate worker:

- Worker: set a random `EXECUTION_SECRET` of at least 32 characters and run `npm run worker`.
- API: set the same secret and `EXECUTION_ORIGIN` to the worker origin. Remote hosts require HTTPS. Restrict worker ingress to the API host. Never expose a Docker socket to students.
- Worker receives source and test inputs; expected outputs and private grading criteria stay with the API.

For PHP previews set `PUBLIC_ORIGIN` and a different `PREVIEW_ORIGIN`. Route the preview host to `PREVIEW_HOST` / `PREVIEW_PORT` (defaults `127.0.0.1:3102`). Use a separate preview hostname, HTTPS in deployment, and no institution cookies on that hostname. The main app intentionally permits frames only from this configured origin. Preview paths carry short-lived unguessable access; do not share them. Environments expire after ten minutes and are removed on normal shutdown. After a worker crash, operators must inspect and remove orphaned containers labeled `gotit.web=true` before restarting on a dedicated host.

Plain PHP projects use PDO SQLite at `/tmp/data/database.sqlite`. Runtime images must supply `pdo_sqlite`. Faculty can create a PHP assessment from Create activity, then edit its project and grading checks in Advanced package editing. HTTP checks run in an isolated environment with fresh faculty seed data. Manual rubric criteria require faculty to record the final question score with a reason before publication. Editors support project ZIP import/export and a preview JavaScript console. Use relative URLs in project assets and forms. Full browser interaction grading, MySQL and PHP framework hosting are not included.

The HTTP transport uses Fastify with a compatibility adapter for the established API contracts. Faculty and student controllers are separate modules. New execution, preview, monitoring and editor code is TypeScript; existing faculty/proctor workflows and grading/persistence code remain JavaScript. This avoids replacing tested workflows solely to change their framework. PostgreSQL and a full SPA rewrite are deferred under YAGNI.

Staff can inspect request latency, event-loop delay and queue age at `/api/instructor/system`. Proctors see last-seen timestamps; stale connectivity is informational and never applies a penalty. Material extraction runs in bounded worker threads.

## Verification on 4 November 2026

- 117 automated tests passed; TypeScript, JavaScript syntax, scoped formatting and whitespace checks passed.
- Browser: logic editor, saved-draft refresh, sample results, disconnect/reconnect recovery and cross-origin PHP preview verified using fictional records. The Playwright skill was used for these checks.
- Real Docker: JavaScript, Python, SQL and PHP execution, invalid programs, execution/output limits and runtime restrictions verified.
- Real PHP: HTTP rendering, SQLite CRUD, static assets, database recovery/reset, filesystem restriction, console bridge, preview cookie paths and revoked preview access verified.
- Simulated 80-student rehearsal: all 80 scores verified, queue drained; this is not Docker throughput evidence.
- Restore drill: baseline and migrated code loaded separate backup copies; nine table counts and all six existing grades matched, with no foreign-key violations.
- After selecting D: runtime temp storage (Docker disks were already on D:), the real 80-student Docker rehearsal passed: 80 scores verified, queue drained in 119.55 seconds, request p95 196.2 ms. This fixture has two Python private tests per student. The 10 GB disk-space check remained enabled.
- An initial real run concurrent with build/regression work produced a partial score for valid code. The isolated rerun passed all 80. Avoid builds/maintenance during exams and investigate host-contention grading before graded deployment.
- Institutional deployment, representative full-duration examination, comprehensive accessibility review and penetration testing remain release gates. No live classroom run was performed.

## Release gates

Before classroom use: pass build/types/tests, browser editor checks, real PHP/SQLite execution, actual 80-student coding load, expiry/restart tests, a restore drill, and accessibility review on the intended lab browsers. Do not treat simulated runner throughput as a Docker capacity result.
