# Historical audit record

> Snapshot of the 7 November 2026 audit and its implementation follow-up. Original findings describe the pre-fix interface; the follow-up at the end records the subsequent changes. File line numbers and machine-local screenshot links are historical evidence, not current navigation. See the [current test plan](../reference/TEST_PLAN.md), [branding reference](../reference/BRANDING.md) and [documentation contents](../README.md).

**Got It! application audit — 7 November 2026**

Got It! has the structure and working behavior of a real assessment product. The current interface has a consistent blue-and-gold identity, restrained decoration, appropriate tables and editors, and language tied to teaching and assessments. The strongest reasons it might feel unfinished are lost faculty edits, ambiguous grading states, cramped mobile workspaces, and incomplete recovery behavior.

This assessment covers the current working tree, including its uncommitted changes. It is an audit, with no application-source fixes. Browser actions used fictional records in a separate in-memory database; existing application databases were not used or modified.

**Assessment against the original criteria**

| Criterion                       | Assessment                                              | Evidence and implication                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Template appearance             | Strong                                                  | Coherent palette, local typography, restrained surfaces, and domain-specific layouts. No case for a cosmetic rebrand based on an “AI look.”                      |
| Structure fitted to the product | Mostly strong                                           | Faculty, Student, and Proctor serve distinct tasks. Faculty navigation repeats some of the same actions through the sidebar, progress strip, and page controls.  |
| Specific, accurate writing      | Mixed                                                   | Most controls describe concrete actions. Some score-release and grading language disagrees with the current workflow.                                            |
| Visual hierarchy                | Mixed                                                   | Titles and primary controls are legible. On small screens, navigation, reference material, and file-management controls consume space needed for answering.      |
| Real functionality              | Strong in the paths exercised                           | Publishing, run creation, answer saving, completion, faculty grading, and student score visibility worked through the UI.                                        |
| Edge cases and recovery         | Needs work                                              | Student refresh and offline recovery worked. Faculty edit protection, expired-session recovery, status-banner layout, and empty-state semantics exposed defects. |
| Consistency and maintenance     | Visually consistent; implementation needs consolidation | Theme tokens help, but layout decisions are distributed across several override stylesheets. The combined quality gate is currently blocked by formatting.       |

**Findings in recommended implementation order**

All P2 findings below are normal-priority product defects or usability issues. P3 observations later in the report are refinements. Severity is scoped to the evidence from this audit.

1. **[P2] Refresh silently discards unsaved faculty names and rules.**

   In Activities, changing the draft name to `Unsaved audit name` and selecting the application's Refresh restored `Input and output practice`, without confirmation. In Rules, changing the duration from 40 to 55 minutes and selecting Refresh restored 40, also without confirmation. Question edits have a guard, but these other edits do not receive equivalent protection.

   [faculty.js:1193](D:/code/ctfv1/public/faculty.js:1193) reloads and reconstructs the selected assessment; [faculty.js:1373](D:/code/ctfv1/public/faculty.js:1373) resets rule dirtiness. The unload guard at [faculty.js:2297](D:/code/ctfv1/public/faculty.js:2297) checks only question edits.

   Protect every editable faculty form through one dirty-state mechanism. Refresh, activity switching, sign-out, and page exit should consistently preserve edits or offer Save / Discard / Stay. Verify names, duration, reference permissions, and retry rules independently.

   Evidence: [before refresh](D:/code/ctfv1/output/playwright/product-audit-faculty-rules-unsaved.png), [after refresh](D:/code/ctfv1/output/playwright/product-audit-faculty-rules-lost.png), [reproduction results](D:/code/ctfv1/output/playwright/product-audit-recovery-results.json).

2. **[P2] The active student layout can cover important status messages.**

   With the transient notice cleared and the runtime warning present, the runtime banner and exam panel both began at vertical position 0. Hit-testing the banner returned the exam panel or its title. The warning remained in the accessibility tree but was visually covered, on both desktop and mobile. Adding other notices changed the layout again.

   [student-ibt.css:7](D:/code/ctfv1/public/student-ibt.css:7) assumes two main grid rows, while [student.html:29](D:/code/ctfv1/public/student.html:29) includes independently appearing connection and runtime messages before the exam panel.

   Put notices and persistent status messages in a dedicated banner region, followed by an exam region that receives the remaining viewport height. Verify no notice, one notice, runtime failure, offline status, and simultaneous messages after asynchronous responses settle.

   Evidence: [desktop](D:/code/ctfv1/output/playwright/product-audit-student-runtime-steady.png), [mobile](D:/code/ctfv1/output/playwright/product-audit-student-runtime-steady-mobile.png), and the layout coordinates/hit tests in [recovery results](D:/code/ctfv1/output/playwright/product-audit-recovery-results.json).

3. **[P2] Ungraded submissions look like completed zero scores.**

   Two submitted coding answers awaiting manual review appeared as `0 / 10`, with no pending-review label in their table rows. The publication message explained that students were still in progress even though submitted work needed faculty grading. The first grading action was hidden under `Adjust score`; after grading, `Use automatic score` remained available for a manually graded coding question.

   The backend supplies `pendingReview` and correctly blocks premature publication. [faculty.js:2199](D:/code/ctfv1/public/faculty.js:2199) nevertheless displays the numeric score for every existing session. The generic message is chosen at [faculty.js:2172](D:/code/ctfv1/public/faculty.js:2172). Grading terminology appears at [faculty.js:2055](D:/code/ctfv1/public/faculty.js:2055).

   Give grading its own visible status: Awaiting review, Graded, and Published. Show an ungraded score as `Awaiting grade` or a clearly qualified provisional value. Add a direct Grade submission action and a count/filter for work awaiting review. Reserve override terminology for changing an existing grade.

   Evidence: [results before grading](D:/code/ctfv1/output/playwright/product-audit-faculty-results.png), [grading interface](D:/code/ctfv1/output/playwright/product-audit-faculty-grading.png). Actual grading and publication subsequently succeeded, and the student saw 10/10.

4. **[P2] Run setup promises automatic score release at closing, which the policy does not implement.**

   The Graded option says `results hidden until published or run closes` at [faculty.html:266](D:/code/ctfv1/public/faculty.html:266). The policy at [assessment-policy.mts:10](D:/code/ctfv1/src/assessment-policy.mts:10) requires explicit publication for graded attempts; closing the run alone does not release them.

   Update this option to describe the implemented publication policy. Keep run setup, readiness, completion, and faculty results explanations aligned. This is a copy/behavior mismatch established from source inspection, not a run-closing browser experiment.

5. **[P2] The default mobile assessment layout gives too little space to answering.**

   At 390×844, the initial coding answer pane was about 269px tall, while the editor began around page-coordinate y=1180 inside that scrolling pane. At 320×740, the pane was about 199px tall. The question matrix and prompt occupy separate stacked regions; expanded samples, import/export tools, and instructions precede the editor. The web editor similarly presents file-management controls before any visible source. Hiding questions and collapsing samples helped, but the source editor still began below the initially visible answer pane. At 1366×768, the 321px code editor began around y=565, requiring scrolling for much of the editor and execution controls.

   Relevant structure: [student-ibt.css:151](D:/code/ctfv1/public/student-ibt.css:151), [LogicWorkspace.vue:155](D:/code/ctfv1/web/LogicWorkspace.vue:155), and [WebWorkspace.vue:125](D:/code/ctfv1/web/WebWorkspace.vue:125).

   Design a mobile task layout explicitly: a compact question drawer, a clear way to switch between prompt and answer, and secondary import/export controls. Keep sample references easy to reach while giving editing and execution useful screen space. Evaluate this with actual answering tasks and a virtual keyboard, beyond checking horizontal overflow.

   Evidence: [coding on mobile](D:/code/ctfv1/output/playwright/product-audit-student-coding-mobile.png), [web editor on mobile](D:/code/ctfv1/output/playwright/product-audit-student-web-mobile.png), [collapsed mobile view](D:/code/ctfv1/output/playwright/product-audit-student-mobile-collapsed.png), [laptop](D:/code/ctfv1/output/playwright/product-audit-student-coding-laptop.png).

6. **[P2] An expired faculty session leads to a retry loop without a sign-in recovery action.**

   A simulated 401 during results refresh left the authenticated workspace visible. A temporary notice showed `Faculty session expired. (UNAUTHORIZED)`, while the persistent instruction said to select Refresh results. There was no sign-in action or reauthentication flow in that state. Successful reauthentication is necessary; retrying the same protected request does not address the cause.

   [faculty.js:115](D:/code/ctfv1/public/faculty.js:115) throws the HTTP error, but ordinary actions use the generic message handler. The results failure UI at [faculty.js:2126](D:/code/ctfv1/public/faculty.js:2126) does not distinguish authorization failure from connectivity failure.

   Handle 401 responses centrally. Offer reauthentication, preserve unsaved work, and restore the current task afterward. Keep a retry action for temporary network failures.

   Evidence: [expired-session screen](D:/code/ctfv1/output/playwright/product-audit-faculty-results-expired-session.png), [simulated response results](D:/code/ctfv1/output/playwright/product-audit-empty-errors-results.json).

7. **[P2] Faculty navigation does not participate in browser history.**

   Moving through Activities, Classes, and Results kept the URL at `/app/faculty`. Browser Back returned to the previously visited Student page instead of the previous faculty workspace. Refresh restoration through session storage works, but normal Back/Forward and links to a particular workspace are missing.

   [faculty.js:187](D:/code/ctfv1/public/faculty.js:187) switches panels and stores the step in session storage without updating browser history.

   Represent the workspace and relevant selected record in URL state, restore on Back/Forward, and apply the same unsaved-edit protections as other navigation.

   Evidence: `faculty-browser-back` in [recovery results](D:/code/ctfv1/output/playwright/product-audit-recovery-results.json).

8. **[P2] Empty/error results states have an invalid accessible-name attribute.**

   Axe reported `aria-prohibited-attr` on `#results-summary` in the no-runs state, network-error state, and expired-session state. [faculty.html:294](D:/code/ctfv1/public/faculty.html:294) applies `aria-label` to a generic div without an appropriate role. Populated-state checks did not report this issue.

   Use a suitable named group/section, or remove the label and hide the unused summary when it is empty. Recheck populated, empty, and failed states.

   Evidence: [automated results](D:/code/ctfv1/output/playwright/product-audit-empty-errors-results.json).

**P3 design and development refinements**

- Reduce duplicate workflow navigation. Review and Publish both route to the same screen in [faculty.js:355](D:/code/ctfv1/public/faculty.js:355), alongside sidebar and page-level versions of the same actions. Make actual stages and status changes clearer before adding more components or decoration.
- Keep grading as the main task when reviewing student work. The editor appears below the results table and long reference output, with the grade form in a disclosure. A focused review view with persistent next-student navigation and visible grading controls would reduce repeated scrolling.
- Consolidate stylesheet ownership. Shared layout selectors are defined in `styles.css`, refined in `ui-refinements.css`, and overridden again in `app-theme.css`; the theme also changes widths and layout. Preserve the existing visual identity while giving tokens, shared controls, workspace layout, and assessment states clear ownership.
- Fix the current formatting gate and maintain a small browser acceptance suite. `npm run check` stops at formatting before reaching the regression tests. Existing browser scripts in `output/playwright/` are useful audit artifacts, but that directory is ignored and the package's check command does not run browser workflows. Prioritize edit protection, pending grading, authentication expiry, status combinations, and mobile answering in maintained checks.
- Separate current verification status from historical changes in `docs/TEST_PLAN.md`. It contains successive descriptions of starter/import/JSON workflows that were later removed. A current capability matrix would make release readiness easier to assess.

**What worked during this audit**

- The three roles have distinct, understandable workspaces.
- Faculty could publish a valid assessment and create a class run through the UI.
- An incomplete synthetic draft was correctly blocked by source validation.
- A student's Python draft survived refresh with identical source text.
- Offline editing reported `Saved on this device · Sync failed`; reconnecting restored `Saved to server`.
- Finishing saved work produced the expected pending-faculty-review state.
- Faculty grading and score publication worked; the student then saw `Score: 10 / 10 points.`
- Web file edits were retained while switching files, and Escape followed by Tab moved focus out of the editor.
- Filters, useful empty-state guidance, visible keyboard focus, and text labels accompanying status colors are present.
- The regression suite exercises substantive behavior including role ownership, private grading data, draft conflicts, grading policy, and execution-service boundaries.

**Verification and scope**

| Check                               | Result                                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Production build                    | Passed, through `npm test` pretest                                                                                                  |
| Type checking                       | Passed                                                                                                                              |
| JavaScript syntax                   | Passed                                                                                                                              |
| Automated regression tests          | 142 passed, 0 failed, with localhost access available                                                                               |
| Formatting                          | Failed in `src/routes/student.mjs`, `src/docker-process.mts`, and `web/WebWorkspace.vue`                                            |
| Automated accessibility             | 39 screen/viewport states checked; 36 reported no violations; 3 exposed the same results-summary attribute defect                   |
| Contrast checks requiring follow-up | 20 incomplete node checks across 10 states, involving form controls and overlapped runtime notices; these are not counted as passes |
| Horizontal document overflow        | None in the 39 checked states; scrollable tables/panes remain intentional                                                           |
| Viewports                           | 1440×1000, 1366×768, 390×844, and 320×740                                                                                           |

The browser checks used an isolated localhost server and fictional class/assessment data. Empty datasets and 401/network failures were simulated at the browser response layer. Fullscreen-unavailable behavior was used so the browser viewport could be controlled consistently. These are focused checks, not a complete assistive-technology or deployment-security review.

The harness deliberately disabled AI credentials and the PHP preview service. Screenshots saying the AI key is missing or preview is unconfigured do not establish that those settings are missing in the normal application. Execution status reported Docker in Windows-container mode. Live AI generation, real Docker execution, and a live PHP/SQLite preview were not verified in this audit. Existing records, external provider accounts, and production services were untouched.

Raw screen-state results, reproducible audit scripts, test output, and screenshots are under [output/playwright](D:/code/ctfv1/output/playwright), using the `product-audit-` prefix. That directory is ignored by Git; this report is the durable repository artifact.

**Visual design addendum**

The visual judgment is more qualified than “consistent branding.” The interface has a recognizable identity, but several screens have weak information hierarchy and give secondary controls too much space. These are design assessments based on the captured screens, rather than measured user preferences or evidence of how the application was coded.

| Area               | Current visual assessment                                                                                                                                                                                   | Recommended direction                                                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout             | Main weakness. Navigation, selected-activity context, progress, page introduction, actions, and filters accumulate before the actual work. Collection views and selected-record editing are mixed together. | Give each screen one clear purpose. Keep the library focused on finding/opening activities; place editing and publishing inside the selected activity.                                                          |
| Colors             | The navy/gold identity is coherent and appropriate to an academic product. Large navy surfaces and blue-tinted text make the frame more prominent than the content.                                         | Retain the brand palette. Use more neutral content text and surfaces, with restrained blue/gold emphasis.                                                                                                       |
| Typography         | Poppins gives continuity and personality. Its broad geometric shapes and frequent semibold labels make operational screens feel bulky.                                                                      | Keep Poppins for the brand and headings; compare a system sans-serif for dense controls and data. If retaining Poppins throughout, reduce routine labels/buttons to medium weight and keep a disciplined scale. |
| Components         | Controls are recognizable and generally consistent. Repeated outlines, generous padding, and equally prominent utility actions create visual competition.                                                   | Establish primary, secondary, and quiet action treatments. Use borders to express meaningful grouping and keep control alignment consistent.                                                                    |
| Spacing            | Generous vertical space is applied similarly to explanations, tools, forms, and actual work. Full-width text fields and long helper lines weaken grouping.                                                  | Use tighter spacing within a task and stronger separation between tasks. Constrain forms and explanatory text while allowing tables and code workspaces to remain wide.                                         |
| Mobile composition | The desktop structure mostly becomes a long stack. Counts, setup controls, and navigation displace the record list or editor.                                                                               | Choose what must remain visible for each task. Use compact summaries and drawers/tabs where they improve access to the task.                                                                                    |

The clearest layout example is [Activities](D:/code/ctfv1/output/playwright/product-audit-faculty-activities.png): the first activity row begins roughly 580px down the captured desktop page. Above it are the shell, service status, selected-draft context, progress strip, heading, instructions, Create activity, filters, and count. The rename form for the selected draft then appears below the collection. A compact page header with Create activity, a filter toolbar, and the collection would establish a much clearer browsing hierarchy. Progress and rename controls belong with the opened activity.

The [creation form](D:/code/ctfv1/output/playwright/product-audit-faculty-create.png) gives nine fields equal visual treatment in a three-column grid. That grid is tidy, but the grouping does not communicate the task sequence. Group activity identity, question settings, timing, and teaching material explicitly. Give teaching-material upload a clear role, and place advanced generation guidance in its existing disclosure. Use a comfortable form width rather than stretching every field to fill the available workspace. Put short explanations next to the relevant controls and consolidate repeated general instructions.

The color palette itself does not require replacement. `#182E7B` navy and `#FDC800` gold already establish a clear identity. The navy header plus navy sidebar create a heavy frame; reducing the visual weight of one would give the content more room to lead. Gold works as a selected-state accent, and can be used more sparingly within the shell. Ordinary content should read as neutral dark text, with quieter secondary metadata. Preserve distinct success, warning, and error treatments.

Poppins is not evidence of an AI-generated interface. The concern is its role and density. In these screens, semibold navigation, labels, titles, controls, and records often compete for attention. A practical typography trial would retain Poppins for the name and headings, use a system sans-serif for data and forms, and retain monospace for code. Alternatively, keep Poppins throughout and reduce routine emphasis. A useful starting scale is 24–28px page titles, 16–18px section headings, 14–16px operational/body text, and 13–14px secondary labels; verify readability rather than treating those sizes as a requirement to shrink everything. Use normal weight for body content, medium for routine labels/actions, and semibold where hierarchy requires it.

The [coding workspace on a laptop](D:/code/ctfv1/output/playwright/product-audit-student-coding-laptop.png) exposes a priority problem: samples, import/export tools, language labeling, and introductory guidance precede the source editor. The Download code button stretches to the height of the neighboring upload field group, giving a utility action considerable weight. Put language and file utilities in a compact toolbar, keep references conveniently accessible, and make editing and running code the visual center of the workspace. Preserve the existing resizable context pane, but choose a useful initial split for the question's actual content.

The [mobile results view](D:/code/ctfv1/output/playwright/product-audit-faculty-results-mobile.png) illustrates the same issue in another task: the student list comes after multiple context blocks, five summary tiles, publication controls, and filters. The participation counts are useful; they can be presented more compactly on a phone. Reorder or collapse secondary controls so the first student and the next useful action appear sooner.

The [sign-in screen](D:/code/ctfv1/output/playwright/product-audit-faculty-login.png) is one of the stronger compositions. It has a clear focal point, a comfortable form width, and a single obvious action. Its simplicity is appropriate. That same clarity should carry into the authenticated screens.

Recommended visual implementation order: simplify collection/detail structure; reorganize forms and coding tools around the primary task; refine spacing and typography; then rebalance the color emphasis and component treatments. Retain the established identity while making those changes.

**Implementation follow-up — 7 November 2026**

The application now protects unsaved names/rules during refresh and page exit, represents faculty workspaces in browser history, offers reauthentication, labels ungraded submissions explicitly, corrects score-release wording, uses a named results-summary group, and lays out status banners independently of the exam. Creation forms are grouped, library editing controls are moved into the opened activity, workflow progress has three actual stages, and student review has a focused layout with previous/next navigation. The shell uses a lighter sidebar, Poppins headings with system-font controls/data, compact summaries and utilities, responsive question navigation, and source editing before file utilities. Original findings above describe the pre-fix state.

The complete check command passes all 142 regression tests plus type, syntax, formatting and build checks. Maintained browser checks live in tests/browser; verification screenshots and outputs remain in output/playwright. Live Docker/AI execution and institutional deployment checks remain outside this local UI change.

Final browser verification passed eight maintained workflow checks. Automated accessibility reported no violations in the revised library, desktop/mobile creation, focused grading, student workspace, and empty-results states checked. These checks do not replace a complete accessibility certification or real runtime/deployment verification.
