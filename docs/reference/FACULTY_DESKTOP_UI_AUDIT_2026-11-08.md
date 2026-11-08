# Faculty UI audit — laptop and desktop priority

[Documentation contents](../README.md) · 8 November 2026

The faculty interface has a usable visual identity and recognizable controls. Its main weakness is information hierarchy: context, progress, settings, explanatory text and secondary actions consume space before the actual task. Extra desktop width frequently creates longer rows or blank space rather than making reviewing and grading easier.

Retain the navy/gold identity, light sidebar, Poppins headings and system-font controls. Reorganize the work surfaces around browsing, authoring, assigning and grading. Two reproducible grading-flow defects should be fixed before cosmetic changes.

The review used the current working tree and fictional in-memory records. Primary viewports were **1366×768**, **1440×900** and **1920×1080**, with **1280×720** checked for Results. It inspected Activities, creation/custom mix, draft review/question editing, rules, teaching sources, Classes/roster editing, assignment, Results, grading and AI settings. No application code or real records were changed. Findings below distinguish reproduced behavior from design recommendations.

**Fix these workflow defects first**

1. **[P1] Unsaved grades and feedback disappear when moving between students.** Entering `7` points and “Unsaved faculty audit feedback” for Jamie Cruz, selecting Next student, then Previous student returned the form to `0` and an empty reason. No confirmation appeared. The saved backend grade was not changed; the unsaved faculty work was lost. Close also clears the review, and the page-exit guard tracks question/rule/title edits rather than grade-form edits.

   Track grade-form changes. Offer Save & next, Save, and Discard. Protect Previous/Next, Close, workspace/run changes and page exit. Preserve an unsaved form during a temporary error or reauthentication. Do not silently autosave a score merely because someone navigates away.

   Source: [faculty.js:3318](../../public/faculty.js#L3318), [faculty.js:3523](../../public/faculty.js#L3523), [faculty.js:3839](../../public/faculty.js#L3839). Evidence: [main measurements](../../output/playwright/faculty-ui-audit-results.log), [returned grade screenshot](../../output/playwright/faculty-ui-unsaved-grade.png).

2. **[P2] Review navigation ignores the current student filter.** With Student status set to Submitted, opening Jamie and selecting Previous student opened Sam Lee, whose attempt was In progress. The list excluded Sam, but the review navigation still included him because it uses all rows with a session.

   Make the review queue follow the visible filters and selected grading task. Show “1 of 2 submitted students,” preserve the queue when opening/closing review, and distinguish active attempts from work ready to grade. Add a Needs grading filter; Submitted and Scores hidden do not identify that task precisely.

   Source: [faculty.js:3324](../../public/faculty.js#L3324). Evidence: [filter reproduction](../../output/playwright/faculty-ui-followup-results.log), [out-of-filter student screenshot](../../output/playwright/faculty-ui-filtered-grading.png).

**Measured layout findings**

Positions are CSS pixels from the top of the viewport at page scroll zero, unless stated otherwise. They describe the captured fixture states, not every assessment.

| Screen | Observed at 1366×768 | Consequence | Recommended direction |
| --- | --- | --- | --- |
| Activities | First row at y≈370; rows about 103px tall | Only a few records fit; titles and actions are widely separated on a large monitor | Compact collection header, constrained search, aligned metadata, one main row action and More |
| Create activity, healthy AI status | Teaching source at y≈892; Generate at y≈1385 | The required input and final action are off-screen before any substantive work | Source upload near the top; grouped two-column settings; visible action area |
| Custom question mix | Eleven type-count controls occupy roughly 504px vertically | Configuration becomes a long form | Compact type/count list; show enabled types, with Add type for the rest |
| Valid draft review | Publish at y≈478; first question starts at y≈913 | The primary review content begins below the laptop viewport | Compact activity header, questions directly below, local issue summary and clear publish action |
| Rules | Save changes at y≈830 | A small rule form still needs scrolling to save | Group related settings in columns and keep Save reachable |
| Class roster | Add student form at y≈498; table header at y≈762; Add class form at y≈1769 | The roster and class-management tasks interrupt each other | Separate class collection, roster detail and add/edit dialogs or panels |
| Assign to class | Summary at y≈979; Assign at y≈1275 | Review and confirmation are detached from inputs | Form plus adjacent summary; explicit schedule; persistent primary action |
| Results | First student row at y≈723, including at 1280×720 | The first row is almost or completely outside the initial laptop viewport | Merge repeated headers; compact counts and toolbar; move utilities to More |
| Grading | After opening review, Save score was around y≈806 even for a two-line answer | Faculty repeatedly scroll between the answer, AI tools and score | Answer/reference on the left, grade panel on the right, Save & next visible |

The draft-review measurement was repeated after adding its required fictional source: validation passed and Publish was enabled, while the first question remained at y≈913. Creation was also repeated with a simulated healthy AI availability response. These findings are not caused solely by missing-service warnings.

Sources: [faculty.html:109](../../public/faculty.html#L109), [faculty.html:395](../../public/faculty.html#L395), [faculty.html:488](../../public/faculty.html#L488), [faculty.js:1837](../../public/faculty.js#L1837), [faculty.js:2810](../../public/faculty.js#L2810), [faculty.js:3318](../../public/faculty.js#L3318). Measurements: [main](../../output/playwright/faculty-ui-audit-results.log), [healthy states](../../output/playwright/faculty-ui-healthy-results.log).

**Recommended screen structure and element moves**

| Area | Move, simplify or add | Resulting flow |
| --- | --- | --- |
| Global header | Retain branding and account. Put healthy execution status in a compact status control; expand details/recheck on demand. Display an actionable failure banner when needed. | Healthy infrastructure takes little space; failures remain discoverable. The current healthy service row consumes about 57px on every faculty screen. |
| Navigation | Keep Activities, Classes and Results as the stable global destinations. Put Questions, Rules, Sources and Assignment inside the opened activity's local navigation. | Avoid mixing global workspaces and selected-activity tasks in the same rail. Make the selected activity name explicit when those local tasks are open. |
| Activities | Merge Continue draft and Edit activity for drafts; both currently open the same review workspace. Put Archive/Delete in More. Keep published View and Assign distinct; label published editing as Create editable copy. | One clear action to continue a draft, fewer repeated controls, and less ambiguity about published versions. |
| Create activity | Lead with activity identity and teaching material. Put format/count/difficulty together, languages/project types together, and duration nearby. Keep the chosen AI provider as a small contextual line rather than a second large header. | Faculty sees the required source and the assessment configuration together. Keep disclosure about sending teaching material next to upload/generation. |
| Custom mix | Use a compact enabled-type list with numeric counts, a visible total, and an Add question type control. Keep the full catalog available in a picker. | No need to scan eleven large inputs when only four types are used. |
| Review and publish | Put the name and version in one header with inline Rename. Place rules in a compact summary. Move paper printing and answer-key export to Tools. Put the question list and selected editor in the main work area. | Question inspection begins promptly. Show the actual publish blockers beside the publish action and link directly to affected questions. |
| Question editing | Open the editor as the main task, with the question list alongside and Preview as a tab or adjacent region. Avoid rendering the entire reference/sample preview before a second full editor for the same question. | Editing does not require scrolling through a long preview to reach editable fields and Save question. |
| Classes | Put Add class in the collection header. Open a selected class as a roster view with class name/section, search, Import roster and Add student. Move student/class forms out of the initial roster view. | Reading or finding students takes priority over empty add forms. Keep “roster changes do not alter existing runs” visible near import/replacement. |
| Assignment | Use two columns for name/class/PIN/feedback and schedule, with a narrower summary. Offer explicit opening/closing date and time, retaining simple presets such as seven days. Show timezone and individual attempt duration separately. | The backend supports opening/closing timestamps, while the current form exposes only a joining-window day count. Faculty can inspect the schedule before assigning. |
| Results | Use one heading: Results plus the selected class activity. Put the run picker and compact participation counts in the same upper area. Keep search and a task filter above the table. Move Export, Edit run, Access and Delete into a labeled More menu. | The first students and Review action appear earlier. Keep deletion confirmation and publication safeguards. |
| Grading | Put submission/prompt/reference in a wide reading column and points/feedback/save in a 280–320px panel. Place optional AI assistance after the essential grading controls, with its data-sharing explanation accessible before requesting it. | The present wide AI button and paragraph precede Points and Save, giving the optional aid excessive priority. Keep Save & next, Previous/Next and queue position visible. |
| Score publication | Separate Needs grading, Ready to publish and Published from participation status. Keep the eligible count on the publication action. | “Scores hidden” currently combines active students with submitted work and is not a grading queue. Explain why Publish is unavailable and link to the work that needs attention. |

**Visual system: keep the identity, clarify its roles**

The computed interface already uses Poppins for headings and Segoe UI/Arial for controls and operational text. Keep this arrangement. A full font replacement or color rebrand would provide less value than fixing layout and workflow.

| Element | Recommended treatment |
| --- | --- |
| Brand/primary actions | Keep navy **#182E7B** for the header, primary actions and selected links. Use one clear primary action per task region. |
| Gold | Keep **#FDC800** for active navigation or a small brand accent. Avoid using the same large yellow treatment for ordinary success notices and warnings. |
| Content | Use existing dark neutral **#20283D** for normal text, names, scores and data. Reserve navy emphasis for headings/navigation/actions. |
| Secondary content | Keep **#526078** for metadata. Avoid reducing essential table labels below about 14px to solve spacing problems. |
| Surfaces | White task area, **#F3F5FA** surrounding/rail surface, **#D5DCEA** quiet separators. Use stronger borders primarily for editable controls. |
| State colors | Use green for success/saved, amber for actionable caution, red for error/destructive action. Pair each with text; retain distinct Awaiting grade and Visible to student labels. |
| Buttons | Main action filled navy; secondary action quiet outline; utilities text or More. Keep Delete visually secondary until its confirmation. Current disabled buttons remain quite prominent; make the reason clear beside them rather than relying on gray styling. |
| Typography | Start with 26–28px page titles, 18–20px section headings, 14–16px operational text and 14px table data. Use medium labels and semibold headings; avoid giving every count and helper line equal emphasis. |
| Density | Use an 8px spacing rhythm: 8–12px within a control group, 16px between related groups and 24px between tasks. Target 44–56px desktop table rows where content permits. Preserve roughly 44px effective targets for touch input. |
| Corners/icons | The restrained institutional style works. A consistent 4px control radius is an optional refinement; avoid pill-shaped controls throughout. Keep labeled, consistent line icons. |

These are design recommendations, not evidence of measured user preference. Final contrast, focus and status treatments should be verified on the implemented screens.

**Laptop-first acceptance criteria**

- At **1366×768** and **1280×720**, Results should show the first student without scrolling the whole page. Aim for the first row around y=320–380 and at least five useful rows, depending on the chosen density.
- Grading should show submission context, editable Points/Feedback and Save & next together for a short answer. Longer code may scroll in its own reading region while grading controls remain reachable.
- Navigating away from a changed grade must offer a deliberate resolution; a failed save must keep the entered values. Next/Previous must follow the stated queue.
- Creation should expose the required teaching source early, and keep Generate plus its current disabled reason reachable while configuring questions.
- Assignment should show the class, admission schedule, individual time limit and primary action without scrolling through a long single-column form.
- At **1920×1080**, use extra width for adjacent task panes. Constrain reading paragraphs and configuration forms; avoid stretching search fields and pushing row actions far from their titles.
- Preserve keyboard focus and page/queue position when opening/closing editors. Keep horizontal scrolling confined to genuinely wide tables. Smaller screens should stack these regions cleanly, but should not determine desktop composition.

**Implementation order**

1. Protect unsaved grade forms and make review navigation follow the filtered queue.
2. Recompose Results and grading; add Needs grading / Ready to publish task views.
3. Simplify the global shell and separate activity-local navigation.
4. Recompose creation, review and assignment using desktop columns and local action areas.
5. Separate class collection/roster/forms and simplify library row actions.
6. Refine density, colors and component styling after the task layouts are in place.

The underlying style rules also merit consolidation. `app-theme.css` changes faculty shell/layout and then overrides them again later; it combines theme tokens with structure. The shell's minimum height subtracts the masthead but does not account for the healthy service row, contributing to unnecessary outer scrolling in sparse states. Consolidate shell, task layout, components and visual tokens before adding more overrides.

This audit produced **29 measured screen/viewport states**, additional healthy-state captures and two grading reproductions. No horizontal document overflow was measured in the primary capture set. The audit did not perform a new full regression-suite run or a new accessibility certification; the earlier system audit records its own verification. Missing AI credentials/preview configuration in the fictional fixture do not establish missing configuration in the normal app. Healthy availability was simulated for layout comparisons; no external AI generation was requested.

Evidence is under [output/playwright](../../output/playwright/) using `faculty-ui-` names. Key screenshots: [Results on laptop](../../output/playwright/faculty-ui-results-1366.png), [grading](../../output/playwright/faculty-ui-grading-1366.png), [valid review](../../output/playwright/faculty-ui-draft-valid.png), [class roster](../../output/playwright/faculty-ui-class-roster-1366.png), [assignment](../../output/playwright/faculty-ui-assign-1366.png), [wide desktop library](../../output/playwright/faculty-ui-library-1920.png). That directory is ignored by Git; the [durable measurements](FACULTY_DESKTOP_UI_MEASUREMENTS_2026-11-08.json) preserve the results in the repository.
