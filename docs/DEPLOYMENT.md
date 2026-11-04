# Deployment and recovery notes

For the local computer hosting workflow, persistent coding queue, secure configuration preparation, automatic preview origin, verified backups, readiness checks, and rehearsal commands, see [LOCAL_HOSTING.md](LOCAL_HOSTING.md). Student pages now queue coding work; the synchronous coding API below remains compatible for scripted clients. Only one application process may own a database and queue at a time.

The supported runnable setup is a single Node 22.13+ process with a SQLite file. Use `npm start`. The app binds to `127.0.0.1:3000` unless `HOST` and `PORT` are set. `DATA_FILE` selects the database location. `DEMO_MODE=0` disables fictional fixtures and requires `INSTRUCTOR_PASSWORD`.

The server and database maintenance scripts use `src/config.mjs` to load root `.env`, while explicit environment variables take precedence. Relative `DATA_FILE` paths resolve from the repository root; `:memory:` stays in memory. Each maintenance script prints the absolute target database before opening it. Confirm that target before running any maintenance, particularly the demo-removal script. Back up the selected database rather than assuming the default file is active.

For an HTTPS reverse proxy, set `PUBLIC_ORIGIN=https://your-school-host.example` to the exact public origin. Browser sessions use HttpOnly, SameSite=Strict cookies, marked Secure for that HTTPS origin. Cross-origin mutations are blocked. Forwarded client-address headers are not trusted; NAT/proxy users share the generous request ceiling, while failed school-ID/run combinations have separate limits. Exercise the intended class size before deployment.

The Proctor view is at `/app/proctor`. Faculty issues a separate code per run in Results. Share that code only with authorized facilitators; replacing or revoking it invalidates existing proctor sessions. The current code does not identify individual proctors, so institution sign-in and staff audit should be added before production use.

Do not deploy this MVP for real grades. It lacks institution authentication and a stable supported database runtime. For a production release, replace demo sign-in with institution SSO and roster sync, use appropriate credential storage, serve over TLS, perform database migration and backup procedures, and test expected simultaneous candidate load. Keep private grading data and student records in a restricted server store; never publish them as static files.

### Local recovery

On refresh, the browser uses its tab's HttpOnly candidate cookie to request the server's saved session. Session storage contains only a non-secret cookie selector and submission retry metadata. If that selector or cookie is lost, or 24-hour access expires, the candidate can rejoin with the same school ID and PIN while the run is open. Rejoin rotates access but preserves the original mission order, score and deadline. Existing tokens without an expiry are invalidated once on upgrade; students rejoin to continue. Sign-out revokes server access without finalizing the attempt. Answer drafts are saved on the server and restored on refresh. Faculty can extend time for an active or expired attempt, or reopen a submitted or expired attempt, before the run closes. Each recovery needs a reason and appears in the audit log. Recovery clears early score publication for that attempt.

Run PINs are kept only in the current Faculty page's memory and disappear on refresh or logout. Copy access details when creating or resetting a PIN. The server stores its hash and cannot recover the original; Faculty can set a replacement PIN when needed. Older persisted browser PINs and bearer tokens are removed when an updated page loads.

SQLite data persists in `data/studio.sqlite` by default. Back up this file with a SQLite-consistent backup procedure before maintenance; copying a live WAL database without its journal files is unsafe. A verified baseline backup is stored at `data/backups/studio-baseline-2026-11-01.sqlite`. Restore remains an operator procedure; the app has no restore UI.

### Coding runtimes

Coding questions additionally require a running Linux-container Docker engine that the server account can access. Run `npm run setup:coding` to pull the digest-pinned Node, Python/SQLite and PHP images, then `npm run verify:coding` to verify real input/output, syntax errors, time/output bounds, non-root execution and read-only root. Restart the application after installing this update. The faculty creation screen reports runtime readiness. Image pulls are an operator setup action; student requests use `--pull=never`. Update digests in `src/code-runner.mjs` and rerun verification when intentionally upgrading runtimes. Default concurrency is two containers, with busy requests rejected without charging attempts; size a dedicated worker service before a large simultaneous coding exam. Do not mount the host Docker socket into student containers.
