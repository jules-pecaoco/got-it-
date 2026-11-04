# API contracts

## Asynchronous coding and local operations

Student coding submit and sample-preview POST routes accept `Prefer: respond-async`. The response is HTTP 202 with `{jobId,status,acceptedAt}`. Supply `Idempotency-Key` on submissions. Poll authenticated `GET /api/me/coding-jobs/:jobId` until status is `done` (with `result`) or `failed` (with a safe `error`). A job is accessible only to its original student session. Different payloads with the same key return 409; one pending job per student and a 160-job queue bound prevent backlog abuse. Accepted submission receipts survive restart and permit grading after the deadline. Direct calls without the preference retain existing synchronous behavior.

`GET /api/me/session` and `/api/me/results` include `pendingCodingCount`. Final results remain hidden while submissions are pending. `GET /api/instructor/system` requires faculty access and returns queue counts, process uptime, and memory usage. Public `GET /api/ready` exercises database access without revealing records or paths. API responses remain `no-store`; static public assets support ETag revalidation.

See [local hosting](LOCAL_HOSTING.md) for operational limits and preparation commands.

JSON responses have `{ok, data, requestId}` or `{ok:false, code, message, requestId, retryAfterSeconds}`. `/api/me/*`, authenticated `/api/instructor/*`, and `/api/proctor/*` require their corresponding session. Scripted clients continue to use bearer tokens. Browser clients send `X-Session-Mode: cookie` and a per-tab UUID in `X-Session-Id`: sign-in sets a role/path/tab-scoped HttpOnly, SameSite=Strict cookie and omits the token from JSON. Cookies are Secure on HTTPS (`PUBLIC_ORIGIN` must describe the public origin behind a TLS proxy). Mutating requests with a foreign Origin or cross-site Fetch Metadata are rejected. Error messages never include expected answers.

Faculty sessions expire after eight hours; proctor sessions expire after eight hours or run close; candidate access expires after 24 hours independently of the attempt deadline. Candidate rejoin rotates access and preserves the attempt. Student readiness/join supports a full 500-student class behind one NAT/proxy: the socket-IP ceiling is 5,000 requests/minute, with separate failure ceilings of 10 per run/candidate and 200 per socket IP per minute. Successful requests do not consume the failure budgets. Forwarded IP headers are deliberately ignored. JSON body limits count bytes and reject malformed UTF-8.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Health and demo mode |
| GET | `/api/config` | Platform label, tagline, and demo mode |
| GET | `/api/demo` | Fictional demo run IDs and credentials; 404 outside demo mode |
| POST | `/api/auth/student/join` | Join or resume; `{runId,candidateId,pin}` where `candidateId` is the school ID |
| POST | `/api/auth/student/preview` | Check the same credentials and return readiness details: duration, closing time, feedback mode, question counts, effective retry policies, and whether an attempt already exists. Creates no session or token and leaves existing timers and tokens unchanged. |
| POST | `/api/auth/proctor/join` | Sign in with `{runId,code}`; returns a run-scoped token |
| GET | `/api/proctor/run` | Read-only roster participation, progress, last submission, and remaining time for the token's run; no answers or grades |
| POST | `/api/proctor/logout` | Revoke the current proctor token |
| GET | `/api/me/session` | Persisted order, progress, score, timer |
| GET | `/api/me/missions/current` | Current unlocked public mission |
| GET | `/api/me/missions/:id` | Selected unlocked public mission |
| PUT | `/api/me/activities/:id/draft` | Save a private `{value}` draft; no grading, retry, or score mutation |
| POST | `/api/me/activities/:id/submit` | Submit `{value}`; numeric uses `{value,unit}`. Send a stable `Idempotency-Key` header to safely retry a request |
| POST | `/api/me/activities/:id/preview` | Run `{value:"source code"}` against only the published public samples; returns actual/expected output and match status without recording a submission |
| GET | `/api/me/results` | Current server score and state |
| POST | `/api/me/logout` | Revoke candidate access without finalizing or changing the attempt |
| POST | `/api/me/finalize` | Idempotent final submit |
| POST | `/api/instructor/login` | `{password}` to obtain demo instructor token |
| GET | `/api/instructor/session` | Check the current faculty session |
| POST | `/api/instructor/logout` | Revoke the current faculty token and discard its saved AI proposal |
| GET/POST | `/api/instructor/assessments` | List versions / import `{public,private}` draft |
| GET | `/api/instructor/code/status` | Docker readiness and installed coding languages |
| POST | `/api/instructor/code/preview` | Faculty-only `{config,value}` sample execution for reference-solution checks |
| GET | `/api/instructor/ai/status` | Whether server-side Gemini drafting is configured |
| POST | `/api/instructor/materials/extract` | Extract `{filename,base64}` from `.txt`, `.md`, `.pdf` or `.pptx` into labeled source text |
| POST | `/api/instructor/ai/generate` | Draft from `{title,subject,kind,difficulty,durationMinutes,questionCount,missionCount?,questionMode?,questionTypeCounts?,programmingLanguage?,customPrompt?,source:{filename,content}}`; optional `customPrompt` is faculty guidance up to 2,000 characters and cannot override source grounding or supported formats |
| POST | `/api/instructor/ai/draft` | Save a generated `{public,private,evidence,source}` as a draft with a pending source review |
| POST | `/api/instructor/ai/propose` | Preview generated sections or missions and questions with advisory source-match percentages and question-format checks; same input as `/generate` |
| POST | `/api/instructor/ai/approved-draft` | Save faculty-selected questions and groups as a draft; missing quotes do not block faculty approval |
| GET/PUT/DELETE | `/api/instructor/ai/proposal` | Recover, save, or discard the signed-in faculty session's unfinished `{input,proposal,selected}` preview |
| POST | `/api/instructor/ai/inspect` | Recheck an edited `{source,design,...setup}` proposal against local question validation; no AI call |
| POST | `/api/instructor/ai/check/:id/:version` | Assess whether draft questions and private answers are supported by stored sources |
| GET/POST | `/api/instructor/classes` | List classes / create `{name,section,roster:[{candidateId,displayName,gender?,yearLevel?,programShortName?}]}` |
| GET/PUT/DELETE | `/api/instructor/classes/:id` | Inspect roster / change name and section, optionally replace `roster` / delete class |
| POST | `/api/instructor/classes/:id/students` | Add one student `{candidateId,displayName,gender?,yearLevel?,programShortName?}`; returns updated class |
| PUT/DELETE | `/api/instructor/classes/:id/students/:schoolId` | Edit one student (including school ID) or remove them; returns updated class |
| GET/PUT | `/api/instructor/assessments/:id/:version` | Inspect / update draft JSON |
| POST | `/api/instructor/assessments/:id/:version/archive` | Hide an unused unpublished draft from the current list |
| POST | `/api/instructor/assessments/:id/:version/restore` | Restore an archived draft |
| POST | `/api/instructor/assessments/:id/:version/validate` | Return validation errors |
| POST | `/api/instructor/assessments/:id/:version/publish` | Explicit `{approved:true}`; immutable publication |
| GET/POST | `/api/instructor/assessments/:id/:version/sources` | List source text and coverage / queue extracted `.txt`, `.md`, `.pdf` or `.pptx` text with `{filename,content}` |
| PUT | `/api/instructor/assessments/:id/:version/sources/:sourceId` | Save manual `{topic,learningOutcome,proposedActivityType,evidence,notes}` review |
| GET/POST | `/api/instructor/runs` | List / create runs; new Faculty runs send `classId` and use its saved roster; `feedbackMode` is `graded` or `practice`, `shuffleQuestions` is boolean |
| PUT | `/api/instructor/runs/:id/name` | Change a run's faculty-facing name |
| GET | `/api/instructor/runs/:id/students/:schoolId` | Faculty-only submission history, answer key, automatic and effective points |
| POST | `/api/instructor/runs/:id/students/:schoolId/extend` | Add `{minutes,reason}` to an in-progress or expired attempt before the run closes; minutes 1–120 |
| POST | `/api/instructor/runs/:id/students/:schoolId/reopen` | Reopen a submitted or expired attempt before the run closes with `{minutes,reason}` |
| PUT/DELETE | `/api/instructor/runs/:id/students/:schoolId/scores/:questionId` | Replace question points with `{points,reason}` after attempt ends / restore automatic points |
| GET/POST/DELETE | `/api/instructor/runs/:id/proctor-access` | Inspect access status / issue or replace a code / revoke access; the code is returned only by POST |
| POST | `/api/instructor/assessments/:id/:version/clone` | Create a new editable draft version with the same reviewed sources |
| GET | `/api/instructor/runs/:id/results` | Roster and server scores |
| POST | `/api/instructor/runs/:id/publish-scores` | Release completed attempts' scores |
| POST | `/api/instructor/runs/:id/students/:schoolId/publish-scores` | Release one completed attempt's score |
| GET | `/api/instructor/runs/:id/export.csv` | Gradebook CSV |
| GET | `/api/instructor/audit` | Recent publication, run and session events |

The stored public package keeps the legacy `examId` and `missions` keys for existing versions and runs. New packages add `kind` and `difficulty`; non-CTF groups are shown as sections. Older packages without `kind` receive a display type inferred from their title, while their stored content remains unchanged. Older `/api/instructor/exams` routes remain available for existing clients.

Class updates and deletion affect future runs. A run copies its class roster and class name at creation, so enrolled students and prior results stay intact. Older clients may still pass a roster directly to run creation; the Faculty UI uses `classId`.

### Run creation example

```json
{
  "examId": "archives-demo",
  "version": 1,
  "name": "Section A Finals",
  "feedbackMode": "graded",
  "shuffleQuestions": true,
  "pin": "example-pin",
  "opensAt": "2026-10-28T08:00:00Z",
  "closesAt": "2026-10-28T10:00:00Z",
  "classId": "a1b2c3d4-0000-4000-8000-000000000001"
}
```

The run name is optional and can be changed later with `{ "name": "New name" }` at the name endpoint. It does not change the run ID students use to join. The Faculty UI defaults to `graded`; API callers that omit `feedbackMode` receive `graded`. Existing runs retain their stored feedback mode. `shuffleQuestions` defaults to false and only changes question order within each section or mission; a candidate's order is stored on first join. Graded student responses withhold correctness and score before run close while an attempt is active. Completed attempts can show their score after individual or bulk faculty publication, and scores remain hidden after run close until publication. Recovery clears early publication so new outcomes stay hidden until faculty republishes. A student who started the run can sign in again after closure to view their result. Faculty results remain available throughout. A faculty score override must be a whole number from 0 through the question maximum with a 3–300 character reason. It replaces that question's automatic award minus retry penalties in the total, results, and CSV; DELETE restores automatic grading. Both actions are audited. The server hashes the run PIN in its database and matches the school ID to the roster. The run time window and activity duration both constrain candidate deadlines. Client timestamps, score values, answer criteria, and order values are ignored for grading. Each submitted answer is evaluated against the published private rule.

PDF and PowerPoint text extraction is faculty-only. Binary upload is limited to 10 MB; extracted text is limited to 250,000 characters. The AI flow is limited to 60,000 characters. Older `.ppt` and image-only documents need conversion or OCR. The original binary is not stored. Faculty-only AI drafting is available when `GEMINI_API_KEY` is configured. The AI preview and separate source check estimate how well each question and its answer match the source, from 0 to 100 percent. These estimates do not prove semantic support or decide faculty approval. Package structure and the existence of cited source files are validated; coverage notes are optional. The AI assistant generates all ten engine question types. `questionMode` is `auto` (default; choose a variety), `mixed`, `coding`, or `objective`. In mixed mode supply `questionTypeCounts`, for example `{single_choice:2,matching:1,code_writing:1}`, whose positive counts total `questionCount`; unsupported types and fractional/negative counts are rejected. Generation and repair enforce the requested distribution. Faculty `/ai/inspect` edits and `/ai/approved-draft` approvals may change types, counts, and languages; structural grading and source-review validation still apply. `programmingLanguage` is `auto` (default), `php`, `python`, `sql`, or `javascript`. Coding mode requires code-writing answers in the selected language. `data_inspection` sends `{value:{pageLength,globalSearch,columnSearch,pageIndex,order}}`. `datatable_code` sends `{value:"DataTables JavaScript"}`. The server parses supported calls and computes visible rows from the approved fixture; this DataTables path does not execute arbitrary JavaScript or trust a client-supplied row list. General coding submissions use `code_writing` and `{value:"source code"}`; the server runs the source in restricted containers and compares actual stdout with private tests. The submission response follows the same graded/practice visibility rules and never returns private inputs or outputs. Runner errors `CODE_RUNNER_UNAVAILABLE` (503) and `CODE_RUNNER_BUSY` (429) do not consume attempts. Web projects can include manual rubric criteria, completed through question score adjustments; bonus endpoints remain unavailable. Faculty can review and override scores, extend time, or reopen attempts; these recovery actions require a reason and are audited.

## Migration additions

| Method | Route | Behavior |
|---|---|---|
| POST | `/api/instructor/web-template` | Create a faculty-owned PHP/SQLite draft with a private rubric |
| POST | `/api/instructor/runs/:id/retry-grading` | Retry interrupted grading for the owned run |
| POST | `/api/me/heartbeat` | Record recent connectivity; response includes server time |
| POST | `/api/me/activities/:id/web-preview` | Accept `{value:{files,database?},reset?}` and return an isolated preview URL and database snapshot |

All JSON envelopes include `serverNow`. Faculty login accepts `{username,password}`; omitted username selects the legacy `faculty` owner. New faculty accounts are provisioned through the maintenance CLI.

Draft saves optionally carry `If-Match` containing the last acknowledged `updatedAt` value (empty for the first save); conflicting saves return `DRAFT_CONFLICT`. Revisions remain recoverable after an earlier submission. Acknowledged drafts are finalized on finish or expiry, subject to retry limits. Failed infrastructure jobs block score publication until successfully retried. Web projects with manual rubric criteria require a faculty score adjustment before publication. Graded results never release automatically at run closure.
