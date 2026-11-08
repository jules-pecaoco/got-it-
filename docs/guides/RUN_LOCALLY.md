# Run it on your Windows PC

[Documentation contents](../README.md) · Next: [use the app](USER_GUIDE.md)

Use this guide when you want to open Got It! on your own computer. For students on other computers, continue with [hosting from your PC](../operations/LOCAL_HOSTING.md).

## 1. Check the prerequisites

You need Node.js **22.13 or later**, npm, and Docker Desktop running **Linux containers** for code execution and website previews.

```powershell
node --version
npm --version
docker version
```

On this PC, read-only checks on 7 November 2026 found Node 22.14, Docker 28.0.4, all four coding runtimes and `cloudflared`. The main app was stopped at that time. Recheck when needed; this is an observation, not a guarantee that those services stay running.

## 2. Install and prepare

Open Docker Desktop, then open PowerShell:

```powershell
cd D:\code\ctfv1
npm ci
$env:NODE_ENV = 'development'
npm run prepare:local
```

`npm ci` installs the versions in the lockfile. Preparation disables demo mode and saves a strong faculty password in the private `.env` file if the existing one is weak. It preserves database selection and other keys. It does not print the password.

On a new machine, install and verify the language images:

```powershell
npm run setup:coding
npm run verify:coding
```

The same Python image supplies Python and SQLite SQL, so four languages do not require four different images.

## 3. Start the app

In the same PowerShell window:

```powershell
$env:PUBLIC_ORIGIN = 'http://127.0.0.1:3000'
$env:PREVIEW_ORIGIN = 'http://127.0.0.1:3102'
$env:PREVIEW_HOST = '127.0.0.1'
$env:PREVIEW_PORT = '3102'
npm start
```

Startup builds the editors and opens the migration database. Keep this terminal open. Ctrl+C stops the app. Use the configured `127.0.0.1` addresses consistently rather than switching to `localhost` after sign-in.

| Workspace | Address                                           | Sign-in                                                  |
| --------- | ------------------------------------------------- | -------------------------------------------------------- |
| Faculty   | [Open Faculty](http://127.0.0.1:3000/app/faculty) | Existing default username `faculty`; configured password |
| Student   | [Open Student](http://127.0.0.1:3000/app/student) | Run, school ID and PIN                                   |
| Proctor   | [Open Proctor](http://127.0.0.1:3000/app/proctor) | Run and separate proctor code                            |

Use the faculty password in `.env` unless that account was separately provisioned. Normal startup creates no sample assessments. An empty library is expected on a fresh database: create a class and an activity, publish it, then create a run.

## 4. Confirm the parts you need

From another PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/ready
```

Readiness checks database access. To verify actual coding and PHP/SQLite behavior, outside an active assessment:

```powershell
npm run verify:coding
npm run verify:web
```

See the [test plan](../reference/TEST_PLAN.md) for development and browser checks. The ordinary local launcher does not perform hourly backups; the supervised [hosting launcher](../operations/LOCAL_HOSTING.md) does.

## Updating and restarting

Stop the app before installing changed dependencies. Restart with `npm start` after updates, then refresh the browsers. An older server process cannot provide newly added routes merely because the browser files changed.

Use a **fresh PowerShell window** when switching to public hosting. Explicit `$env:` values override `.env`; the development origins above must not carry over into a production launch. Temporary files and npm cache stay under `data/` on the project drive; `RUNTIME_TEMP_DIR` can select another temp location.

If something fails, use [troubleshooting](../operations/TROUBLESHOOTING.md). For the active database and backups, use [backup and recovery](../operations/BACKUP_AND_RECOVERY.md).
