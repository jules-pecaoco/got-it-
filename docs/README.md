# Documentation contents

Start with the topic you need. Each page has one job; you do not need to read the technical references to run the app.

Reviewed against the working tree on **7 November 2026**. This describes the files currently on disk, including uncommitted changes. It is not a new deployment or application-test report.

## Learn and use the app

| Order | Guide                                              | What it helps you do                                                |
| ----- | -------------------------------------------------- | ------------------------------------------------------------------- |
| 1     | [Understand the system](guides/SYSTEM_OVERVIEW.md) | See the architecture, component table and assessment lifecycle      |
| 2     | [Run it locally](guides/RUN_LOCALLY.md)            | Install dependencies, start the app and sign in on your PC          |
| 3     | [Use the app](guides/USER_GUIDE.md)                | Prepare activities, run a class, grade answers and monitor students |

## Host and maintain it

| Guide                                                    | What it covers                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Host from your PC](operations/LOCAL_HOSTING.md)         | Stable HTTPS tunnel, separate preview address and temporary rehearsals            |
| [Deploy to a server](operations/DEPLOYMENT.md)           | Persistent storage, HTTPS proxy, supervised startup and optional execution worker |
| [Back up and recover](operations/BACKUP_AND_RECOVERY.md) | Select the active migration database, make snapshots and restore safely           |
| [Fix common problems](operations/TROUBLESHOOTING.md)     | Match symptoms to checks and practical fixes                                      |

## Technical references

| Reference                                             | Use it when…                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| [API](reference/API.md)                               | Integrating a client or checking endpoint behavior              |
| [Question authoring](reference/QUESTION_AUTHORING.md) | Working on question formats, packages or validators             |
| [Security](reference/SECURITY.md)                     | Reviewing access, records, code execution and deployment limits |
| [Test plan](reference/TEST_PLAN.md)                   | Verifying a revision or preparing a deployment                  |
| [Engine audit](reference/ENGINE_AUDIT_2026-11-08.md) | Reviewing scoring, validation, AI budgets, execution lifetimes and prioritized improvements |
| [Application and student audit](reference/SYSTEM_STUDENT_AUDIT_2026-11-08.md) | Reviewing the 8 November student defects, UI/flow findings and verification results |
| [Faculty desktop UI audit](reference/FACULTY_DESKTOP_UI_AUDIT_2026-11-08.md) | Reviewing laptop/desktop layouts, grading-flow defects, element moves and visual recommendations |
| [Reliability resolution](reference/RELIABILITY_RESOLUTION_2026-11-08.md) | Reviewing the 8 November recovery, capacity, scheduling and performance fixes |
| [Interface message audit](reference/INTERFACE_MESSAGE_AUDIT.md) | Reviewing user-facing wording and its meaning in each state |
| [Branding](reference/BRANDING.md)                     | Changing colors, typography or shared interface styles          |

## Historical records

These preserve what was observed at a particular time. Their test counts, local database details, code line numbers and old workflows are not current operating instructions.

| Record                                                            | Why it is kept                                              |
| ----------------------------------------------------------------- | ----------------------------------------------------------- |
| [4 November migration](archive/MIGRATION_2026-11-04.md)           | Baseline tag, migration decisions and original verification |
| [Earlier verification notes](archive/TEST_HISTORY.md)             | Successive workflow changes and past Docker/load checks     |
| [7 November UX audit](archive/APPLICATION_UX_AUDIT_2026-11-07.md) | Original findings and the implementation follow-up          |
| [8 November reliability and performance audit](archive/RELIABILITY_PERFORMANCE_AUDIT_2026-11-08.md) | Recovery defects, measured database costs and operational decisions |

The long `SYSTEM_GUIDE.md` was replaced by these focused guides. Earlier overlapping hosting/reference files were moved into the folders above. [README](../README.md) is the entry point; [CHANGE](../CHANGE.md) records changes rather than the contents of a particular local database.

The [browser-test instructions](../tests/browser/README.md) and [asset notes](../public/brand/README.md) stay beside the files they describe. Markdown under `tests/fixtures/` is test input, not user documentation.
