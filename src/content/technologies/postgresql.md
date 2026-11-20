---
name: PostgreSQL
summary: The relational database behind the inventory API, learnt from psql and schema design through indexes, transactions and day-to-day operation.
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
    learn:
      - The postgres:18 image, its POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB variables, and that 18+ expects the volume at /var/lib/postgresql
      - The hierarchy cluster > database > schema > table, and that one connection talks to exactly one database
      - Roles are both users and groups; LOGIN is just an attribute
      - psql meta-commands (\l, \c, \dn, \dt, \d table, \du, \x, \timing, \conninfo) versus SQL statements
      - Connection URLs and how the same database is reached from psql, Python and another container
    practice:
      - Run postgres:18 with a named volume, then open psql with docker exec -it and create an inventory database
      - Create an app role with LOGIN and a password, and connect as it from the host on port 5432
      - Remove and recreate the container and confirm the data survived in the volume
    doneWhen:
      - I can explain the difference between a database, a schema and a role
      - I can connect to the same database from psql in the container and from a Python script on the host
    notes: [postgresql-essentials-for-app-developers, docker-compose-python-and-postgres]
  - title: SQL and schema design for apps
    goal: Design the inventory schema with the right types and constraints so the database rejects bad data on its own.
    learn:
      - Choosing types - integer and bigint identity columns, numeric for money, timestamptz for instants, text or varchar, uuid, jsonb
      - Constraints - NOT NULL, UNIQUE, CHECK, PRIMARY KEY and FOREIGN KEY with ON DELETE behaviour
      - Normalisation to third normal form, and when a jsonb column is a reasonable escape hatch
      - Transactional DDL and other differences from Oracle (empty string is not NULL, identity columns, no auto-commit on DDL)
      - INSERT ... ON CONFLICT and RETURNING for upserts and getting generated keys back
    practice:
      - Write CREATE TABLE statements for warehouse and item by hand, with every constraint named or obvious
      - Try to insert a negative quantity, an orphan item and a duplicate SKU, and read each error message
      - Write the queries the API will need (items in a warehouse, low stock, stock value per warehouse)
    doneWhen:
      - Every business rule I can state about items is enforced by a constraint, not just by Python
      - I can justify numeric over float and timestamptz over timestamp without notes
    notes: []
  - title: Indexes and query plans
    goal: Read an EXPLAIN ANALYZE plan and add the index that actually helps, rather than guessing.
    learn:
      - B-tree indexes and the plan nodes that use them (Index Scan, Index Only Scan, Bitmap Heap Scan) versus Seq Scan
      - Composite index column order, and what PostgreSQL 18 skip scan does and does not change
      - Partial and expression indexes, and GIN for jsonb
      - Foreign keys are not indexed automatically; UNIQUE and PRIMARY KEY are
      - Statistics, ANALYZE, and why the planner sometimes prefers a sequential scan
    practice:
      - Load 200,000 generated items with generate_series and time the main API queries before and after indexing
      - Compare a composite index on (warehouse_id, quantity) with two single-column indexes in EXPLAIN ANALYZE
      - Add a partial index for low stock and confirm the planner uses it
    doneWhen:
      - I can point at estimated versus actual rows in a plan and explain a mismatch
      - Every index in the inventory schema has a query that justifies it
    notes: [postgresql-indexes-and-explain]
  - title: Transactions, isolation and locking
    goal: Write stock-changing code that stays correct when two requests touch the same rows at once.
    learn:
      - MVCC - readers do not block writers, and every statement sees a snapshot
      - READ COMMITTED (the default) versus REPEATABLE READ versus SERIALIZABLE, and serialisation failures (SQLSTATE 40001)
      - Lost updates, and the fixes - atomic UPDATE, SELECT ... FOR UPDATE, or a higher isolation level with retries
      - SKIP LOCKED and NOWAIT for queue-like workloads
      - Deadlocks, lock ordering, and idle-in-transaction sessions
    practice:
      - Reproduce a lost update with two psql sessions, then fix it three different ways
      - Trigger a serialisation failure under REPEATABLE READ and write a retry loop for it in Python
      - Build a tiny job queue table and drain it with two workers using FOR UPDATE SKIP LOCKED
    doneWhen:
      - I can predict what the second session sees in each isolation level
      - The receive-stock and dispatch-stock code paths survive a concurrent test
    notes: [postgresql-transactions-and-isolation]
  - title: Operating it
    goal: Back up, restore, secure and keep an eye on a small production Postgres without surprises.
    learn:
      - pg_dump custom format, pg_restore, and pg_dumpall --globals-only for roles
      - Least-privilege roles - an owner role for migrations and a separate app role for the API
      - max_connections, connection pooling in SQLAlchemy and PgBouncer, and why idle connections still cost memory
      - VACUUM, autovacuum and ANALYZE, and what table bloat is
      - pg_stat_activity and pg_stat_statements for seeing what the database is doing
    practice:
      - Dump the inventory database, drop it, restore it and verify row counts
      - Create inventory_owner and inventory_app roles and prove the app role cannot drop a table
      - Find a long-running query in pg_stat_activity and cancel it with pg_cancel_backend
    doneWhen:
      - A restore drill works end to end from a single command I have written down
      - The API connects as a role that owns nothing
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

Every backend I'd want to build needs somewhere durable to keep its state, and PostgreSQL is the default answer for good reasons: it is strict about data types and constraints, its transactions are properly ACID, and it has an enormous ecosystem. My previous SQL experience is Oracle, from a Java and Spring job where an ORM and a DBA hid most of the details. This time I want to understand the database itself: how to design a schema that refuses bad data, how to read a query plan, and what actually happens when two requests change the same row.

## How it fits with the rest of my stack

Postgres is the storage layer of the inventory API project. I run it locally with Docker (the official `postgres:18` image with a named volume), and later with Docker Compose next to the Python service. The application talks to it from Python through SQLAlchemy, using the psycopg 3 driver, and schema changes go through Alembic migrations rather than hand-run SQL. In CI, GitHub Actions starts a Postgres service container so the pytest suite runs against the same database engine as production, not SQLite.

Learning Postgres directly, before leaning on SQLAlchemy, matters: SQLAlchemy only writes SQL, so when a query is slow or a transaction deadlocks, the diagnosis happens in psql with `EXPLAIN` and `pg_stat_activity`.

## How to use this roadmap

Work through the stages in order. Each one builds on the schema from the previous stage.

1. **Running Postgres and psql basics**: two or three evenings. Get comfortable enough with psql that it is quicker than a GUI.
2. **SQL and schema design for apps**: about a week. This is the most valuable stage; the inventory schema designed here is the one the SQLAlchemy models will mirror.
3. **Indexes and query plans**: about a week, with plenty of time spent on generated data so plans are realistic.
4. **Transactions, isolation and locking**: about a week. Use two psql windows side by side for every experiment.
5. **Operating it**: a few evenings, ideally repeated once the inventory API is deployed somewhere real.

From stage 2 onwards, start the SQLAlchemy roadmap in parallel and apply each Postgres lesson to the inventory API project as I go: every constraint, index and locking decision should end up in an Alembic migration or in the service code.
