# Got It!

An assessment platform where faculty prepare activities, students answer questions or write code, and proctors monitor a scheduled class run.

Objective questions can be marked automatically. Console code and manual web rubrics need faculty grading. Graded results become visible only when faculty publishes them.

## Start here

| I want to…                                 | Read this                                             |
| ------------------------------------------ | ----------------------------------------------------- |
| Understand how the parts work together     | [System overview](docs/guides/SYSTEM_OVERVIEW.md)     |
| Run it on my Windows PC                    | [Local setup](docs/guides/RUN_LOCALLY.md)             |
| Create an activity, take it, or monitor it | [User guide](docs/guides/USER_GUIDE.md)               |
| Give students a public address             | [Host from your PC](docs/operations/LOCAL_HOSTING.md) |
| Move it to a server                        | [Deployment](docs/operations/DEPLOYMENT.md)           |
| Find another topic                         | [Documentation table of contents](docs/README.md)     |

## Quick local start

You need Node.js 22.13+ and Docker Desktop running Linux containers. In PowerShell:

```powershell
cd D:\code\ctfv1
npm ci
$env:NODE_ENV = 'development'
npm run prepare:local
$env:PUBLIC_ORIGIN = 'http://127.0.0.1:3000'
$env:PREVIEW_ORIGIN = 'http://127.0.0.1:3102'
$env:PREVIEW_PORT = '3102'
npm start
```

On a new machine, run `npm run setup:coding` before starting coding exercises. It installs the required Docker images. See [local setup](docs/guides/RUN_LOCALLY.md) for verification and first sign-in.

- [Faculty](http://127.0.0.1:3000/app/faculty): existing default username `faculty`; use the configured password in `.env` unless the account was separately provisioned.
- [Student](http://127.0.0.1:3000/app/student): join a faculty-created run using a school ID and PIN.
- [Proctor](http://127.0.0.1:3000/app/proctor): use the run's separate proctor code.

`npm start` builds the editors and opens a separate migration database. It preserves the original database. No sample assessments are loaded during normal startup. Keep the terminal open; Ctrl+C stops the app.

## Development and release status

Run `npm run check` for type, syntax, formatting, build and regression checks. Docker execution and browser workflows have [separate checks](docs/reference/TEST_PLAN.md).

AI assistance is optional. Faculty can explicitly choose Gemini (`GEMINI_API_KEY`) or Groq (`GROQ_API_KEY`) and a model for question generation; providers never switch automatically. Faculty reviews generated questions and any suggested grades before saving or publishing. See the [user guide](docs/guides/USER_GUIDE.md) for the data sent to the provider.

Treat public deployment as a pilot until the [remaining release gates](docs/reference/TEST_PLAN.md#before-a-graded-deployment) are completed. Use one application process per active database, and follow [backup and recovery](docs/operations/BACKUP_AND_RECOVERY.md) before moving records.

See [CHANGE.md](CHANGE.md) for changes. Current documentation was reviewed against the working tree on **7 November 2026**; dated audit and test reports are kept in the [archive](docs/README.md#historical-records).
