---
name: PostgreSQL
summary: The database behind InferenceFlow, learnt from psql and schema design through indexes, transactions and job leasing, and used from Go with pgx.
status: learning
started: 2026-11-20
links:
  docs: https://www.postgresql.org/docs/current/
  repo: https://github.com/postgres/postgres
language: []
lifecycle: [design, build, operate]
domain: [backend, data]
kind: [platform]
prerequisites: [docker]
roadmap:
  - title: Running Postgres and psql basics
    goal: Start Postgres 18 in Docker, connect with psql and find my way around databases, schemas and roles.
    apply: "InferenceFlow P4: PostgreSQL, SQL-first persistence and transactions"
    learn:
      - The postgres:18 image, its POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB variables, and that 18+ expects the volume at /var/lib/postgresql
      - The hierarchy cluster > database > schema > table, and that one connection talks to exactly one database
      - Roles are both users and groups; LOGIN is just an attribute
      - psql meta-commands (\l, \c, \dn, \dt, \d table, \du, \x, \timing, \conninfo) versus SQL statements
      - Connection URLs, and how the same database is reached from psql, from a Go program on the host and from another container
    practice:
      - Run postgres:18 with a named volume, then open psql with docker exec -it and create an inferenceflow database
      - Create an app role with LOGIN and a password, and connect as it from the host on port 5432
      - Remove and recreate the container and confirm the data survived in the volume
      - Put Postgres and a small Go program in one Compose file and connect by service name
    doneWhen:
      - I can explain the difference between a database, a schema and a role
      - I can connect to the same database from psql in the container and from a Go program using a DATABASE_URL
    notes: [postgresql-essentials-for-app-developers, docker-compose-go-and-postgres]
  - title: SQL and schema design for apps
    goal: Sketch the job-processing tables with the right types and constraints so the database rejects bad data on its own.
    apply: "InferenceFlow P4: PostgreSQL, SQL-first persistence and transactions"
    learn:
      - Choosing types - bigint identity columns, uuid (and uuidv7() in 18), timestamptz for instants, text with CHECK constraints, numeric when exactness matters, jsonb
      - Constraints - NOT NULL, UNIQUE, CHECK, PRIMARY KEY and FOREIGN KEY with ON DELETE behaviour
      - Modelling a state machine with a constrained status column, and keeping attempts in their own table
      - Transactional DDL and other differences from Oracle (empty string is not NULL, identity columns, no implicit commit on DDL)
      - INSERT ... ON CONFLICT and RETURNING, and why they make tenant-scoped idempotency keys safe without a check-then-insert race
    practice:
      - Write CREATE TABLE statements for tenants, jobs and job attempts by hand, with every constraint named or obvious
      - Try to insert an unknown status, a job for a missing tenant and a duplicate (tenant, idempotency key), and read each error
      - Write the queries the API will need (a tenant's jobs by status, one job with its attempts, runnable jobs)
    doneWhen:
      - Every job invariant I can state in SQL is enforced by a constraint, not only by Go code
      - I can justify timestamptz over timestamp and a unique constraint over a SELECT-then-INSERT without notes
    notes: []
  - title: Talking to Postgres from Go
    goal: Use pgx v5 with a connection pool, keep SQL in sqlc query files, and version the schema with goose.
    apply: "InferenceFlow P4: PostgreSQL, SQL-first persistence and transactions"
    learn:
      - database/sql concepts first (pool, rows, transactions), then why pgx v5 is the PostgreSQL-native choice
      - pgxpool - pool sizing, acquiring connections, and that a pool is shared by every goroutine
      - Transactions with pgx.BeginFunc and pgx.BeginTxFunc, and passing a pgx.Tx into repository methods
      - Reading *pgconn.PgError codes (23505 unique_violation, 40001 serialization_failure) and mapping them to domain errors
      - sqlc with the pgx/v5 driver - SQL files in, typed Go methods out - and that it does not choose transaction boundaries
      - goose migrations as a separate deployment step, not something every replica runs at startup
    practice:
      - Replace the in-memory job repository with a pgx one and keep the existing domain and HTTP tests passing
      - Generate the job queries with sqlc and read the generated code
      - Write goose up and down migrations for the first jobs table, then add attempts in a later migration
      - Fire 20 concurrent submissions with the same idempotency key and show they converge to one row
    doneWhen:
      - A duplicate key becomes a clear domain error, not a 500 with a raw SQL message
      - I can explain which statements share a transaction in the submit path and why
    notes: []
  - title: Indexes and query plans
    goal: Read an EXPLAIN ANALYZE plan and add the index that actually helps, rather than guessing.
    apply: "InferenceFlow P4: PostgreSQL, SQL-first persistence and transactions"
    learn:
      - B-tree indexes and the plan nodes that use them (Index Scan, Index Only Scan, Bitmap Heap Scan) versus Seq Scan
      - Composite index column order, and what PostgreSQL 18 skip scan does and does not change
      - Partial indexes for small hot subsets such as runnable jobs, and expression indexes
      - Foreign keys are not indexed automatically; UNIQUE and PRIMARY KEY are
      - Keyset pagination instead of OFFSET for job lists
      - Statistics, ANALYZE, generic plans for prepared statements, and why the planner sometimes prefers a sequential scan
    practice:
      - Load 200,000 generated jobs with generate_series and time the main API queries before and after indexing
      - Index the tenant job list for (tenant_id, status, created_at) and compare the plan with a single-column index
      - Add a partial index for runnable jobs and confirm the claim query uses it
    doneWhen:
      - I can point at estimated versus actual rows in a plan and explain a mismatch
      - Every index in the schema has a query that justifies it
    notes: [postgresql-indexes-and-explain]
  - title: Transactions, isolation and locking
    goal: Write job-claiming and state-changing code that stays correct when workers race, stall or crash.
    apply: "InferenceFlow P7: durable job state, leases, and consistency"
    learn:
      - MVCC - readers do not block writers, and every statement sees a snapshot
      - READ COMMITTED (the default) versus REPEATABLE READ versus SERIALIZABLE, and serialisation failures (SQLSTATE 40001)
      - Lost updates, and the fixes - atomic conditional UPDATE, SELECT ... FOR UPDATE, or a higher isolation level with retries
      - FOR UPDATE SKIP LOCKED for claiming jobs, leases with database time, and fencing tokens that reject stale workers
      - Advisory locks for singleton background tasks
      - Writing a state change and an outbox row in one transaction, which InferenceFlow P8 (outbox, events, and reliable asynchronous messaging) builds on
      - Deadlocks, lock ordering, and idle-in-transaction sessions
    practice:
      - Reproduce a double claim with two psql sessions, then fix it with a conditional UPDATE, with FOR UPDATE and with REPEATABLE READ
      - Write a Go retry helper for 40001 and 40P01 with capped, jittered backoff
      - Drain 200 queued jobs with four goroutine workers using FOR UPDATE SKIP LOCKED and prove no job was claimed twice
      - Expire a lease, let a second worker reclaim the job, and show the first worker's completion is rejected
    doneWhen:
      - I can predict what the second session sees in each isolation level
      - Concurrent claim, crash-and-reclaim and stale-completion tests pass against real Postgres
    notes: [postgresql-transactions-and-isolation]
  - title: Operating it
    goal: Back up, restore, secure and keep an eye on a small production Postgres without surprises.
    apply: "InferenceFlow P9: observability and operational ownership"
    learn:
      - pg_dump custom format, pg_restore, and pg_dumpall --globals-only for roles
      - Least-privilege roles - an owner role for goose migrations and a separate app role for the API and workers
      - max_connections, pgxpool sizing and pool saturation, PgBouncer, and why idle connections still cost memory
      - VACUUM, autovacuum and ANALYZE, and the bloat a busy jobs table produces
      - pg_stat_activity and pg_stat_statements for seeing what the database is doing
    practice:
      - Dump the database, drop it, restore it and verify row counts
      - Create inferenceflow_owner and inferenceflow_app roles and prove the app role cannot drop a table
      - Find a long-running query in pg_stat_activity and cancel it with pg_cancel_backend
      - Export pgxpool statistics (acquired, idle, waiting) as metrics
    doneWhen:
      - A restore drill works end to end from a single command I have written down
      - The API and workers connect as a role that owns nothing
    notes: []
resources:
  - title: PostgreSQL tutorial
    url: https://www.postgresql.org/docs/current/tutorial.html
    kind: docs
  - title: PostgreSQL documentation - indexes
    url: https://www.postgresql.org/docs/current/indexes.html
    kind: docs
  - title: PostgreSQL documentation - concurrency control
    url: https://www.postgresql.org/docs/current/mvcc.html
    kind: docs
  - title: pgx v5 package documentation
    url: https://pkg.go.dev/github.com/jackc/pgx/v5
    kind: docs
  - title: sqlc - using Go and pgx
    url: https://docs.sqlc.dev/en/latest/guides/using-go-and-pgx.html
    kind: docs
  - title: goose migrations
    url: https://github.com/pressly/goose
    kind: tool
  - title: Accessing relational databases (Go documentation)
    url: https://go.dev/doc/database/
    kind: docs
  - title: Don't do this (PostgreSQL wiki)
    url: https://wiki.postgresql.org/wiki/Don't_Do_This
    kind: article
  - title: Use the index, Luke
    url: https://use-the-index-luke.com/
    kind: book
  - title: Official postgres Docker image
    url: https://hub.docker.com/_/postgres
    kind: tool
---

## Why I'm learning it

[InferenceFlow](/projects/inferenceflow) is a job-processing system whose whole difficulty is staying correct when things go wrong: clients retry submissions, workers stall or crash, and two processes try to finish the same job. PostgreSQL is where that correctness lives. A unique constraint on `(tenant_id, idempotency_key)` is what makes a retried submission safe; a row lock and a fencing token are what stop two workers from both owning a job. Until P8 adds a message broker, Postgres is also the work queue.

My previous SQL experience is Oracle, from a Java and Spring job where an ORM and a DBA hid most of the details. This time I want to understand the database itself: how to design a schema that refuses bad data, how to read a query plan, and what actually happens when two transactions change the same row.

## How it fits with the rest of my stack

- **Go.** The services reach Postgres through `pgx/v5` and a `pgxpool.Pool`. Queries are written as SQL and turned into typed Go methods by `sqlc`, so the SQL I tune in psql is exactly the SQL the service runs. Transaction boundaries stay in my code, usually through `pgx.BeginFunc`, and error handling checks `*pgconn.PgError` codes such as `23505` and `40001`. Schema changes are `goose` migrations, run as their own deployment step. The [Go roadmap](/stack/go) covers the language side.
- **Docker.** Locally I run the official `postgres:18` image with a named volume, and later Docker Compose runs it next to the API, workers and relay. Integration tests run against a real container, never a stand-in.
- **GitHub Actions.** CI starts a Postgres service container so migrations and the concurrency tests run against the same engine and major version as production.

Learning Postgres directly matters because neither pgx nor sqlc decides anything for me: when a claim query is slow or two workers deadlock, the diagnosis happens in psql with `EXPLAIN` and `pg_stat_activity`.

## How to use this roadmap

Work through the stages in order. The `apply` line on each stage names the InferenceFlow phase that puts it to use.

1. **Running Postgres and psql basics**: two or three evenings. Get comfortable enough with psql that it is quicker than a GUI.
2. **SQL and schema design for apps**: about a week. The job tables sketched here are practice for P4's first migration, not a final design; the repository's README and docs decide the real schema.
3. **Talking to Postgres from Go**: about a week, alongside P4. This is where the in-memory repository gets replaced.
4. **Indexes and query plans**: a few evenings, with generated data so the plans are realistic.
5. **Transactions, isolation and locking**: about a week before P7. Use two psql windows side by side for every experiment, then repeat it as a Go test with goroutines.
6. **Operating it**: a few evenings, repeated once InferenceFlow runs somewhere real.

Every constraint, index and locking decision should end up in a goose migration, an sqlc query file or a test that proves it.
