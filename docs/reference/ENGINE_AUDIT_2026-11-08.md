# Engine audit — 8 November 2026

## Implementation follow-up — 9 November 2026

The approved release supports up to 200 questions. The original audit and measurements below record the behavior before these changes.

| # | Implemented change |
| --- | --- |
| 1 | Table previews and grading share filtering, ordering and paging rules for each question type. Table cells render as text. |
| 2 | Publication validates choice IDs and labels, accepted text answers, and related question shapes before grading. |
| 3 | Criteria compare object fields independently of JSON property order. Sequence order still matters. |
| 4 | Malformed packages return field errors before semantic checks. |
| 5 | Regeneration shares one budget across the requested questions. Generation saves completed batches and pauses when it reaches the action budget. Faculty can resume with the original provider and model. |
| 6 | Usage reports include failed and retried provider calls. Missing token counts are marked unknown. |
| 7 | Console containers have an independent deadline. The execution host checks for expired containers it owns at startup and periodically. |
| 8 | Generation checks for conspicuous answer length and references to choice positions. The repair pass has a budget, and unresolved clues appear in faculty review. |
| 9 | New attempts save shuffled choice order. Generated sequencing labels drop obvious numbering and use opaque IDs. |
| 10 | Generated console, table and web scaffolds use minimal setup and neutral TODOs. |
| 11 | Faculty can generate, review, publish and grade up to 200 questions. Generation uses batches of up to 20. The browser opens each editor on demand. Source review can continue with only the unchecked questions. |
| 12 | Save, retry and AI messages use shorter wording. Execution status is hidden during objective-only creation and roster management. |

`npm run check` passed 251 tests. Browser checks covered 200-question review, pause and resume, recovery after reload, retention of faculty edits and approvals, and preview-to-grade agreement. The PHP and SQL crash probe removed its disposable containers 5.29 and 5.52 seconds after terminating their Node owners. AI verification used fictional fixtures and mocked provider responses.

## Original audit

Reviewed revision `f7956a59e692c20217d41cfb28e05366df9a0b23` in `D:\code\ctfv1`, using Node.js 22.14.0. The working tree was clean when the review began. This audit adds documentation and measurements; it does not change application behavior, real assessment records, or AI settings.

## Assessment

The existing architecture is worth improving incrementally. Server-owned grading, immutable published versions, advisory AI grades, isolated execution, durable submission jobs, and saved web checkpoints are useful foundations. A rewrite would not address the most important faults as directly as fixing validation and agreement between engines.

The highest priorities are **making the table preview agree with grading** and **preventing publication of questions that the student interface cannot answer**. Six findings below were reproduced with fictional data or mocked providers. The console crash-lifetime finding is based on code inspection and was not tested by crashing Docker or the running application.

The consolidated table includes five additional concerns supplied by the user: answer-length clues, predictable sequencing, overly revealing scaffolds, support for at least about 100 questions, and excessive interface text. Their observed frequency has not been measured in a representative set of real assessments. These additions are audit recommendations and requirements, not completed fixes.

`npm run check` passed: types, syntax, scoped formatting, editor build, and **192 tests, zero failures**. The first sandboxed run encountered localhost fetch failures; the successful full run had localhost access. Passing these tests does not cover the defects reproduced below.

## Consolidated audit table

High and Medium indicate recommended implementation priority. New quality concerns are distinguished from reproduced technical defects.

| # | Priority | Issue or requirement | Evidence/status | Recommended improvement |
| --- | --- | --- | --- | --- |
| 1 | High | Table previews and grading disagree. | Reproduced: multiword search, mixed numeric-string sorting and null-cell handling differ. | Share explicit search, sort and paging rules across authoring, preview and grading; verify that the same state produces the same rows. |
| 2 | High | Unanswerable questions can pass publication checks. | Reproduced: numeric choice IDs conflict with browser strings; an accepted blank text answer cannot be submitted. | Enforce valid string IDs, labels and nonblank accepted answers centrally; verify valid packages through browser serialization and submission. |
| 3 | Medium | JSON property order can change a score. | Reproduced: a semantically correct table answer received 6/8 instead of 8/8. | Compare object fields structurally; preserve meaningful array order. |
| 4 | Medium | Malformed packages crash validation. | Reproduced: null missions and criteria cause TypeErrors. | Validate shapes before semantic checks; return precise field errors instead of internal errors. |
| 5 | Medium | AI regeneration has no shared action budget. | Reproduced with mocks: 20 targets caused 80 provider calls and zero replacements. | Bound total calls, tokens and elapsed time; support cancellation, partial completion and resumable batch jobs. |
| 6 | Medium | AI usage is understated. | Reproduced: a truncated attempt followed by success counted only the successful attempt. | Record every provider attempt and available usage before content validation; associate it with the operation and outcome. |
| 7 | Medium | Console execution can outlive a crashed owner. | Code-inspection risk; no destructive crash verification performed. | Add independent container deadlines, owner/expiry labels and reconciliation for local and remote execution. |
| 8 | High | Multiple-choice answers can be guessed from length: the correct answer is often the longest. | User-observed quality concern; frequency not yet measured. | Generate plausible distractors with comparable detail, length and grammar. Flag conspicuous length differences for review and measure how often the correct option is longest. Shuffling positions alone does not remove this clue. |
| 9 | High | Sequencing choices reveal the answer through their original order or numbering. | User-observed concern. Code preserves generated item order in student choices; question shuffling does not shuffle these choices. | Shuffle the displayed choice pool independently of the private correct sequence, keep that display stable on refresh/rejoin, and remove ordinal clues such as “Step 1” when ordering is what students must infer. Check for repeated identity-order answers. |
| 10 | High | Scaffolds reveal too much solution logic. | User-observed concern. Console generation already simplifies starter code; table and web scaffolds still need a consistent policy. | Supply only setup needed to begin and guidance on where work belongs. Leave the assessed algorithm, query, conditions and interactions to the student. Review starter code against the rubric; offer faculty-controlled guidance levels where useful. |
| 11 | High | Assessments should support at least approximately 100 questions. | New requirement. AI generation and mix validation currently cap requests at 20, with up to five groups of four. This is not a universal storage limit. | Support at least 100 questions across generation, editing, delivery and review. Generate in bounded batches with progress, resume and cross-batch duplicate/coverage checks; update UI, schemas, validation and limits together. Verify exact counts, save/rejoin, grading and navigation at 100 questions before claiming support. |
| 12 | Medium | Messages and explanatory text are too long or irrelevant to the current task. | User-observed usability concern; individual messages need contextual review. | Lead with the current state and next useful action. Remove repeated or irrelevant explanations, show help when applicable, and move optional detail into expandable help. Preserve essential deadline, save/conflict and recovery information. |

## Acceptance criteria for the five additions

| Addition | What a successful change should demonstrate |
| --- | --- |
| Multiple-choice quality | Representative generated sets have plausible distractors, parallel wording and no recurring correct-answer length clue. Length checks flag suspicious items rather than blindly rewriting factual answers to fit a character count. |
| Sequencing quality | The displayed choice order does not reveal the private correct sequence. Refresh and rejoin preserve the assigned display and saved response; grading still uses stable item IDs. |
| Scaffold restraint | Starter code does not satisfy the assessed criteria by itself. Necessary environment setup remains available; the rubric's main learning tasks require student work. Review console, SQL, DataTables, frontend and PHP tasks separately. |
| At least 100 questions | A 100-question assessment can be generated in batches, edited, saved, resumed, delivered, finalized and reviewed without dropped or duplicated questions. Measure load for the intended question mix and class size, especially where projects contain larger payloads. |
| Concise messages | Every always-visible message provides context needed for the current action. Detailed help remains accessible, repeated guidance is removed, and essential state changes and recovery actions remain clear. |

## Scope

| Engine or boundary | Reviewed behavior |
| --- | --- |
| Assessment | Package validation, answer validators, criterion awards, retries, progression and result release |
| AI generation | Source evidence, package construction, repair, targeted replacement, provider requests and usage counters |
| AI grading | Evidence selection, score bounds, advisory behavior and stale-review checks |
| Console execution | Docker arguments, language wrappers, execution limits, cleanup and worker forwarding |
| Web execution and grading | Project validation, isolated workspaces, HTTP checks, manual rubrics and database snapshots |
| Queues and settlement | Admission, idempotency, leases, checkpoint sequencing and expiry |
| Materials | File/text limits, PDF/PPTX extraction and bounded worker execution |

## Prioritized findings

### 1. High — table previews and grading use different search and sort rules

**Evidence:** [server table evaluation](../../src/engine.mjs#L20), [DataTables preview](../../public/student.js#L1050), and [inspection-table sorting](../../public/student.js#L928).

The server searches for the entire normalized term inside an individual cell and sorts with `localeCompare(..., { numeric: true })`. The code preview uses the bundled DataTables library with its default search and type-dependent sorting. DataTables documents that default smart search can match separate words anywhere in a row. [Official search reference](https://datatables.net/ref/core/api/%2Fsearch).

Reproduced against the actual bundled browser library:

- Searching `Alex BSIT` matched a row containing `Alex Rivera` and `BSIT` in separate columns in the preview. The server returned no rows.
- For `Item 2`, `Item 10`, `Item 1`, `Item 20`, `Item 3`, `Item 11`, the server produced natural numeric order. The preview detected string data and produced lexical order: `Item 1`, `Item 10`, `Item 11`, `Item 2`, `Item 20`, `Item 3`.
- The separate data-inspection interface also differs for null cells: its comparator uses `String(null)`, while the server uses an empty string. The same null row appeared in different positions.

**Impact:** a student can see a different set or order of rows from the one used to validate the task and award its visible-row criterion. These differences also affect which table targets authors can construct. Primitive null cells are explicitly permitted by the generated-table builder.

**Recommendation:** define one supported table behavior and share its pure implementation between package construction, browser rendering and grading. The shared module should handle normalization, multiword search, nulls, sorting and paging without importing Node crypto. If preserving DataTables semantics is the goal, specify and test those semantics explicitly. Disabling smart search alone does not address cross-column matching or sorting differences. Add agreement cases for multiword terms, punctuation, mixed numeric strings, nulls and ties.

### 2. High — package validation can approve unanswerable questions

**Evidence:** [option validation](../../src/engine.mjs#L207), [text-answer validation](../../src/engine.mjs#L216), [browser choice serialization](../../public/student.js#L1115), and [submittable-answer checks](../../src/store.mjs#L38).

Two independent cases were reproduced:

1. Options with numeric IDs `1` and `2`, and private answer `1`, pass `validatePackage`. The browser submits the selected input value as string `"1"`. Strict comparison marks it incorrect. The same ID-type issue needs checking in multiple-choice, matching and sequencing configurations.
2. A text question with accepted answer `[""]` passes validation and can be published through `Store.publish`. Its correct empty answer is considered ungradable, and submission returns `INVALID_ANSWER`.

**Impact:** publishing succeeds even though a student cannot earn full credit through the supported interface. The AI builder already rejects some such shapes; imported or directly updated packages use the weaker central validator.

**Recommendation:** make the central package validator authoritative for every entry path. Require nonempty string IDs and labels, unique IDs, appropriate collection sizes, and nonblank accepted text after the same normalization used during grading. Do not silently convert IDs in immutable published records; correct affected content in a new version. Exercise valid packages through browser serialization and submission admission, rather than testing only the evaluator.

### 3. Medium — JSON property order can change a grade

**Evidence:** [JSON-based equality](../../src/engine.mjs#L10) and [table criterion evaluation](../../src/engine.mjs#L65).

`same` compares `JSON.stringify` output. A private sort entry `{ direction: "asc", column: "name" }` passes package validation, but does not compare equal to the browser's `{ column: "name", direction: "asc" }`.

**Reproduction:** changing only that private object's property order in the Week 13 fixture left validation successful. The correct table submission then earned **6/8** rather than **8/8**.

**Recommendation:** compare typed fields, or use structural equality that ignores object-property order while preserving array order. Apply the same rule to flags. Keep sequence and visible-row array order significant.

### 4. Medium — malformed packages can crash the validator

**Evidence:** [criterion loop](../../src/engine.mjs#L147) and [dependency-map construction](../../src/engine.mjs#L164).

Both `missions: [null]` and a private `criteria: [null]` caused `TypeError: Cannot read properties of null (reading 'id')`. An invalid mission is initially reported, but later validation still dereferences it. The criterion loop assumes each entry is an object.

**Impact:** malformed imports or draft updates can turn validation/publication into an internal error instead of an actionable field error. This does not demonstrate unauthorized access or corruption of valid assessments.

**Recommendation:** perform an initial shape pass, then run semantic checks only on well-formed entries. Return field paths such as `missions[0]` and `rules.rule.criteria[0]`. Add a compact malformed-input matrix and bounded size/depth handling rather than patching individual null dereferences.

### 5. Medium — one regeneration request can make 80 provider calls

**Evidence:** [target loop and replacement retries](../../src/ai.mjs#L308), [provider retry loop](../../src/ai-provider.mjs#L199), and [HTTP timeout](../../src/routes/faculty.mjs#L79).

Regeneration accepts up to 20 targets. Each target can make two replacement attempts, and each replacement can make two provider calls. A mocked request with 20 invalid questions reproduced **80 provider calls, zero replacements**, while correctly preserving the originals.

The route timeout is approximately 370 seconds. The theoretical provider wait alone is `20 × 2 × 2 × 90 seconds = 7,200 seconds`, before other overhead. Actual behavior depends on when the provider fails and whether the client or proxy disconnects. The action-level rate limit does not bound calls within an action.

**Recommendation:** enforce a shared call, elapsed-time and token budget for the whole user action, propagate cancellation, and return partial outcomes when that budget ends. For larger batches, persist a job and let the browser poll progress. Preserve the existing property that unsuccessful replacement leaves the original question intact.

### 6. Medium — AI usage counters omit unsuccessful attempts

**Evidence:** [Gemini usage recording](../../src/ai-provider.mjs#L388) and [Groq usage recording](../../src/ai-provider.mjs#L612).

Usage is recorded after successful JSON parsing. Truncated output and invalid-JSON responses can consume tokens without being counted.

**Reproduction:** two mocked Gemini responses each reported 100 input and 20 output tokens. The first was truncated, the second succeeded. The system reported **one request, 100 input and 20 output tokens**, while the responses represented **two requests, 200 input and 40 output tokens**.

**Recommendation:** record each provider attempt as soon as response metadata is available, before content validation. Include action ID, operation, status, latency, requested model and returned model. Record unknown usage as unknown. Persist aggregates if they are intended to survive restarts, and avoid logging teaching text, student answers or credentials. Cost-per-accepted-question measurements should include failed and repaired attempts.

### 7. Medium — bounded console jobs lack an independent crash lifetime

**Evidence:** [language wrappers](../../src/code-runner.mjs#L14), [Docker invocation](../../src/code-runner.mjs#L35), and [cleanup](../../src/code-runner.mjs#L57).

Normal execution has a host timeout and force-removal in `finally`. PHP waits for its child with `proc_close`, and SQL executes its query without an independent wall-clock supervisor. A hard failure of the owning Node process can skip `finally`, leaving a long-running PHP or SQL container. `--rm` removes a container when it exits; it does not impose an execution deadline. [Docker run reference](https://docs.docker.com/reference/cli/docker/container/run/).

The managed web workspace already has an independent lifetime supervisor and installation-scoped reconciliation. The console path does not have the equivalent universal protection. Job-labelled cleanup helps recovered local queued jobs, but does not cover every direct or remote execution path.

**Recommendation:** give every bounded console container an independent wall-clock supervisor plus owner/expiry labels, and reconcile expired owned containers at worker startup and periodically. Add a disposable crash-recovery verification for console execution, similar to the web recovery script. **This finding is a code-based inference; this audit did not deliberately orphan a container.**

## Other improvements worth scheduling

| Area | Suggestion and reason |
| --- | --- |
| Assessment scoring policy | Make cumulative, best-attempt or latest-attempt scoring explicit. Current unique criterion events retain criteria earned across different attempts. That is useful for a progressive CTF, but faculty should know that full credit need not correspond to one fully correct submission. Keep AI suggestions about the latest answer distinguishable from the accumulated score. |
| Schema consistency | Bring the published contract schemas into agreement with runtime validation. The public schema rejects the now-supported sample `transcript`; the private schema still requires reference code and 2–6 input/output tests for every console question, while runtime validation also supports manual rubrics. Validate common fixtures against both routes to prevent future drift. |
| Question quality | Add a small fictional evaluation set for source support, correct answers, ambiguity, solvability, code samples and grade calibration. Structural checks and a matching source quote cannot establish educational correctness. Keep faculty review. |
| Table content rendering | Render table cells and column labels as text. The bundled preview currently interprets cell strings as HTML. In an isolated browser check an image element was created; with the application's CSP reproduced, its inline event handler was blocked. Treat this as markup injection/hardening, not a demonstrated production script-execution exploit. Preserve the CSP. |
| AI efficiency | Continue specializing prompts, and specialize the response schema too: generation still sends the full `draftSchema`. Add budgets before tuning further and compare actual tokens per accepted result. |
| Maintainability | Separate package shape validation, activity semantics, table state and orchestration. Split `Store` around domain responsibilities gradually while preserving transactional boundaries. Introduce stable error codes and typed request/result contracts before moving large amounts of code. |
| Capacity | Measure terminal, console and preview capacity as separate pools. Limits of 8 terminals, 2 bounded console executions and 80 previews are admission settings, not proof that the target machine can sustain a full class at those loads. Use the existing mixed-workflow rehearsal on the intended host. |
| Source workflow | Extraction accepts up to 250,000 text characters; AI generation accepts 60,000. The interface already reports the generation limit. A source-range picker would let faculty select relevant pages/sections instead of editing large extracted text manually. |

## Recommended sequence

| Order | Work | Reason |
| --- | --- | --- |
| 1 | Align table behavior, close unanswerable-package gaps and replace property-order equality. | Protect grading correctness. |
| 2 | Improve distractors, sequencing choices and scaffold restraint; make malformed-package validation total and reconcile schemas. | Protect assessment quality and catch bad content before publication. |
| 3 | Bound whole AI actions, count every attempt and introduce resumable batches; then support at least 100 questions throughout the workflow. | Expand capacity with controlled cost, recovery and quality checks. |
| 4 | Shorten contextual messages and extend independent crash recovery to console jobs. | Improve usability and operational resilience. |
| 5 | Clarify scoring policy, expand educational-quality evaluations, and refactor or tune modules using measurements. | Keep behavior understandable and prevent regressions. |

## Verification and artifacts

- Full check log: `output/engine-audit-check.log` — **192 passed**; type, syntax, formatting and build passed.
- Focused probes: `output/engine-audit-probes.mjs`; assertions passed with fictional in-memory records and mocked AI responses.
- Browser probe: `output/engine-audit-browser.js`, using the real bundled DataTables library in an isolated Playwright page. The temporary browser session was closed.
- Saved measurements: [ENGINE_AUDIT_MEASUREMENTS_2026-11-08.json](ENGINE_AUDIT_MEASUREMENTS_2026-11-08.json). Local logs and probe scripts under `output/` are ignored by Git.

No live AI inference, provider pricing comparison, live classroom load test, production browser workflow, or real Docker crash verification was performed. Existing audits were read as historical context and checked against current source. In particular, Prompt Guard has already been removed from the picker; provider default precedence, requested/returned model counters, prompt specialization, and low reasoning settings have already received changes. Their remaining limitations are described above rather than repeating the earlier audit as if those changes were absent.
