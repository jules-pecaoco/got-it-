# Application visual theme

[Documentation contents](../README.md) · Reviewed against the current styles on 7 November 2026.

The faculty, student, and proctor workspaces share `public/app-theme.css`.
It loads after the existing layout and editor styles so the same semantic colors
apply to sign-in, navigation, tables, assessment controls, and coding workspaces.

## Palette and assets

The blue `#182E7B` and gold `#FDC800` are color inspiration from the
[UNO-R website](https://uno-r.edu.ph/), inspected on 7 November 2026. Got It! is an
independent application. It does not use the university logo, name, motto, or
institutional wording in its interface. The favicon is an application-specific
G monogram.

Poppins is served locally in regular (400), medium (500), semibold (600), and bold
(700) weights, with its SIL Open Font License in `public/fonts/`. Branding and headings use Poppins. Forms, navigation, and data use Segoe UI
or the system sans-serif. Source code and terminals retain monospace typography. No remote font requests are needed. The application name
and tagline continue to use the existing platform configuration.

Sign-in forms are centered horizontally and vertically without promotional
panels. The header is 64px tall and the desktop sidebar is 200px wide. Faculty
content, activity steps, tables, and proctor views use the available width with
consistent gutters; the assessment view retains its resizable panes. Cards,
inputs, and buttons use 0–2px corners and minimal shadows.

## Color and interaction rules

- Use blue for primary actions, links, headings, and the faculty navigation.
- Pair gold with dark blue text. Do not put white body text on gold.
- Use neutral white and pale blue surfaces for forms, tables, and editors.
- Keep success, warning, and error states distinct and retain their text labels.
- Use visible focus outlines, including gold focus outlines on the navy header
  and sidebar. Navigation state changes are immediate to avoid temporarily
  displaying white text on a gold background during a color transition.
- Preserve the existing assessment layout and responsive pane behavior. The
  scrollable question-context pane has a keyboard tab stop.
- Respect reduced-motion and Windows forced-color preferences.

Calculated sRGB contrast ratios:

| Pair                                  | Contrast |
| ------------------------------------- | -------: |
| White on blue                         |  12.24:1 |
| Blue on gold                          |   7.83:1 |
| Body text on white                    |  14.66:1 |
| Secondary text on the page background |   5.83:1 |
| Input borders against white           |   3.45:1 |
| Success text on its surface           |   6.91:1 |
| Warning text on its surface           |   6.54:1 |
| Error text on its surface             |   6.69:1 |

## Historical verification

The reports in this section were recorded during the theme work and can predate later code changes. Use the [test plan](TEST_PLAN.md) for the current verification procedure. A documentation review does not rerun these checks.

Chromium browser checks used fictional records in an isolated in-memory database.
Runtime availability was simulated for these visual checks; this was not a new
Docker execution verification.

Eighteen desktop/mobile states at 1440px and 390px passed axe-core 4.10.3 checks
for WCAG 2 A/AA and WCAG 2.1 AA, with no reported violations or unresolved contrast
checks: all three sign-in pages, faculty activities, creation, classes and
results, the proctor dashboard, student readiness, and the active coding
assessment. None had horizontal overflow at the document level. Nested results
tables remain horizontally scrollable by design. These automated checks cover
the inspected states, not every possible assessment or a full accessibility
certification.

Screenshots and the audit log for that theme revision were recorded under
`output/playwright/layout-*`. Checks also verify that the application contains
no university branding, that Poppins loads, that sign-in forms are centered,
and that workspaces use the available content width. The production build,
theme formatting, and `git diff --check` pass. The earlier 142-test regression
result predates this layout revision; this revision changes presentation only.

Additional checks verify 320px and 768px sign-in layouts without horizontal
overflow, keyboard focus, forced colors, reduced motion, and successful local
loading of all four Poppins weights.

An earlier combined `npm run check` reported formatting differences in
`src/routes/student.mjs`, `src/docker-process.mts`, and `web/WebWorkspace.vue`;
these files were not modified by that branding change. The later UI follow-up in [the archived audit](../archive/APPLICATION_UX_AUDIT_2026-11-07.md) records a passing combined check for its revision.

## November 7 UI refinement

The sidebar now uses a neutral surface with blue labels and gold selected-state emphasis. Activity browsing is separate from selected-activity editing. Creation fields are grouped by purpose; grading uses a focused review with previous/next navigation. Mobile question navigation and sample references are compact, and code editing precedes file utilities. Updated screenshots use output/playwright/fixed-*; checks and reproduction steps are documented in tests/browser/README.md.
