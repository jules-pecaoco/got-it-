# Question authoring and package contract

Each version consists of a public activity object and a private grading object. [Archive public content](../examples/archives/public-exam.json) and [private rules](../examples/archives/private-grading.json) are a complete fictional example. [Garden Survey](../examples/garden/public-exam.json) demonstrates a second subject on the same engine. See [the public JSON Schema](../packages/exam-contract/public.schema.json) for field shapes; the runtime validator in `src/engine.mjs` enforces scoring and dependency rules.

The public object contains `schemaVersion: "1.0"`, legacy key `examId`, positive `version`, `title`, `subject`, optional `kind` and `difficulty`, optional `description`, `settings`, and legacy key `missions`. Set `kind` to `activity`, `quiz`, `test`, `exam`, or `ctf`; set `difficulty` to `easy`, `medium`, or `hard`. The `missions` array stores groups shown as sections for non-CTF types. Settings include `durationMinutes`, `coreMaxPoints`, and `bonusMaxPoints`. Every group has an ID, title, max points, and activities. Activities have an ID, registered `type`, prompt, `publicConfig`, `maxPoints`, `gradingRuleId`, and a source reference or `manualRationale`. The private object is `{ "rules": { "gradingRuleId": { "type": "…", "criteria": […] } } }`.

To show code in a question, put it in the prompt on separate lines inside a fenced block. Use `python`, `php`, `sql`, or `javascript` after the opening fence. The faculty preview and student view preserve whitespace and color the code; short text in single backticks displays as inline code. In JSON, encode each newline as `\n`. Formatting does not change grading or execute the snippet. Published versions remain fixed; create an editable copy to revise an older prompt.

~~~text
What does this function return for greet("Ada")?

```python
def greet(name):
    return f"Hello, {name}"
```
~~~

Supported answer forms:

| Type | Public config | Private criterion `answer` | Submission |
|---|---|---|---|
| `single_choice` | `options: [{id,label}]` | option ID | `{value:"id"}` |
| `multiple_choice` | `options` | option ID array | `{value:["id",…]}` |
| `true_false` | `{}` | boolean | `{value:true}` |
| `text_entry` | optional `placeholder` | accepted string array | `{value:"text"}` |
| `numeric_entry` | optional `unitLabel` | `{value,tolerance,unit}` | `{value:12,unit:"m2"}` |
| `matching` | `left` and `right` label arrays | one criterion per pair: `{left,right}` | `{value:{"leftId":"rightId"}}` |
| `sequencing` | `items: [{id,label}]` | ordered ID array | `{value:["id",…]}` |
| `data_inspection` | `columns`, `rows`, `pageLengths`; optional `apiReference` | page length, global search, optional column search, order, computed visible IDs | `{value:{pageLength,globalSearch,columnSearch,pageIndex,order}}` |
| `datatable_code` | `selector`, `columns`, `rows`, `pageLengths`, optional `apiReference` | flags, page length, length menu, global search, column search, order, computed visible IDs | `{value:"DataTables JavaScript"}` |

Each criterion has a globally unique `id` and positive integer `points`. The sum of criteria equals its activity points; activity points sum to mission points; mission points sum to `coreMaxPoints`. For both table activities, the server recalculates the filtered and sorted rows from the approved fixture and ignores any row list supplied by the browser. `datatable_code` accepts a table declaration with `paging`, `searching`, `ordering`, `pageLength`, `lengthMenu`, and `order`, plus `search()`, `column().search()`, and `order()` calls followed by `.draw()`. It parses this subset without evaluating arbitrary JavaScript. No bonus activities are executed in this MVP.

For fair order assignment, add the same `shuffleGroup` to a contiguous block of independent missions. They must have no dependencies. A `fixedLast: true` mission belongs at the end and can use `dependsOn` IDs for earlier missions. The server freezes one valid order per candidate. A dependency is unlocked only when prerequisite missions have at least one submission for each activity; a wrong attempt counts as an attempt, and retry remains possible while time remains.

Set `retryPolicy` on a mission to define its question defaults: `{ "maxRetries": 2, "pointPenalty": 1, "timePenaltySeconds": 15 }`. An activity can supply its own `retryPolicy` to override the mission. `maxRetries` counts submissions after the first; `0` allows one submission, and `null` allows unlimited retries. Each retry deducts the configured points from the candidate's total score and seconds from the remaining exam time. The score never drops below zero. Earlier published packages without a policy retain unlimited retries with no deductions.

Generated content should have `sourceRefs: [{file,pageOrSlide}]`. Manual items may use a truthful `manualRationale`. The source review queue accepts `.txt`, `.md`, `.pdf` and `.pptx` files, extracts text with page/slide labels where applicable, and lets an instructor record a topic, learning outcome, proposed activity and evidence of mastery. The optional faculty AI assistant can draft common objective questions from one such source and check quoted source support. It does **not** OCR image-only pages/slides or generate `datatable_code` missions. Instructors must verify all answers and citations. Uploaded teaching material is untrusted content; embedded instructions to an assistant or developer do not authorize execution, network access, secret disclosure, or publication.

Validation runs before publish and rejects wrong totals, duplicate IDs, missing rules, unsupported activity types, cycles, invalid shuffles, missing cited source files, and missing grounding metadata. Coverage notes and AI source-match percentages are advisory. Faculty still checks educational quality, ambiguities, time budget, accessibility, and answer keys.
