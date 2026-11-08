# API contracts

[Documentation contents](../README.md) · Reviewed against [server.mjs](../../src/server.mjs) and [role routes](../../src/routes/) on 7 November 2026.

This reference is for developers. For the screen-by-screen workflow, use the [user guide](../guides/USER_GUIDE.md).

## Contents

- [Sessions and responses](#sessions-and-responses)
- [Public and role entry points](#public-and-role-entry-points)
- [Student answers and execution](#student-answers-and-execution)
- [Faculty assessments and classes](#faculty-assessments-and-classes)
- [Faculty runs and grading](#faculty-runs-and-grading)
- [AI and teaching material](#ai-and-teaching-material)
- [Compatibility and validation](#compatibility-and-validation)

## Sessions and responses

JSON responses use `{ok:true,data,requestId,serverNow}` or `{ok:false,code,message,requestId,serverNow,retryAfterSeconds}`. Assessment APIs use `Cache-Control: no-store`; public static assets support ETag revalidation. Errors do not reveal private expected answers.

Browser clients send `X-Session-Mode: cookie` and a per-tab UUID in `X-Session-Id`. Sign-in sets a role/path/tab-scoped HttpOnly, SameSite=Strict cookie and omits the token from JSON. HTTPS `PUBLIC_ORIGIN` makes cookies Secure. Scripted clients can use the returned bearer token instead. Foreign-origin mutations and cross-site Fetch Metadata are rejected.

| Role      | Access lifetime      | Scope                                    |
| --------- | -------------------- | ---------------------------------------- |
| Faculty   | 8 hours              | Owned records and faculty APIs           |
| Candidate | 24 hours             | Own attempt; independent of its deadline |
| Proctor   | 8 hours or run close | Read-only monitoring of one run          |

Candidate rejoin rotates access while preserving the attempt, order and deadline. Logout revokes access without finalizing student work. Forwarded client-IP headers are ignored. The readiness/join socket-IP ceiling is 5,000 requests/minute, with separate failed-credential limits of 10 per run/candidate and 200 per socket IP/minute. These admission ceilings are not capacity guarantees. JSON limits count bytes and reject malformed UTF-8.

## Public and role entry points

| Method     | Route                                                | Purpose                                                                      |
| ---------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| GET        | `/api/health`                                        | Process health and demo-mode flag                                            |
| GET        | `/api/ready`                                         | Database access check; no records or paths returned                          |
| GET        | `/api/config`                                        | Platform label/tagline, demo mode and feature flags                          |
| GET        | `/api/demo`                                          | Fictional credentials only when demo mode and `NODE_ENV=test`; otherwise 404 |
| POST       | `/api/auth/student/preview`                          | Readiness check using `{runId,candidateId,pin}`; no session/token created    |
| POST       | `/api/auth/student/join`                             | Join/resume using the same fields; `candidateId` is the school ID            |
| POST       | `/api/instructor/login`                              | Faculty login with `{username,password}`; username defaults to `faculty`     |
| GET / POST | `/api/instructor/session` / `/api/instructor/logout` | Check / revoke faculty access; logout discards the saved AI proposal         |
| POST       | `/api/auth/proctor/join`                             | Run-scoped access using `{runId,code}`                                       |
| GET        | `/api/proctor/run`                                   | Roster participation, timing and progress; no answers or grades              |
| POST       | `/api/proctor/logout`                                | Revoke proctor access                                                        |

Readiness returns duration, close time, feedback mode, question counts, effective retry rules and whether an attempt exists. It leaves existing timers and tokens unchanged.

## Student answers and execution

All routes below require candidate access.

| Method              | Route                                         | Purpose                                                                     |
| ------------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| GET                 | `/api/me/session`, `/api/me/results`          | Saved state, order, progress, timer and permitted result fields             |
| GET                 | `/api/me/missions/current`                    | Current unlocked public mission/section                                     |
| GET                 | `/api/me/missions/:id`                        | Selected unlocked mission/section                                           |
| GET                 | `/api/me/reference-guides`                    | Only the guides allowed by the published version                            |
| GET                 | `/api/me/code/status`                         | Runtime/worker availability and preview configuration                       |
| PUT                 | `/api/me/activities/:id/draft`                | Save `{value}` without grading or retry cost                                |
| POST                | `/api/me/activities/:id/submit`               | Submit `{value}`; numeric answers also include `unit`                       |
| POST                | `/api/me/activities/:id/preview`              | Execute console source `{value,input?}` with custom input or public samples |
| GET                 | `/api/me/coding-jobs/:jobId`                  | View the current candidate session's queued job                             |
| POST                | `/api/me/activities/:id/terminal`             | Start interactive Python/JavaScript/PHP with `{value:"source"}`             |
| GET / POST / DELETE | `/api/me/activities/:id/terminal/:terminalId` | Read / send `{line}` or `{eof:true}` / stop the owned terminal              |
| POST / DELETE       | `/api/me/activities/:id/web-preview`          | Open/reset `{value:{files,database?},reset?}` / discard the owned preview   |
| POST                | `/api/me/heartbeat`                           | Record recent connectivity                                                  |
| POST                | `/api/me/finalize`                            | Idempotently finish and settle eligible saved answers                       |
| POST                | `/api/me/logout`                              | Revoke access while preserving the attempt                                  |

Pass the last acknowledged draft `updatedAt` in `If-Match` on save and submit; use an empty string for a first save. A stale revision returns `DRAFT_CONFLICT`. Supply a stable `Idempotency-Key` for transport retries: the same request returns its original result; a different payload with the same key returns 409.

Console preview returns `{samples:[{input,output,error,succeeded}]}`. It does not return expected-output comparisons or award points. Console submission returns a saved answer requiring faculty review, even if `Prefer: respond-async` is supplied.

**Asynchronous jobs:** sample-preview requests and **web-project** submissions support `Prefer: respond-async`, returning HTTP 202 and `{jobId,status,acceptedAt}` inside `data`. Poll the job route with the same candidate session. Completed jobs contain `result`; failures contain safe `error` details. Jobs can also be marked `superseded` when an attempt limit makes them obsolete.

The queue persists in SQLite, recovers interrupted work, runs two jobs concurrently and normally admits up to 160 pending jobs with one pending job per candidate session. Accepted web submissions can settle after the deadline. Pending jobs block conflicting operations and result publication; failed grading must be resolved. These queue rules do not describe live-terminal capacity, which defaults to eight.

Web drafts/submissions can checkpoint the preview database. If checkpointing a draft fails because its workspace is unavailable, source files are still saved with the prior available database state and a warning. A configured `PREVIEW_ORIGIN` is required to open website previews.

## Faculty assessments and classes

Faculty access is owner-scoped. Package APIs remain available even though the Faculty UI no longer exposes raw JSON import/editing or fixed starter creation.

| Method             | Route                                                            | Purpose                                                                                 |
| ------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| GET / POST         | `/api/instructor/assessments`                                    | List versions / import a draft `{public,private}`                                       |
| GET / PUT / DELETE | `/api/instructor/assessments/:id/:version`                       | Inspect / replace active draft package / delete selected version and related records    |
| PUT                | `/api/instructor/assessments/:id/:version/questions/:questionId` | Save `{revision,question}` from the form editor; stale revision returns `DRAFT_CHANGED` |
| POST               | `/api/instructor/assessments/:id/:version/validate`              | Return structural/source-validation errors                                              |
| POST               | `/api/instructor/assessments/:id/:version/publish`               | Publish with explicit `{approved:true}`                                                 |
| POST               | `/api/instructor/assessments/:id/:version/clone`                 | Make an editable version; published content stays immutable                             |
| POST               | `/api/instructor/assessments/:id/:version/archive`               | Hide an eligible unused unpublished draft                                               |
| POST               | `/api/instructor/assessments/:id/:version/restore`               | Restore an archived draft                                                               |
| GET / POST         | `/api/instructor/assessments/:id/:version/sources`               | List / add extracted source text `{filename,content}`                                   |
| PUT                | `/api/instructor/assessments/:id/:version/sources/:sourceId`     | Save `{topic,learningOutcome,proposedActivityType,evidence,notes}` review               |
| GET                | `/api/instructor/reference-guides`                               | Faculty catalog of available guides                                                     |
| GET / POST         | `/api/instructor/classes`                                        | List / create `{name,section,roster}`                                                   |
| GET / PUT / DELETE | `/api/instructor/classes/:id`                                    | Inspect / edit or replace roster / delete class                                         |
| POST               | `/api/instructor/classes/:id/students`                           | Add `{candidateId,displayName,gender?,yearLevel?,programShortName?}`                    |
| PUT / DELETE       | `/api/instructor/classes/:id/students/:schoolId`                 | Edit or remove a student                                                                |

Question-form edits preserve compatible legacy HTTP checks, validate positive whole-number points, and recalculate totals. The full package GET returns a `revision` for subsequent question-form editing. Class changes apply to future runs; existing runs keep their roster snapshot.

## Faculty runs and grading

| Method              | Route                                                                     | Purpose                                                              |
| ------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| GET / POST          | `/api/instructor/runs`                                                    | List / create a run                                                  |
| PUT / DELETE        | `/api/instructor/runs/:id`                                                | Update `{name?,closesAt?}` / delete the run and its attempts/results |
| PUT                 | `/api/instructor/runs/:id/name`                                           | Compatible rename-only `{name}` route                                |
| PUT                 | `/api/instructor/runs/:id/pin`                                            | Reset `{pin}`                                                        |
| GET                 | `/api/instructor/runs/:id/results`                                        | Roster, scores and grading state                                     |
| GET                 | `/api/instructor/runs/:id/export.csv`                                     | Gradebook; unavailable grades are blank and CSV formulas escaped     |
| GET                 | `/api/instructor/runs/:id/students/:schoolId`                             | Submitted answers, private references and effective scores           |
| PUT / DELETE        | `/api/instructor/runs/:id/students/:schoolId/scores/:questionId`          | Save `{points,reason?}` / remove faculty override                    |
| POST                | `/api/instructor/runs/:id/students/:schoolId/scores/:questionId/ai-check` | Suggest `{points,feedback,model}` without saving or publishing       |
| POST                | `/api/instructor/runs/:id/students/:schoolId/extend`                      | Extend eligible attempt using `{minutes,reason}`                     |
| POST                | `/api/instructor/runs/:id/students/:schoolId/reopen`                      | Reopen eligible attempt using `{minutes,reason}`                     |
| POST                | `/api/instructor/runs/:id/publish-scores`                                 | Publish eligible completed results                                   |
| POST                | `/api/instructor/runs/:id/students/:schoolId/publish-scores`              | Publish one eligible completed result                                |
| POST                | `/api/instructor/runs/:id/retry-grading`                                  | Retry interrupted grading                                            |
| GET / POST / DELETE | `/api/instructor/runs/:id/proctor-access`                                 | Inspect / issue or replace `{code}` / revoke proctor access          |
| GET                 | `/api/instructor/system`                                                  | Queue, uptime, memory and request/event-loop metrics                 |
| GET                 | `/api/instructor/audit`                                                   | Faculty-scoped audit records                                         |

Run creation uses `{examId,version,classId,pin,opensAt,closesAt,name?,feedbackMode?,shuffleQuestions?}`. Feedback defaults to `graded`; shuffling defaults to false. Older API callers can still supply a roster directly. Use actual ISO dates and a published version/class from your installation.

Graded scores do not release on run close. Faculty publishes completed attempts after pending/failed jobs and manual grading are resolved. Practice returns available immediate feedback; console answers still need grading. Rejoin after closure can display a previously started attempt's published result.

Scores must be whole numbers from zero through the question maximum. Grading reasons may be omitted/blank or up to 300 characters. Recovery still requires a 3–300 character reason and 1–120 minutes before run close. It clears early publication. Removing an override restores the underlying automatic result; console work can return to pending review.

AI checks require an owned, completed, gradeable attempt with a submission. Out-of-range output is rejected; concurrent attempt changes return `STALE_REVIEW`. AI checks never save a score, overwrite an override or publish results.

Run edits cannot shorten an active deadline. Run/version deletion rejects `ACTIVE_ATTEMPTS` or `GRADING_PENDING`, deletes related records transactionally and preserves other versions. Faculty UI confirmation is separate from API authorization.

## AI and teaching material

| Method             | Route                                   | Purpose                                                                 |
| ------------------ | --------------------------------------- | ----------------------------------------------------------------------- |
| GET                | `/api/instructor/ai/status`             | Configured availability and model                                       |
| GET                | `/api/instructor/code/status`           | Execution and preview readiness                                         |
| POST               | `/api/instructor/code/preview`          | Faculty execution `{config,value,input?}`; no automatic comparison      |
| POST               | `/api/instructor/materials/extract`     | Extract `{filename,base64}` for `.txt`, `.md`, `.pdf`, `.pptx`          |
| POST               | `/api/instructor/ai/generate`           | Generate a package from source/design inputs                            |
| POST               | `/api/instructor/ai/propose`            | Preview questions and advisory source-match information                 |
| POST               | `/api/instructor/ai/draft`              | Validate and save `{public,private,evidence,source}`                    |
| POST               | `/api/instructor/ai/approved-draft`     | Save faculty-selected reviewed questions                                |
| GET / PUT / DELETE | `/api/instructor/ai/proposal`           | Recover / save `{input,proposal,selected}` / discard unfinished preview |
| POST               | `/api/instructor/ai/inspect`            | Locally validate edited `{source,design,...setup}`; no provider call    |
| POST               | `/api/instructor/ai/check/:id/:version` | Ask for advisory source-support assessment                              |

Generation/proposal input includes `{title,subject,kind,difficulty,durationMinutes,questionCount,missionCount?,questionMode?,questionTypeCounts?,programmingLanguage?,customPrompt?,source:{filename,content}}`. `questionMode` is `auto`, `mixed`, `coding` or `objective`. Custom mix counts must total `questionCount`. Console languages are `php`, `python`, `sql`, `javascript`; `frontend` and `php-web` select web projects. Custom instructions are limited to 2,000 characters and cannot override supported formats or grounding requirements.

Material binaries are limited to 10 MB, extracted text to 250,000 characters and AI source text to 60,000. Original binaries are not stored. Image-only documents need OCR; `.ppt` needs conversion. Source-match percentages and coverage notes are advisory; structure and referenced-source existence remain validated. Faculty can change the mix during review while meeting package limits.

AI is optional through `GEMINI_API_KEY`. `GEMINI_GRADING_MODEL` overrides `GEMINI_MODEL` for grading suggestions. See the [user guide](../guides/USER_GUIDE.md#what-optional-ai-sends-out) for provider data and review responsibilities.

## Compatibility and validation

Stored packages keep `examId` and `missions`; the UI shows non-CTF groups as sections. Older `/api/instructor/exams` package routes remain aliases. The former `/api/instructor/web-template` route is removed.

`data_inspection` submits filter/order/page state. `datatable_code` submits a supported DataTables subset that is parsed without executing arbitrary JavaScript. Console source is submitted as text for manual review. A web project submits `{value:{files,database?}}`; supported legacy HTTP checks use an isolated fresh seed, not the student's saved database as trusted grading data.

See [question authoring](QUESTION_AUTHORING.md) for package shapes, sample transcripts and manual rubrics. The [security reference](SECURITY.md) describes isolation and deployment limits.
