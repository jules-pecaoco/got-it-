# Back up and recover records

[Documentation contents](../README.md) · Related: [deployment](DEPLOYMENT.md), [troubleshooting](TROUBLESHOOTING.md)

The important first step is choosing the database the app actually uses. The original database and its migration copy can both exist; backing up the wrong one can miss recent student work.

## Find the active database

Normal startup prints the migration target and preserved original. The supervisor selects the migration target before preflight and backups. Check those paths before maintenance.

| Setting                      | Meaning                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `DATA_FILE`                  | Original configured source; defaults to `data/studio.sqlite`                 |
| `MIGRATION_DATA_FILE`        | Optional explicit application target                                         |
| No explicit migration target | Startup appends `.migration.sqlite` to the source path                       |
| Maintenance commands         | Use `DATA_FILE` directly, without automatically selecting the migration copy |

For example, source `data/studio.sqlite` normally produces active target `data/studio.sqlite.migration.sqlite`. Your `.env` can select a different source, including a recovered database. Do not assume this example is your live path. Explicit environment variables override `.env`.

If the target is absent, the launcher copies an existing source consistently. If the target already exists, it reuses it. The original does not receive subsequent work accepted by the migration server.

## Make a verified backup

Use a **separate maintenance PowerShell window**. Paste the actual active database path printed at startup:

```powershell
cd D:\code\ctfv1
$env:DATA_FILE = Read-Host 'Paste the active database path'
npm run backup
```

Confirm the printed source and verified destination. The command creates a new snapshot beside the selected database in `backups/`, checks SQLite integrity and refuses to overwrite an existing destination.

Close that maintenance window afterward. Starting the normal launcher with its temporary `DATA_FILE` selection could create an unintended second migration suffix.

The supervised `serve:local` launcher already selects the active migration database before its initial and hourly backups. Ordinary `npm start` does not schedule those backups. Keep verified copies on another device and restrict them like student records: they contain answers and private grading data. Original uploaded document binaries are not retained by the app.

Do not simply copy a database while it is using WAL journals. A live `.sqlite` file alone can miss committed work; use the provided SQLite-consistent backup command.

## Restore to a new target

1. Stop the application and worker between runs. Preserve the current active database and export any results you need.
2. Choose a verified snapshot and a **new** destination. Replace these example paths:

   ```powershell
   npm run restore -- 'D:/backups/verified.sqlite' 'D:/code/ctfv1/data/restored.migration.sqlite'
   ```

3. Review the printed table counts and integrity/foreign-key checks.
4. Set `MIGRATION_DATA_FILE=data/restored.migration.sqlite` in `.env`, keeping `DATA_FILE` distinct. Use a fresh launch shell.
5. Start the app and check faculty access, rosters, attempts, deadlines and scores before resuming work.

Restore refuses to overwrite an existing target. Selecting the restored file through `MIGRATION_DATA_FILE` ensures the current launcher opens that file rather than creating or reusing another migration copy.

## Provision a faculty account

The existing default owner is `faculty`. A separately provisioned account uses its stored password rather than the fallback `INSTRUCTOR_PASSWORD`. New accounts see only their own records; existing content stays with its existing owner.

In a separate maintenance shell, select the active database as above, set `FACULTY_PASSWORD` privately in the environment, and run:

```powershell
npm run faculty -- lecturer1
```

The username must be 3–40 lowercase letters, digits or hyphens. The CLI accepts passwords of 12–200 characters; choose at least 16 for deployment. Updating an account revokes its current faculty sessions. Close the maintenance shell afterward. Changing record ownership is a separate deliberate operation.

## Cleanup and rollback

The cleanup script requires an explicit database path and makes a verified backup first:

```powershell
node --import ./src/runtime-temp.mjs --import tsx --experimental-sqlite scripts/cleanup-assessments.mjs PATH-TO-ACTIVE-DATABASE
```

It removes unused unpublished assessments and unfinished AI previews. Additional assessment IDs explicitly select sample assessments and their related records for removal. Review the target before using it. Routine cleanup otherwise preserves published assessments.

Code rollback does not move new submissions back into an old database. Preserve both data versions, reconcile accepted work and cut over between runs. The baseline tag and original rollback notes remain in [the migration archive](../archive/MIGRATION_2026-11-04.md); never open an upgraded database with older code merely because its source checkout was restored.
