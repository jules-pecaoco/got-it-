# Local hosting for 40–80 students

Keep one Node process, local SQLite/WAL storage, and Docker Linux containers. Students use a public HTTPS tunnel; the application remains on 127.0.0.1. Do not start a second application process against the same database: job ownership and runner limits are process-local.

## Preparation commands

`npm run prepare:local` disables demo mode, selects loopback binding, and generates a strong faculty password in the ignored `.env` file if the existing password is weak. Existing database selection, AI keys, and other configuration are preserved. The password is never printed. Configuration changes take effect on application restart.

`npm run serve:preview` checks disk space first, prepares local configuration, starts the installed cloudflared Quick Tunnel, reads its assigned HTTPS address automatically, and passes that origin into the supervised launcher. It makes no domain purchase and installs no service. Close the preview to stop its processes. This is a temporary rehearsal URL, not a stable class address.

`npm run backup` makes a new consistent snapshot of the configured database, verifies its integrity, and prints its destination. Existing files are never overwritten. Backups are stored beside that database in `backups/`; copy verified snapshots to approved storage on another device. Original uploaded binaries are not retained by this app. Backups contain private answers and student records; restrict access and define their retention with assessment records. Restoring means stopping the app, selecting a verified snapshot as DATA_FILE, and checking roster, attempts, deadlines, and scores before resuming.

`npm run preflight` checks deployment configuration, system/data disk headroom, database selection, and all four installed Docker runtimes. A failure blocks `npm run serve:local`. Free at least 10 GB on each checked drive; 20–30 GB system-drive headroom is preferable. This does not delete files or move Docker data.

`npm run serve:local` runs preflight and an initial verified backup, starts Node without development watch mode, backs up hourly, and restarts an interrupted process with backoff. Five rapid failures stop the launcher. Keep the terminal running. Ctrl+C stops it. Configure Windows Task Scheduler to run this command at sign-in if unattended startup is wanted. The tunnel process must also be managed separately. Keep the laptop powered, awake, and preferably connected by Ethernet.

Set DEMO_MODE=0, a unique INSTRUCTOR_PASSWORD of at least 16 characters, and PUBLIC_ORIGIN to the exact public HTTPS origin. Preserve the existing DATA_FILE. Never commit .env. A named Cloudflare Tunnel needs a configured domain. Quick Tunnels are temporary previews; their hostname changes on restart, requiring PUBLIC_ORIGIN and the app to be restarted before sign-in. Never change origins during an active run. The tunnel should forward to http://127.0.0.1:3000.

## Coding queue and deadlines

Student pages request asynchronous execution with `Prefer: respond-async`. A POST to the existing coding submit/preview endpoint returns HTTP 202 and `{jobId,status,acceptedAt}`. Poll GET /api/me/coding-jobs/:jobId with the same student session. Jobs are private to that session, including results. Polling backs off from 1 to 4 seconds; the browser remembers the receipt in tab storage. Repeating the same request after a network interruption retrieves the same job. After a refresh, retry Submit with the unchanged answer to resume a saved receipt; accepted jobs continue grading even when the tab closes. Sign back in to review completion if access expires.

Jobs persist in SQLite and interrupted jobs resume after server restart. Two complete jobs run at once, with a maximum 160 pending jobs and one pending job per student. Actual submissions are selected before queued sample tests. All existing container isolation, memory, CPU, time, and output bounds remain. Pending submissions block new direct submissions, score publication, overrides, and recovery for that attempt. Jobs accepted before the deadline can finish afterward, including after the student finalizes. New late jobs remain rejected. Duplicate requests cannot create extra score awards or retry costs. Infrastructure failures record no graded attempt; retry after the service is restored. A failed job retried after the attempt closes needs faculty recovery. Direct scripted requests without the async preference retain the synchronous API and its existing late-result rules.

Scores remain hidden while accepted submissions are pending. Completed queue records contain submitted code and results and follow the same access/retention policy as submissions. Faculty GET /api/instructor/system reports queue depth, process uptime, and memory. GET /api/ready checks database access without exposing database paths or student information; Docker availability is checked separately by preflight.

## Rehearsal and limits

`npm run test:load` creates 80 fictional students and an isolated in-memory database, exercises HTTP joining, drafts, asynchronous coding, polling, and finalization, and verifies every grade. Its runner is simulated: it tests application concurrency, not Docker capacity or home internet throughput.

`npm run test:load -- --students=40 --docker` executes actual installed Python containers. The disk guard must pass first. Start with fewer students, then 40 and 80. The tool uses no classroom records, makes no AI calls, downloads no images, and never exposes a public port. Run `npm run verify:coding` separately to verify all four languages and sandbox behavior. These rehearsals must be run outside active classroom sessions because real container execution shares CPU and the Docker daemon. A real-Docker rehearsal checks the temp/system drive; verify Docker's separate VM-storage drive also has headroom before running it.

Record queue wait, total completion time, normal request latency, CPU/RAM, and errors. An 80-student HTTP pass is not evidence of acceptable coding turnaround. Choose the class size from real-Docker and public-network rehearsals. Upload stability, power loss, laptop sleep, shared credentials, and a single computer remain deployment limitations.

Assets now use ETag revalidation and a process cache; assessment APIs remain no-store. Draft autosave waits for a 1.5-second typing pause and still flushes on supported navigation/submission. SQLite indexes, prepared statement reuse, and aggregated gradebook reads reduce repeated database work.
## Runtime storage

This checkout uses D: for project temporary files (`data/tmp`) and npm cache (`data/npm-cache`). Docker Desktop's images and container disks are already stored at `D:\docker\DockerDesktopWSL`. Disk readiness checks use the configured runtime temp drive, alongside the project and database drives. The 10 GB free-space requirement remains enabled.
