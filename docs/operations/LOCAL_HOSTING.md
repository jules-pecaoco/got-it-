# Host the app from your PC

[Documentation contents](../README.md) · For a dedicated server, use [deployment](DEPLOYMENT.md).

Your PC can serve the application while students use public HTTPS addresses. The application and records still live on your PC, so it must stay powered, awake and connected. Start with a supervised pilot; a tunnel does not establish classroom capacity or complete the [release checks](../reference/TEST_PLAN.md#before-a-graded-deployment).

## 1. Prepare the app

First complete [local setup](../guides/RUN_LOCALLY.md) and confirm the database has been created. Stop the local app. Use a **fresh PowerShell window** so development origins do not override `.env`.

```powershell
cd D:\code\ctfv1
npm run build
npm run prepare:local
```

Preparation disables demo mode, selects loopback binding and generates a strong faculty password if necessary. Database paths, AI keys and other settings are preserved. Retrieve the password privately from `.env`; it is not printed.

## 2. Create a stable tunnel

With a Cloudflare account and a domain configured there, create a named tunnel and follow the dashboard's Windows connector setup. Add both published-application routes:

| Public hostname — replace with your real domain | Local service           |
| ----------------------------------------------- | ----------------------- |
| `assess.your-domain.example`                    | `http://127.0.0.1:3000` |
| `preview.your-domain.example`                   | `http://127.0.0.1:3102` |

The second address serves student-created websites separately from the main app. Follow [Cloudflare's tunnel setup](https://developers.cloudflare.com/tunnel/get-started/) for the account and connector steps.

## 3. Set the public addresses

Update these existing `.env` entries, preserving database paths, passwords and keys. Replace the example domains:

```dotenv
NODE_ENV=production
DEMO_MODE=0
HOST=127.0.0.1
PORT=3000
PUBLIC_ORIGIN=https://assess.your-domain.example
PREVIEW_ORIGIN=https://preview.your-domain.example
PREVIEW_HOST=127.0.0.1
PREVIEW_PORT=3102
```

Keep a unique `INSTRUCTOR_PASSWORD` of at least 16 characters. Both production origins must use HTTPS and must differ. A loopback preview URL would point at each remote student's own machine, so it cannot serve as their public preview address.

## 4. Start supervised hosting

```powershell
npm run serve:local
```

The launcher selects the migration database, runs preflight, creates an initial verified backup, starts one application process and makes hourly backups. Interrupted application processes restart with backoff; repeated rapid failures stop the launcher. It does not build editor assets, which is why the build came first.

Preflight needs an existing persistent database, the required coding images, production configuration and at least **10 GB free** on each checked drive. Also check Docker's storage drive if it differs. The launcher does not delete files or relocate Docker storage.

Keep the terminal and tunnel connector running. For startup after reboot, configure Windows Task Scheduler for the application and use the connector's supported service setup. Do not start another application against the same database.

Students use `https://assess.your-domain.example/app/student`; faculty and proctors use the same main host with their respective workspace paths. Do not change public origins during an active run.

## 5. Rehearse the real workflow

Use fictional records to check public login, saving, refresh/rejoin, interactive code, website previews and faculty score publication. Test a restart and a verified [backup/restore](BACKUP_AND_RECOVERY.md). Copy backups off the PC.

The live-terminal default is **8 simultaneous runs**, adjustable through `TERMINAL_CAPACITY` from 1–80 only after measuring the host. The persisted queue has separate limits: two jobs run concurrently, with a normal pending capacity of 160. These values are controls, not a promise that a particular class size will perform well.

`/api/ready` checks database access; authenticated faculty `/api/instructor/system` reports queue and process metrics. Record queue wait, latency, CPU/RAM and errors during a representative rehearsal. The old `test:load` script still assumes automatic console grading and needs updating before it can support a current capacity claim. See the [test plan](../reference/TEST_PLAN.md).

## Temporary online rehearsal

Once local setup has created the database, a fresh PowerShell window can run:

```powershell
cd D:\code\ctfv1
npm run build
npm run serve:preview
```

The helper starts the installed `cloudflared`, reads its random HTTPS address, and starts the supervisor with that main origin. It publishes **only port 3000**. It does not create the second tunnel for website previews.

Without a reachable HTTPS `PREVIEW_ORIGIN`, web previews remain unavailable. An old HTTP preview setting fails the production HTTPS check. For a full preview rehearsal, configure a separate HTTPS tunnel to port 3102 first, or use the two named routes above.

The temporary address changes on restart and stops when the helper stops. Cloudflare provides no uptime guarantee for [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/); use them for testing rather than a regular class address.
