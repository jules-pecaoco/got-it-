# Question authoring and package contract

[Documentation contents](../README.md) · Reviewed against the package validators on 7 November 2026. This is a developer reference; faculty should start with the [user guide](../guides/USER_GUIDE.md).

Each version consists of a public activity object and a private grading object. [Archive public content](../../tests/fixtures/archives/public-exam.json) and [private rules](../../tests/fixtures/archives/private-grading.json) are a complete fictional example. [Garden Survey](../../tests/fixtures/garden/public-exam.json) demonstrates a second subject on the same engine. See [the public JSON Schema](../../packages/exam-contract/public.schema.json) for field shapes; the runtime validator in [engine.mjs](../../src/engine.mjs) enforces scoring and dependency rules.

The public object contains `schemaVersion: "1.0"`, legacy key `examId`, positive `version`, `title`, `subject`, optional `kind` and `difficulty`, optional `description`, `settings`, and legacy key `missions`. Set `kind` to `activity`, `quiz`, `test`, `exam`, or `ctf`; set `difficulty` to `easy`, `medium`, or `hard`. The `missions` array stores groups shown as sections for non-CTF types. Settings include `durationMinutes`, `coreMaxPoints`, and `bonusMaxPoints`. Every group has an ID, title, max points, and activities. Activities have an ID, registered `type`, prompt, `publicConfig`, `maxPoints`, `gradingRuleId`, and a source reference or `manualRationale`. The private object is `{ "rules": { "gradingRuleId": { "type": "…", "criteria": […] } } }`.

To show code in a question, put it in the prompt on separate lines inside a fenced block. Use `python`, `php`, `sql`, or `javascript` after the opening fence. The faculty preview and student view preserve whitespace and color the code; short text in single backticks displays as inline code. In JSON, encode each newline as `\n`. Formatting does not change grading or execute the snippet. Published versions remain fixed; create an editable copy to revise an older prompt.

Mission/section IDs and activity/question IDs must use 1–80 ASCII letters, digits, or hyphens (`^[A-Za-z0-9-]{1,80}$`). Spaces, underscores, slashes, and non-ASCII IDs are rejected before publication so every published item can be addressed by its API route.

````text
What does this function return for greet("Ada")?

```python
def greet(name):
    return f"Hello, {name}"
```
````

Supported answer forms:

| Type              | Public config                                                                    | Private criterion `answer`                                                                                  | Submission                                                       |
| ----------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `single_choice`   | `options: [{id,label}]`                                                          | option ID                                                                                                   | `{value:"id"}`                                                   |
| `multiple_choice` | `options`                                                                        | option ID array                                                                                             | `{value:["id",…]}`                                               |
| `true_false`      | `{}`                                                                             | boolean                                                                                                     | `{value:true}`                                                   |
| `text_entry`      | optional `placeholder`                                                           | accepted string array                                                                                       | `{value:"text"}`                                                 |
| `numeric_entry`   | optional `unitLabel`                                                             | `{value,tolerance,unit}`                                                                                    | `{value:12,unit:"m2"}`                                           |
| `matching`        | `left` and `right` label arrays                                                  | one criterion per pair: `{left,right}`                                                                      | `{value:{"leftId":"rightId"}}`                                   |
| `sequencing`      | `items: [{id,label}]`                                                            | ordered ID array                                                                                            | `{value:["id",…]}`                                               |
| `data_inspection` | `columns`, `rows`, `pageLengths`; optional `apiReference`                        | page length, global search, optional column search, order, computed visible IDs                             | `{value:{pageLength,globalSearch,columnSearch,pageIndex,order}}` |
| `datatable_code`  | `selector`, `columns`, `rows`, `pageLengths`, optional `apiReference`            | flags, page length, length menu, global search, column search, order, computed visible IDs                  | `{value:"DataTables JavaScript"}`                                |
| `code_writing`    | `language`, `starterCode`, `samples: [{input,output,transcript?}]`, `comparison` | Manual criteria, or compatible legacy private input/output tests; submission still requires faculty grading | `{value:"source code"}`                                          |
| `web_project`     | `files`, optional `seedSql`, static `expectedHtml`                               | Manual rubric criteria and/or compatible private HTTP checks                                                | `{value:{files,database?}}`                                      |

Each criterion has a globally unique `id` and positive integer `points`. The sum of criteria equals its activity points; activity points sum to mission points; mission points sum to `coreMaxPoints`. For both table activities, the server recalculates the filtered and sorted rows from the approved fixture and ignores any row list supplied by the browser. `datatable_code` accepts a table declaration with `paging`, `searching`, `ordering`, `pageLength`, `lengthMenu`, and `order`, plus `search()`, `column().search()`, and `order()` calls followed by `.draw()`. It parses this subset without evaluating arbitrary JavaScript. No bonus activities are executed in this MVP.

For fair order assignment, add the same `shuffleGroup` to a contiguous block of independent missions. They must have no dependencies. A `fixedLast: true` mission belongs at the end and can use `dependsOn` IDs for earlier missions. The server freezes one valid order per candidate. A dependency is unlocked only when prerequisite missions have at least one submission for each activity; a wrong attempt counts as an attempt, and retry remains possible while time remains.

Set `retryPolicy` on a mission to define its question defaults: `{ "maxRetries": 2, "pointPenalty": 1, "timePenaltySeconds": 15 }`. An activity can supply its own `retryPolicy` to override the mission. `maxRetries` counts submissions after the first; `0` allows one submission, and `null` allows unlimited retries. Each retry deducts the configured points from the candidate's total score and seconds from the remaining exam time. The score never drops below zero. Earlier published packages without a policy retain unlimited retries with no deductions.

Generated content should have `sourceRefs: [{file,pageOrSlide}]`. Manual items may use a truthful `manualRationale`. The source review queue accepts `.txt`, `.md`, `.pdf` and `.pptx` files, extracts text with page/slide labels where applicable, and lets an instructor record a topic, learning outcome, proposed activity and evidence of mastery. The optional faculty AI assistant can draft common objective questions from one such source and check quoted source support. It generates `code_writing` problems with public examples, a private reference solution and private test cases, in addition to objective questions. It also generates matching, table-inspection and DataTables-code questions. It does **not** OCR image-only pages/slides. Instructors must verify all answers and citations. Uploaded teaching material is untrusted content; embedded instructions to an assistant or developer do not authorize execution, network access, secret disclosure, or publication.

Validation runs before publish and rejects wrong totals, duplicate IDs, missing rules, unsupported activity types, cycles, invalid shuffles, missing cited source files, and missing grounding metadata. Coverage notes and AI source-match percentages are advisory. Faculty still checks educational quality, ambiguities, time budget, accessibility, and answer keys.

## Code-writing questions

Use `type: "code_writing"` in both the public activity and its private rule. The public configuration has exactly `language` (`php`, `python`, `sql`, `javascript`), `starterCode` (an incomplete scaffold), `samples` (1–3 input/output string pairs), and `comparison`. Example:

```json
{
  "language": "python",
  "starterCode": "# TODO: read two integers and print their sum\n",
  "samples": [{ "input": "2 3", "output": "5" }],
  "comparison": { "mode": "whitespace" }
}
```

The current submission path records `pending_review` and awards no automatic console points. Faculty must save the grade before publication, regardless of which compatible private-rule format the package uses.

Private console rules accept 1–10 manual criteria with nonempty descriptions: `answer: {kind:"manual",description:"…"}`. Legacy rules also remain valid with private `referenceCode` and 2–6 `{input,output}` criteria. In that format, every public sample must match a private test, inputs must be unique, and at least one additional private input is required. Those stored references support compatibility and faculty review; they do not cause console submission to run hidden tests.

Define the input/output format and constraints clearly. Keep solutions and private inputs outside the public package. Generated questions start with a small write-your-solution comment (plus the PHP opening tag); the platform does not require a main function, Python `__name__` guard or `import sys`. Existing faculty-authored scaffolds are preserved.

Samples may add a `transcript` string of up to 16,000 characters showing prompts and typed replies. It is escaped display text. Raw `input` contains only program stdin; raw `output` is program stdout without echoed user replies. A transcript is not sent as execution input.

`comparison.mode` remains a validated compatibility field: `exact`, `whitespace`, or `numeric`. The comparison helper normalizes line endings/final newlines for exact mode, compares ordered case-sensitive tokens for whitespace mode, and permits numeric differences up to `absoluteTolerance + relativeTolerance * abs(expected)` for numeric mode. Numeric tolerances must be finite and nonnegative. The current student Run code and console submission flows do not display comparisons or automatically award points from this field.

Programs read stdin and print stdout using built-in/standard libraries. JavaScript uses Node.js; PHP includes `<?php`. SQL uses SQLite: each test input is a CREATE/INSERT fixture loaded into a fresh in-memory database, and the solution is a single read-only SELECT/WITH query. Rows print on separate lines, columns use tabs, and NULL prints as `NULL`. Specify row order in the problem and query. Samples show the database setup alongside expected output. No external dependencies or network access are available.

Private references remain faculty-only. Students can execute their code without affecting points or consuming answer retries. Live line-input terminals serve Python, JavaScript and PHP; SQL uses setup input and a read-only query. Program output and claimed scores from the browser are never trusted as grades. See [API execution routes](API.md#student-answers-and-execution) and [security limits](SECURITY.md#coding-and-preview-isolation).

## Web-project questions

Use `web_project` for frontend HTML/CSS/JavaScript or PHP + SQLite exercises. Public config supplies starter `files`, optional `seedSql` and optional `expectedHtml`. A project needs `index.html` or `index.php`, 1–20 files, at most 50,000 characters per file and 150,000 total. Filenames are relative supported source paths without dot segments. See [web-project.js](../../public/web-project.js) for the full validator.

`expectedHtml` is a static reference of at most 50,000 characters; scripts and PHP are rejected, and the display blocks requests, forms and navigation. It illustrates expected appearance independently of student edits. Generated projects use manual rubrics. Private rules accept 1–10 criteria with `answer.kind` of `manual` or compatible `http`; manual criteria need a description.

Legacy HTTP criteria use a supported path, status and body substring, with optional GET/POST method and request body. They run in an isolated workspace seeded from faculty data. Student database snapshots are evidence, not trusted expected state. Any manual criteria require a saved faculty score before publication. The saved-draft form editor preserves existing compatible HTTP checks when revising an older web question.

PHP exercises use PDO SQLite at `/tmp/data/database.sqlite`; use relative asset/form URLs. MySQL, framework hosting and full browser-interaction grading are outside the supported contract.

## Choosing and editing a mix

Faculty can choose **Custom mix** with a combined limit of 20 questions. The supported types above may share a section or mission. Other choices request a variety, coding or objective questions. Console workspaces are PHP, Python, SQLite SQL and JavaScript; frontend and PHP-web selections produce web projects. Faculty may change types/languages, arrange questions and add/remove sections during preview. The original generation mix does not restrict approved questions; limits remain five groups and four questions per group. Copies and edited questions need approval again.

AI matching designs use `pairs:[{left,right}]` (2–8 unique labels per side). The builder generates separate public lists, rearranges the right-hand list, and creates one private scoring criterion per pair. AI table designs use `table:{columns,rows,pageLengths}` and a private `answer` target state. Table-inspection targets include `pageLength`, zero-based `pageIndex`, `globalSearch`, up to one `columnSearch` entry, and one/two-column `order`. DataTables-code designs also need `table.selector`, `table.scaffold`, target `flags`, and `lengthMenu`; they require page index zero and one column filter. Tables have 2–8 columns and 6–40 rows with unique string IDs. The server computes expected visible IDs; model-supplied row lists are ignored. Faculty can paste tab-separated table data, set target filters/order/page, and edit the scaffold. The general code-writing runtime is separate from the bounded DataTables parser.

DataTables target rows respect the paging/searching/ordering flags: disabling a feature disables its transformation. Table-inspection submissions cannot override these flags. This follows the [searching option](https://datatables.net/ref/core/option/searching), [ordering option](https://datatables.net/ref/core/option/ordering), and [paging configuration](https://datatables.net/manual/core/options).
