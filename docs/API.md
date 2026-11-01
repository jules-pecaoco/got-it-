# API contracts

JSON responses have `{ok, data, requestId}` or `{ok:false, code, message, requestId, retryAfterSeconds}`. All `/api/me/*` routes require a candidate bearer token. All `/api/instructor/*` routes except login require an instructor bearer token. `/api/proctor/*` requires a run-scoped proctor bearer token. Error messages never include expected answers.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Health and demo mode |
| GET | `/api/config` | Platform label, tagline, and demo mode |
| GET | `/api/demo` | Fictional demo run IDs and credentials; 404 outside demo mode |
| POST | `/api/auth/student/join` | Join or resume; `{runId,candidateId,pin}` where `candidateId` is the school ID |
| POST | `/api/auth/proctor/join` | Sign in with `{runId,code}`; returns a run-scoped token |
| GET | `/api/proctor/run` | Read-only roster participation, progress, last submission, and remaining time for the token's run; no answers or grades |
| POST | `/api/proctor/logout` | Revoke the current proctor token |
| GET | `/api/me/session` | Persisted order, progress, score, timer |
| GET | `/api/me/missions/current` | Current unlocked public mission |
| GET | `/api/me/missions/:id` | Selected unlocked public mission |
| PUT | `/api/me/activities/:id/draft` | Save a private `{value}` draft; no grading, retry, or score mutation |
| POST | `/api/me/activities/:id/submit` | Submit `{value}`; numeric uses `{value,unit}`. Send a stable `Idempotency-Key` header to safely retry a request |
| GET | `/api/me/results` | Current server score and state |
| POST | `/api/me/finalize` | Idempotent final submit |
| POST | `/api/instructor/login` | `{password}` to obtain demo instructor token |
| GET/POST | `/api/instructor/assessments` | List versions / import `{public,private}` draft |
| GET | `/api/instructor/ai/status` | Whether server-side Gemini drafting is configured |
| POST | `/api/instructor/materials/extract` | Extract `{filename,base64}` from `.txt`, `.md`, `.pdf` or `.pptx` into labeled source text |
| POST | `/api/instructor/ai/generate` | Draft from `{title,subject,kind,difficulty,durationMinutes,questionCount,missionCount?,customPrompt?,source:{filename,content}}`; optional `customPrompt` is faculty guidance up to 2,000 characters and cannot override source grounding or supported formats |
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

The run name is optional and can be changed later with `{ "name": "New name" }` at the name endpoint. It does not change the run ID students use to join. The Faculty UI defaults to `graded`; API callers that omit `feedbackMode` keep `practice` for compatibility. Existing runs retain Practice feedback. `shuffleQuestions` defaults to false and only changes question order within each section or mission; a candidate's order is stored on first join. Graded student join, submission, session, and finalization responses withhold correctness and score until the run closes. A student who started the run can sign in again after closure to view their result. Faculty results remain available throughout. A faculty score override must be a whole number from 0 through the question maximum with a 3–300 character reason. It replaces that question's automatic award minus retry penalties in the total, results, and CSV; DELETE restores automatic grading. Both actions are audited. The server hashes the run PIN in its database and matches the school ID to the roster. The run time window and activity duration both constrain candidate deadlines. Client timestamps, score values, answer criteria, and order values are ignored for grading. Each submitted answer is evaluated against the published private rule.

PDF and PowerPoint text extraction is faculty-only. Binary upload is limited to 10 MB; extracted text is limited to 250,000 characters. The AI flow is limited to 60,000 characters. Older `.ppt` and image-only documents need conversion or OCR. The original binary is not stored. Faculty-only AI drafting is available when `GEMINI_API_KEY` is configured. The AI preview and separate source check estimate how well each question and its answer match the source, from 0 to 100 percent. These estimates do not prove semantic support or decide faculty approval. Package structure and the existence of cited source files are validated; coverage notes are optional. The AI assistant currently generates common objective question types, not table-code missions. `data_inspection` sends `{value:{pageLength,globalSearch,columnSearch,pageIndex,order}}`. `datatable_code` sends `{value:"DataTables JavaScript"}`. The server parses supported calls and computes visible rows from the approved fixture; it never executes submitted code or trusts a client-supplied row list. Arbitrary student JavaScript execution, subjective review, and bonus endpoints are unavailable. Faculty can review and override scores, extend time, or reopen attempts; these recovery actions require a reason and are audited.
