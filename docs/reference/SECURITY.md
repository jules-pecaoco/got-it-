# Security model and limits

[Documentation contents](../README.md) · Reviewed against the current access, grading and execution code on 7 November 2026.

This page explains the protections already implemented and the work still needed for deployment. Follow the [test plan](TEST_PLAN.md#before-a-graded-deployment) before using consequential grades.

## Access and records

The server controls roles, deadlines, question order and scores. Private rules remain in SQLite rather than the student bundle. Faculty access is owner-scoped; student access is limited to its own attempt; proctor access is read-only and run-scoped. Proctors see participation/timing, not answers, scores or answer keys.

Browser sessions use opaque, role/path/tab-scoped HttpOnly, SameSite=Strict cookies. Tokens are omitted from browser sign-in JSON and are not stored in Web Storage. HTTPS `PUBLIC_ORIGIN` marks cookies Secure and provides the expected mutation origin. Scripted clients retain bearer-token support.

| Access  | Expiry                                    | Revocation/recovery                               |
| ------- | ----------------------------------------- | ------------------------------------------------- |
| Faculty | 8 hours                                   | Logout or account-password change revokes access  |
| Student | 24 hours, independent of attempt deadline | Rejoin rotates access and preserves work/deadline |
| Proctor | 8 hours or run close                      | Code replacement/revocation ends existing access  |

Legacy records belong to the default `faculty` owner. Provisioned faculty passwords use salted scrypt hashes. `INSTRUCTOR_PASSWORD` is the configured fallback for an unprovisioned default account; keep it private and strong.

The supervised student identity model uses school ID plus a shared run PIN. The PIN uses an unsalted SHA-256 hash; knowing both permits joining that student's attempt, so in-person identity checking remains a proctor responsibility. PINs are not recoverable from the hash and only remain in the current Faculty page's memory. Proctors also share a hashed run code, rather than individually identified staff accounts.

## Submission and result integrity

- Server-side transactions record submissions and criterion awards. Unique `(session_id,activity_id,criterion_id)` score events prevent repeated awards for the same earned criterion.
- Stable idempotency keys and request hashes make transport retries return the original result without charging another attempt. Draft revision checks reject stale edits.
- Drafts are separate from graded submissions. Finish/expiry settles eligible saved answers subject to retry rules.
- Console submissions enter manual review. Optional AI suggestions never save, overwrite or publish scores on their own.
- Graded results require explicit faculty publication after pending jobs and required review are resolved. Recovery clears early publication.
- Faculty score changes are audited; grading reasons are optional up to 300 characters. Time extension/reopening requires a reason and is limited to 1–120 minutes before run close.
- Deletion is owner-scoped, transactional and blocked by active attempts or pending grading. Published content stays immutable; editing uses a new draft version.

## Request and browser protections

Cross-origin mutations are rejected. Static serving is confined to `public/`; JSON bodies enforce byte limits and reject malformed UTF-8. IDs are validated for addressable routes, errors carry request IDs, and gradebook CSV escapes formula-leading values.

Student readiness/join has a 5,000-request/minute socket-IP ceiling, with separate failed-credential limits of 10 per run/candidate and 200 per socket IP/minute. Successful credentials do not consume failed-credential budgets. Forwarded client-IP headers are deliberately ignored; configure and rehearse the intended proxy/NAT traffic pattern. Answer submissions are limited to six per minute per candidate/activity. Other operations have their own limits.

Published reference guides are served through authenticated APIs. The static expected web output is shown with restricted content security policy; it does not execute student scripts or expose the private implementation. Student previews use a distinct configured origin.

## Coding and preview isolation

Student source runs in Docker rather than the application process or a host language interpreter. Only source and required execution inputs enter the container; application secrets, student records, private expected answers and the Docker socket do not.

| Execution path                      | Main limits                                                                                                                                                                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bounded console/sample execution    | Digest-pinned Linux images, no network or host mounts, non-root UID/GID 65534, read-only root, dropped capabilities, 128 MB memory, 32 PIDs, 0.5 CPU, 16 MB restricted tmpfs, bounded time and 32 KB combined output; two concurrent executions |
| Live Python/JavaScript/PHP terminal | Restricted container, 128 MB memory, 32 KB output, 5-second CPU budget and two-minute lifetime; default eight live runs                                                                                                                         |
| PHP/frontend workspace              | Separate-origin access, restricted Docker runtime and expiring temporary workspace; saved project data provides recovery                                                                                                                        |
| SQL console execution               | Fresh in-memory SQLite after fixture setup, extension loading disabled, permitted read-only query operations                                                                                                                                    |

These are distinct services with different lifetimes and capacity limits. `TERMINAL_CAPACITY` accepts 1–80; a higher value requires host measurement. Container images are installed by an operator; student execution uses `--pull=never`. Bounded console containers are force-removed on completion/error. Preview access uses short-lived unguessable paths; avoid sharing them.

Console execution output is not automatically graded by the current submission path. Compatible older web HTTP checks run with fresh faculty seed data. Missing/busy execution services do not turn an execution request into a graded wrong answer; pending or failed grading jobs must be resolved before publication.

Docker is a container boundary, not a complete hostile multi-tenant sandbox. For public/adversarial deployment, separate the execution host, restrict worker ingress to the API and consider a hardened/rootless runtime. A remote worker requires HTTPS and a shared secret of at least 32 characters. Never publish the Docker socket. See [Docker security](https://docs.docker.com/engine/security/) and [container controls](https://docs.docker.com/engine/containers/run/).

## Optional AI and data handling

Teaching material and student code/comments are untrusted data. Provider prompts instruct the model to ignore embedded instructions; output validation still cannot establish educational correctness. Faculty must review questions, references and suggested grades.

Question drafting sends teaching text to Gemini. An explicit faculty grade check sends question/configuration, private grading reference and submitted answer/code; learner names/IDs are not added and project database snapshots are excluded. AI reviews code as text. Apply the institution's provider/data policy before enabling these features.

Do not publish `.env`, databases, real answer files or backups. Restrict records and define retention. Fictional private answers in `tests/fixtures/` are developer test material outside the served directory. Keep verified [backups](../operations/BACKUP_AND_RECOVERY.md) on another device; original uploaded binaries are not retained.

## Deployment responsibilities

Complete institution authentication/roster review, secure configuration, HTTPS, data governance, representative concurrency testing, recovery drills, accessibility and penetration/security reviews. Node's built-in SQLite API is experimental in the tested Node 22 runtime; see [Node 22 SQLite](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html).

Use one application process per database. Fullscreen and disabled text selection are light deterrents; the browser cannot reliably prevent screenshots or photographs. There are no focus strikes or automatic penalties. Connectivity status is informational and does not apply a penalty.
