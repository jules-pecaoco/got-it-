# Deploy to a dedicated server

[Documentation contents](../README.md) · For your Windows PC, use [local hosting](LOCAL_HOSTING.md).

Use a dedicated server when the app needs to stay online independently of your PC. The current design needs one long-running Node application, persistent local SQLite storage and access to Linux Docker containers. This is a single-host deployment recipe, not a cloud deployment verified by this documentation review.

## 1. Prepare the host and project

1. Provision a Linux VM with durable local disk. Install Node.js 22.13+ using the project's tested 22.x line, Docker Engine and an HTTPS reverse proxy such as Caddy. Choose resources from a representative workload rehearsal.
2. Put the intended project revision at `/srv/gotit`. Include intended uncommitted changes: cloning only the current commit may omit working-tree features. Transfer secrets and verified database snapshots privately.
3. Create a dedicated service account with access to the project, data/temp directories and execution runtime. Controlling Docker gives powerful host access; use a dedicated execution host for wider public exposure. See [security](../reference/SECURITY.md).
4. Install, build and verify outside an active assessment:

```sh
cd /srv/gotit
npm ci
npm run setup:coding
npm run check
npm run verify:coding
npm run verify:web
```

Keep build dependencies available during installation: Vite and the type checker are development dependencies. The [test plan](../reference/TEST_PLAN.md) explains which checks run real containers and which use fictional fixtures.

## 2. Configure persistent records

For a fresh installation, create a writable `/var/lib/gotit` directory and use distinct source and migration paths in the project's private `.env`:

```dotenv
DATA_FILE=/var/lib/gotit/studio.sqlite
MIGRATION_DATA_FILE=/var/lib/gotit/active.migration.sqlite
NODE_ENV=production
DEMO_MODE=0
HOST=127.0.0.1
PORT=3000
PUBLIC_ORIGIN=https://assess.your-domain.example
PREVIEW_ORIGIN=https://preview.your-domain.example
PREVIEW_HOST=127.0.0.1
PREVIEW_PORT=3102
```

Replace both domains. Add a unique `INSTRUCTOR_PASSWORD` of at least 16 characters and only the optional AI settings you use. `.env` loads from the project root; explicit service environment values take precedence.

For existing records, follow [backup and recovery](BACKUP_AND_RECOVERY.md): take a verified snapshot of the **active migration database** between runs and restore it to a new target. Point `MIGRATION_DATA_FILE` to that restored target. Do not replace it with the preserved original database.

On a fresh install, run `npm start` once and stop it after successful startup to create the database. The supervisor requires an existing persistent target. Ensure the service account can write the database directory, project temp directory and npm cache.

## 3. Route two HTTPS hostnames

Point the application and preview DNS names at the VM. Keep ports 3000 and 3102 on loopback; expose the HTTPS proxy instead. Example Caddy configuration:

```caddyfile
assess.your-domain.example {
    reverse_proxy 127.0.0.1:3000
}

preview.your-domain.example {
    reverse_proxy 127.0.0.1:3102
}
```

Caddy can obtain certificates automatically for actual DNS names when ports 80/443 are reachable. Follow its [reverse proxy setup](https://caddyserver.com/docs/quick-starts/reverse-proxy) and [service instructions](https://caddyserver.com/docs/running). Keep the preview hostname separate from institution sign-in cookies.

## 4. Run one supervised application

Build before normal service launch with `npm run build`, then run the equivalent of `npm run serve:local` as an operating-system service. Set its working directory to `/srv/gotit`, use the dedicated account, enable reboot startup and configure restart limits. Confirm that account can find Node and reach Docker.

The launcher preflights the active database and disk headroom, makes an initial verified backup, then backs up hourly. It supervises the app process but does not build the editors or configure the HTTPS proxy. Do not run an extra interactive `npm start` against the same database.

Check login, drafts, terminal input, preview rendering, grading and publication through both public hostnames. Test restart/reboot recovery and copy verified backups off the server. Local snapshots alone do not cover loss of the VM disk. Complete the [graded-deployment gates](../reference/TEST_PLAN.md#before-a-graded-deployment) before consequential use.

## Optional separate execution worker

The API can keep its database and grading rules while another host runs Docker. This separates the records host from student-program execution.

| Setting                       | Application/API host                       | Execution host                |
| ----------------------------- | ------------------------------------------ | ----------------------------- |
| `EXECUTION_ORIGIN`            | Worker's HTTPS origin                      | Not needed                    |
| `EXECUTION_SECRET`            | Same random secret, at least 32 characters | Same secret                   |
| `WORKER_HOST` / `WORKER_PORT` | Not used for API listener                  | Defaults `127.0.0.1:3101`     |
| `TERMINAL_CAPACITY`           | Used for local execution only              | Set here for remote execution |

Run `npm run worker` on the execution host. Supply the secret through its service environment: the worker entry point does **not** load the project `.env` itself. Install and verify the pinned images on that host. Front the worker with HTTPS and restrict access to the API host; never expose the Docker socket to students.

The public preview origin still routes to the API's preview service on port 3102. That service relays to the configured execution worker; do not route public students directly to the authenticated worker API.

Preview workspaces expire and are removed on normal shutdown. Each PHP workspace also enforces a 12-minute lifetime inside its container, independently of the application or worker process. New launches reconcile actual containers, count live crash survivors toward capacity, and remove only expired containers with this installation's `gotit.owner` label. `EXECUTION_INSTANCE_ID` can give separate installations a stable scope; keep it consistent across restarts and do not share it between unrelated deployments. Legacy containers created before these labels need deliberate operator inspection.

The Windows launchers use a private parent/child IPC channel for graceful shutdown rather than relying on `child.kill()` to run JavaScript cleanup. Forced process or host termination still relies on the container deadline and the last durable database checkpoint. Preview POST responses persist a database snapshot before success; other database changes are checkpointed periodically and during save, export, replacement and normal shutdown.

Keep records and accepted submissions available while planning any code or database rollback; the historical migration tag is documented in [the migration archive](../archive/MIGRATION_2026-11-04.md).
