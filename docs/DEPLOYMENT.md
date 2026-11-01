# Deployment and recovery notes

The supported runnable setup is a single Node 22.13+ process with a SQLite file. Use `npm start`. The app binds to `127.0.0.1:3000` unless `HOST` and `PORT` are set. `DATA_FILE` selects the database location. `DEMO_MODE=0` disables fictional fixtures and requires `INSTRUCTOR_PASSWORD`.

The Proctor view is at `/app/proctor`. Faculty issues a separate code per run in Results. Share that code only with authorized facilitators; replacing or revoking it invalidates existing proctor sessions. The current code does not identify individual proctors, so institution sign-in and staff audit should be added before production use.

Do not deploy this MVP for real grades. It lacks institution authentication and a stable supported database runtime. For a production release, replace demo sign-in with institution SSO and roster sync, use appropriate credential storage, serve over TLS, perform database migration and backup procedures, and test expected simultaneous candidate load. Keep private grading data and student records in a restricted server store; never publish them as static files.

### Local recovery

On refresh, the browser keeps its candidate bearer token in session storage and requests the server's saved session. If browser session storage is lost, the candidate can rejoin with the same school ID and PIN while the run is open. Rejoin rotates the access token but preserves the original mission order, score and deadline. The app does not extend the clock.

SQLite data persists in `data/studio.sqlite` by default. Back up this file with a SQLite-consistent backup procedure before maintenance; copying a live WAL database without its journal files is unsafe. The app does not currently offer a restore UI, instructor time override, or incident adjustment workflow.
