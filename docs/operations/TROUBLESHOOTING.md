# Fix common problems

[Documentation contents](../README.md)

Start with the symptom you can see. Check the matching part before changing unrelated settings.

| Symptom                                            | What to check                                                                                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Nothing opens on port 3000                         | Start the app and read the terminal error. Keep its terminal open.                                                                            |
| Port 3000 is already in use                        | Find the existing app process. Use one application process per database.                                                                      |
| Docker is unavailable                              | Start Docker Desktop, select Linux containers and check `docker version` from the same account running the app.                               |
| A coding language is missing                       | Run `npm run setup:coding`, then `npm run verify:coding`.                                                                                     |
| No assessments appear                              | Fresh startup does not load samples. Also check the faculty owner and active database path.                                                   |
| Login or a mutation fails after changing addresses | Match `PUBLIC_ORIGIN` to the browser origin exactly, restart and sign in again.                                                               |
| Local setup works but students cannot connect      | Give them the public HTTPS hostname. Their `127.0.0.1` points at their own PC. Check the tunnel/proxy and keep your host awake.               |
| The editor opens but its web preview does not      | Check the second HTTPS hostname, routing to port 3102 and Docker/PHP verification.                                                            |
| Production reports an HTTP preview origin          | Replace the old development `PREVIEW_ORIGIN` and use a fresh shell; `$env:` values override `.env`.                                           |
| Quick Tunnel works but PHP preview does not        | The helper publishes port 3000 only. Configure a second reachable HTTPS preview route.                                                        |
| Scores stay hidden                                 | Finish required manual grading, resolve pending/failed jobs and explicitly publish results. Closing a run is insufficient.                    |
| AI suggests a grade but the score is unchanged     | Apply the suggestion to the form, review it and select Save score.                                                                            |
| Run code produces output but no grade              | That is the current console workflow; submitted code needs faculty grading.                                                                   |
| New terminal features are missing after an update  | Stop the old server, run `npm start` and refresh the browser.                                                                                 |
| A terminal is busy                                 | Default live capacity is eight; let runs end or stop them. Measure host capacity before increasing `TERMINAL_CAPACITY`.                       |
| Supervisor refuses startup                         | Read preflight errors for credentials, HTTPS origin, existing target database, images and disk headroom.                                      |
| New checkout has no persistent target yet          | Complete local setup or run `npm start` once before using `serve:local`.                                                                      |
| Restored records are missing                       | Confirm `MIGRATION_DATA_FILE` points at the restored file printed by the restore command.                                                     |
| A second `.migration.sqlite` suffix appears        | A maintenance shell may have set `DATA_FILE` to the active target. Restore the intended source/target settings and launch from a fresh shell. |
| Deletion is blocked                                | Active attempts or queued/running grading must finish before run/activity deletion.                                                           |

## Useful checks

From the project directory, while the app is running:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/ready
```

This checks database access only. Faculty runtime status is also available through the application and authenticated `/api/instructor/code/status`. `/api/instructor/system` reports queue/process metrics.

Outside an active assessment, verify execution with:

```powershell
npm run verify:coding
npm run verify:web
```

For a provider error, first check the server-side AI configuration and account quota. Preserve any saved draft; AI availability is separate from assessment-server readiness. Suggested grades remain advisory even when a request succeeds.

Use [local setup](../guides/RUN_LOCALLY.md), [hosting](LOCAL_HOSTING.md) or [backup and recovery](BACKUP_AND_RECOVERY.md) for the complete procedure. Record the command, safe error code/request ID and time when reporting a problem; keep keys, PINs and student answers out of shared logs.
