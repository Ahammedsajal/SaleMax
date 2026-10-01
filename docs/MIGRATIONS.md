# Forward migration operations

Implemented during TC00 on 1 October 2026. The previous runner selected a pipeline rollback alongside forward files. The replacement excludes rollback/down/revert files, rejects destructive forward statements and defaults to a database-free plan.

```sh
npm run migrate:plan
npm test
```

On Windows, run `scripts/test-migrations-local.ps1` for real MariaDB verification. It starts a separate loopback-only engine on port 3308, uses a uniquely named synthetic database, verifies repeat runs, two-connection exclusion and a DDL failure, then removes that synthetic database and stops its own process. It does not use imported customer records. Test engine data/logs stay under the ignored local-runtime folder. Change the MariaDB binary path/port through the script parameters when required.

## Applying a reviewed release

`npm run migrate:apply` is an explicit mutation using the selected DBHOST/DBPORT/DBUSER/DBPASS/DBNAME environment. Review the plan, target database, backup and staging rehearsal first. It requires an explicit host, user and database, uses a dedicated connection and holds a database-specific advisory lock. The `salemax_schema_migrations` table records checksum, status and per-statement progress. Applied checksums cannot change; historical files cannot disappear. All history is checked before new statements execute.

## Existing databases without a ledger

Do not blindly apply this runner to the existing SaleMaX database. Some legacy migrations have already been applied, including a non-idempotent ADD COLUMN. TC35/TC29 must compare the actual schema with each legacy migration and establish a reviewed adoption baseline under the same lock. No automatic mark-as-applied option exists. A new ledger is not proof that an old schema matches its migrations. Current work has only executed migrations against a fresh synthetic database.

## Interrupted migrations

MariaDB DDL can commit independently of a transaction. A failure or interrupted `running` record blocks later runs. `statements_completed` is diagnostic, not permission to resume: the last statement may have committed before checkpointing. Review actual schema/data and the release backup, record a recovery decision, and use a verified compensating/recovery procedure before repairing the ledger. Never rerun a partially applied file automatically or execute the historical rollback file to clear the problem.

The parser supports simple single SQL statements with quoted literals/identifiers and comments. Stored-procedure DELIMITER scripts and executable comments are rejected. Complex future migrations require a separately reviewed runner capability; do not weaken these checks to make an unreviewed migration run.
