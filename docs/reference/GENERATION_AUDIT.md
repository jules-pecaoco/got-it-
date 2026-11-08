# Assessment generation audit

Scope: faculty generation, table questions, mixed languages, preview repair and targeted regeneration.

## Addressed

- Table questions previously used an unrestricted provider object. The response schema now specifies column definitions, row ID strings, row counts, primitive cells and structured sort entries. Runtime validation remains authoritative for uniqueness, complete rows and references between fields.
- A single table error concealed multiple causes. Errors now identify the exact field, row or column and the expected value shape. Null sort entries and malformed filters produce validation errors rather than JavaScript exceptions.
- Preview repair skipped invalid questions. Invalid supported types now receive a bounded repair attempt with all locally detected question errors. Original previews remain available if the provider fails.
- Language coverage was only a prompt hint. An explicit minimum allocation is now included in generation prompts and checked against generated packages. Impossible counts are rejected before provider calls. Objective and table-only mixes do not require an unrelated SQL console question.
- Multiple selected web workspaces previously permitted unrelated project kinds. Selection validation checks the selected workspace set.
- Preview requests had a shorter timeout than their possible generation-plus-repair work. The response timeout now allows the bounded provider attempts.
- Targeted regeneration bypasses nested automatic repair so retries remain bounded; unaffected questions and approvals remain preserved by the existing regeneration workflow.

## Remaining risks and verification limits

- Structural validation cannot establish that an answer is educationally correct or that code/reference outputs work. Faculty review remains necessary; source-match percentages are advisory.
- Provider JSON-schema support and model compliance must be checked against the configured live model. Regression tests use controlled provider responses; no live quota is spent by tests.
- Provider outages, quota limits and insufficient source material can still leave an editable invalid preview. These are reported rather than converted into invented rows, answers or source evidence.
- Existing saved previews are not silently rewritten. Regenerate invalid questions to apply the current generation contract.
- Reverse proxies may impose a shorter upstream timeout than the application response timeout.
- The broader suite has an independently reproducible expiry/result-publication failure reported earlier in this chat; it is outside these generation changes.
