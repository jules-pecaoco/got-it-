# Got It!

**Gotta Catch Ed All**

Migration branch: see [migration, verification and rollback](docs/MIGRATION.md). `npm start` uses a separate migration database and preserves the original. PHP projects and the Vue logic editor require `npm run build` (included in start/test).

Got It! hosts activities, quizzes, tests, exams, and CTF challenges with server-owned grading. Faculty Studio is the faculty workspace; students and proctors use their own views. The Week 13 CTF uses a fictional ticket queue. This local application has not been deployed for a class.

## Start the demonstration

For local internet hosting, see [the local hosting guide](docs/LOCAL_HOSTING.md). `npm run prepare:local` secures local configuration, `npm run backup` creates a verified snapshot, and `npm run serve:preview` prepares a temporary HTTPS tunnel with the correct session origin once disk/readiness checks pass. Regular hosting uses `npm run serve:local` with a configured stable HTTPS tunnel. `npm run test:load` exercises 80 fictional students using a simulated runner; add `-- --students=40 --docker` for an isolated real-runtime rehearsal after freeing disk space.

Requires Node.js 22.13+ (tested with 22.14). Install the server dependencies once; students need no installation.

```powershell
cd D:\code\ctfv1
npm install
npm start
```

Open <http://127.0.0.1:3000/app/student> for students, <http://127.0.0.1:3000/app/faculty> for faculty, or <http://127.0.0.1:3000/app/proctor> for proctors. The root address opens student sign-in. The Faculty screen uses the demo password `demo-instructor` while demo mode is enabled.

During development, use `npm run dev` to restart the server automatically when backend files change. With `npm start`, stop and restart the server after backend changes, then refresh the browser. Otherwise, updated pages can call routes that the older running server has not loaded, causing a “Route not found” error when checking an activity.

The server listens on loopback by default. Set `PORT`, `HOST`, `DATA_FILE`, `PLATFORM_LABEL`, `PLATFORM_TAGLINE`, `DEMO_MODE=0`, and `INSTRUCTOR_PASSWORD` through the environment as appropriate. Set `PUBLIC_ORIGIN` to the public HTTPS origin when using a TLS reverse proxy. In non-demo mode, the password must be provided and no sample data is seeded. The built-in `node:sqlite` module currently needs the `--experimental-sqlite` flag, included by `npm start` and `npm test`. The server and maintenance scripts load the same root `.env`; relative database paths resolve from the repository root, and maintenance scripts print the selected database before opening it.

Browser sign-ins use HttpOnly, SameSite cookies scoped to the role and tab. Faculty and proctor sessions expire after eight hours (or run close for proctors); student access expires after 24 hours. Sign-out revokes server access. Students can rejoin with the same school ID and run PIN to resume the original attempt and deadline. Existing student tokens from versions without expiry require one rejoin after the update. Run PINs are available only in the current Faculty page's memory: copy access details before refreshing or signing out. Older credentials saved in browser storage are removed automatically.

To enable the faculty AI assistant, create a free Gemini API key in Google AI Studio and set `GEMINI_API_KEY` in the server environment or in a root `.env` file before starting it. The server loads `.env` automatically; existing environment variables take precedence. `GEMINI_MODEL` defaults to `gemini-3.5-flash` and can be changed if that model is unavailable for your project. The key stays on the server. The free tier has rate limits and sends the source text and draft questions to Google; do not use student records or confidential teaching material there.

## What works

- Create AI drafts as an activity, quiz, test, exam, or CTF. Set difficulty, duration, and 1–20 questions; CTFs also set 1–5 missions. Other types use sections of up to four questions.
- Import and edit JSON drafts in Faculty Studio; validate and explicitly approve a version before publication.
- Archive unused drafts from the activity list and restore them from the collapsed history. Older published versions are kept in history so existing runs remain available.
- Upload text, Markdown, PDF or PowerPoint (`.pptx`) teaching material. The server extracts PDF pages and slide text with page/slide labels. Create a faculty AI draft from one source, then review its questions and answer key. An optional AI check estimates source match as a percentage. Faculty decides what to approve; coverage notes are optional.
- Upload each class roster once, then add, edit, search, sort, or remove individual students in its DataTables roster. Class names, sections, whole-roster replacement, and deletion are also available. Existing runs keep their student lists when a class changes or is deleted. Students join with school ID and PIN.
- Set duration and retry limits, point costs and time costs by section or mission and question. Faculty can view the answer key after sign-in.
- Choose **Graded** or **Practice** feedback when creating a run. Graded is the Faculty default: students receive save confirmation, while correctness and scores stay hidden until faculty publishes the completed attempt's score. Reopening or extending a released attempt hides its score until faculty publishes again. Practice keeps immediate feedback. Existing runs retain Practice behavior.
- Optionally shuffle questions within each section or mission when creating a run. Each student's order is saved on first join and restored on resume; section prerequisites stay in order. Leave this off when questions build on each other.
- Freeze each candidate's shuffled independent mission order and server deadline on first join. Resume preserves both.
- Render and grade ten activity types: single choice, multiple choice, true/false, text, numeric, matching, sequencing, data inspection, DataTables code, and code writing. Coding questions support PHP, Python, SQL (SQLite), and JavaScript (Node.js), show sample inputs and expected outputs, and award partial credit across private tests.
- Record submissions and unique score awards in SQLite transactions. Export the instructor gradebook as CSV.
- In Faculty Results, review each student's submitted answers and the answer key. After an attempt ends, replace a question's automatic points with a reason, or restore its automatic score. The total and CSV update, and changes appear in the audit log.
- Faculty workspaces separate Activities, Classes, and Results from activity preparation. Search and filter activities, follow the draft/review/publish/run checklist, and inspect a live run summary that distinguishes the joining window from each student's attempt duration.
- Results load when a run is selected. Participation summaries, student search, attempt and score-visibility filters, and persistent publication confirmations keep completed attempts separate from published scores. After a graded attempt ends, the student view checks for published scores every 15 seconds and when returning to the tab; students can also select **Check for published score**. Run settings and access details are available below the table.
- Students check activity details, retry costs, feedback rules, and fullscreen requirements before starting a new timer. Per-question status distinguishes saved drafts from submitted answers, with draft-save retry controls and warnings before leaving unsubmitted revisions. Saved drafts become final submissions on finish or expiry, subject to retry limits.
- Issue, replace, or revoke a separate proctor code for each run in Faculty Results. Proctors see participation, question progress, last submission, and time remaining. They cannot see answers, grades, or faculty controls.
- Keep private answers outside `public/` and candidate responses. The browser only receives public activity data.

## Coding runtime setup

Start Docker Desktop with Linux containers (or Docker Engine on Linux), then run:

```powershell
npm run setup:coding
npm run verify:coding
```

The setup downloads three digest-pinned runtime images; Python also supplies SQLite. Coding runs as a non-root user with no network or host mounts, a read-only root, a small temporary filesystem, memory/process/CPU limits, and time/output bounds. The server never executes student code directly on the host. Keep Docker running while students use coding questions; unavailable runtimes do not consume a submission attempt. Student pages use a persistent queue with two active jobs, one pending job per student, and saved on-time receipts. Queue waits can finish after the deadline. Direct synchronous API clients retain the busy/retry behavior. Standard-library console programs and single read-only SQLite queries are supported; The separate web_project workspace hosts plain PHP/HTML/CSS/JavaScript with SQLite; external database servers are not included. Other activity types do not require Docker.

## Create a new activity

1. Sign in at `/app/faculty` and select **Create activity**. Enter a name, subject, type, difficulty, duration, and question count. CTF also asks for mission count. Upload a `.txt`, `.md`, `.pdf` or `.pptx` teaching source up to 10 MB. Generate a preview to see each question, answer, and estimated source match. Edit a question if needed, approve questions individually or by section, then select **Save and review**. An unfinished preview and approvals recover after refresh during the same faculty session. Low source match does not block faculty approval; invalid question formats still need correction. AI drafting accepts up to 60,000 extracted text characters. Choose **Students write code** under Question format and select PHP, Python, SQL (SQLite), or JavaScript; **Choose a variety from material** selects suitable types from the source. Choose **Custom mix** to set exact counts for any combination of the ten question types, including matching, table inspection, DataTables JavaScript, and general code writing. During preview you can change any question type or programming language, add/duplicate/remove/reorder questions, or add/remove sections; faculty approvals can use a different count and mix from the original request. Coding questions include an incomplete scaffold, visible sample input and expected output, and additional private tests. Faculty can edit the coding details and select **Check reference solution** before approving. Students select **Run sample tests** to compare their output with the examples without using a graded attempt. Submitted code is graded in isolated Docker containers against private tests, with exact, whitespace-insensitive, or numeric-tolerance output comparison. The AI supports all ten question types. Matching questions award partial credit by pair; table questions use server-computed target rows. The preview includes dedicated matching and table editors.
2. **Review** shows the question, correct answer, source evidence, and rule summary together. Validation runs automatically and enables **Publish version** when the draft is valid. Use **Edit rules** for optional retry changes; source coverage notes and the separate source-support check are optional. Pending coverage notes and low AI percentages do not block publication; missing cited files and invalid question formats still do.
3. For fully custom questions, use **Advanced package editing** in Activity with a public/private JSON package, following [the authoring guide](docs/QUESTION_AUTHORING.md). Published versions are locked; use **Create editable copy** to revise one.
4. In Excel, add `SchoolID` after `ProgramShortName`, then save the sheet as **CSV UTF-8**. Keep the first row exactly `StudentName,Gender,YearLevel,ProgramShortName,SchoolID`. In **Classes**, add a class name and section, upload its `.csv` or supported Excel `.xls`, and check the student count. You can rename the class, change its section, replace its roster, inspect students, or delete it. In **Run**, choose that saved class, set the run name, admission PIN, window, feedback mode, and optional question shuffle, then create the run. Use **Copy details** to share the student link, Run ID, and PIN. Run names can be changed later in Results without changing student credentials.
5. Join as a test candidate, complete the activities, and inspect Results and the CSV export.

In **Results**, load a run and select **Review** beside a student to see their submissions and the correct answers. Once the attempt is submitted or expired, open **Adjust score** on a question to enter points and a reason. **Use automatic score** reverses that override. Changes to a Graded run after its close are visible when the student checks results again.

## Monitor a run

In **Faculty → Results**, select a run and choose **Create access code** under Proctor access. Copy the displayed proctor link, Run ID, and code to the facilitator. The code is shown once; **Replace access code** invalidates previous proctor sessions, and **Revoke access** ends monitoring. At `/app/proctor`, the facilitator signs in with the Run ID and proctor code. The view refreshes every 15 seconds and can be filtered by student or status. “In progress” means an attempt has started, not that the browser is currently open. Proctor access ends when the run closes.

The [Week 13 Campus Queue activity](exam-packages/itp255-week13-draft/INSTRUCTOR_REVIEW.md) is based on the supplied slide deck. Version 7 has five missions, takes 40 minutes and offers 100 points. Missions 4 and 5 have task-specific `// TODO` comments. The student preview uses the locally hosted DataTables 3.1.4 library, including its search, ordering, page-size and pagination controls. The editor parses the lesson's supported API calls and applies their state to DataTables; it does not execute arbitrary student JavaScript. Syntax colors support JavaScript, PHP, SQL, and Python; the language selector changes display only. The current DataTables code questions still require JavaScript. Each question has an attempt limit and retry costs. In Faculty, open a version to see its answer key; use **Create editable copy** to change duration, mission defaults and question overrides before publishing. Existing runs retain their original versions.

Students open the hosted application link shared in Teams. The link from **Copy details** fills in the Run ID; students enter their school ID and run PIN. The activity shows one section or mission at a time, a next action after finishing one, and a completion screen after submission or time expiry. They can return to previous unlocked sections, and their last submitted answers are restored when revisiting. The current `127.0.0.1` address works only on this computer. For a real class, deploy the app to a reachable HTTPS host, turn off demo mode, set an instructor password, and create a run with a real roster before sharing the link.

During an active attempt, students enter fullscreen to view questions and re-enter it if they exit. Browsers that cannot provide fullscreen show a continue option. Question and reference text cannot be highlighted; answer and code fields remain editable. These are deterrents, not screenshot prevention, and there are no focus strikes or automatic penalties.

Older `.ppt` files need to be saved as `.pptx` before upload. PDF pages or slides that contain only images have no selectable text for this extractor; use a text-based PDF or OCR first. Extracted source text is stored with the draft, while the original file is not stored.

For scripted imports, see [API contracts](docs/API.md). The [deployment note](docs/DEPLOYMENT.md) describes work required before a real graded use.

## Tests

```powershell
npm test
```

This exercises package validation, two unrelated subjects, the Week 13 table activities, order stability, score idempotency, candidate isolation, HTTP access, and CSV output. HTTP tests bind to `127.0.0.1`; a sandbox that disallows loopback needs local-network permission.

## Design notes

The browser UI uses the Solar Ledger palette and square components. Paper backups bundle the OFL Poppins regular font for consistent printing; the browser UI uses a sans-serif fallback. Keyboard controls are available for the activities, including matching and sequencing.

The application uses Fastify with compatibility controllers, SQLite and optional isolated execution workers. It stores drafts and published content in SQLite, with private rules in a protected table column. Demo seed files live outside the static `public/` directory. Answers are evaluated only in the server process. See [security limits](docs/SECURITY.md) and [test evidence](docs/TEST_PLAN.md).
