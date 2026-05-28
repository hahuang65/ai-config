---
description: Block DROP/DELETE/TRUNCATE/ALTER/UPDATE via psql/mysql/sqlite3/mongo/redis-cli CLIs.
condition:
  - '\b(psql|mysql|mariadb|sqlite3?|mongo(sh)?|redis-cli)\b[^|;&\n]*\b(DROP|TRUNCATE|ALTER\s+TABLE|DELETE\s+FROM)\b'
  - '\b(psql|mysql|mariadb|sqlite3?)\b[^|;&\n]*\bUPDATE\s+\w+\s+SET\b'
  - '\b(psql|mysql|mariadb)\b[^|;&\n]*\s<\s*\S+\.sql'
scope: tool:bash
---

# No database mutation via CLI

You were about to run a database-mutating command through a CLI. Stop.

DROP, TRUNCATE, ALTER TABLE, DELETE FROM, UPDATE SET — these are irreversible (or expensive to reverse) actions against shared state. Piping a `.sql` file into a DB CLI is the same risk with less visibility into what the file contains. Either way, the agent should never trigger these autonomously.

Right approach:

- Tell the user the exact statement you want to run and which database/environment it targets
- Wait for them to execute it themselves, or to approve via a migration tool that has its own audit trail
- For exploration: prefer `SELECT` queries (which this rule doesn't block) to understand state before mutating
- For schema changes: use the project's migration framework (e.g., `rails db:migrate`, `alembic upgrade`, `prisma migrate`), not direct CLI DDL

Re-plan as a hand-off to the user, then proceed.
