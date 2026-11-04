# Got It!

A proctored assessment system with Faculty, Student and Proctor workspaces, server-side grading, coding exercises, and isolated PHP/SQLite projects.

## Run locally

Requires Node.js 22.13+ and Docker Desktop with Linux containers for coding and PHP previews. Install dependencies once with `npm ci`.

```powershell
cd D:\code\ctfv1
$env:NODE_ENV = "development"
$env:PUBLIC_ORIGIN = "http://127.0.0.1:3000"
$env:PREVIEW_ORIGIN = "http://127.0.0.1:3102"
$env:PREVIEW_PORT = "3102"
npm start
```

- Faculty: <http://127.0.0.1:3000/app/faculty>
- Student: <http://127.0.0.1:3000/app/student>
- Proctor: <http://127.0.0.1:3000/app/proctor>

Faculty username is `faculty` for existing records; use the configured `INSTRUCTOR_PASSWORD` from `.env`. Students join a faculty-created run with their school ID and PIN. Proctors use a separate run access code.

`npm start` builds the editors and opens a separate migration database, preserving the original. Temporary files and npm cache stay under `data/` on the project drive. No sample assessments are loaded in normal operation.

## Assessment workflow

Create an assessment, review its questions and private grading rules, publish its version, and create a run for a class roster. Published versions remain fixed. Faculty manage only their own classes, assessments and results.

The logic editor supports PHP, Python, JavaScript and SQLite SQL, with sample execution and private grading tests. **Create PHP web assessment** starts a plain PHP/SQLite project with file editing, ZIP import/export, isolated preview and JavaScript console. Faculty can edit its files and rubric through Advanced package editing.

Answers and revisions save as drafts. On finish or expiry, saved drafts are graded subject to remaining retries. Earned criteria accumulate across attempts. Graded scores require explicit faculty publication; manual web rubric criteria must be reviewed first.

AI drafting is optional. Set `GEMINI_API_KEY` to enable it; teaching text and draft questions are sent to that provider. Faculty review remains required.

## Checks and maintenance

```powershell
npm run check
npm run verify:coding
npm run verify:web
```

Cleanup requires an explicit database path and creates a verified backup first:

```powershell
node --import ./src/runtime-temp.mjs --import tsx --experimental-sqlite scripts/cleanup-assessments.mjs PATH-TO-DATABASE
```

This removes unused unpublished assessments and unfinished AI previews. Additional assessment IDs explicitly select samples to remove with their runs and attempts. Published assessments are otherwise preserved. Required test data lives in `tests/fixtures/`.

## Guides

- [Migration, faculty accounts, execution hosts and rollback](docs/MIGRATION.md)
- [Classroom hosting](docs/LOCAL_HOSTING.md)
- [API](docs/API.md)
- [Question authoring](docs/QUESTION_AUTHORING.md)
- [Security](docs/SECURITY.md)
- [Verification and remaining release gates](docs/TEST_PLAN.md)
