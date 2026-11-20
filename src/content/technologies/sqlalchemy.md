---
name: SQLAlchemy
summary: The Python SQL toolkit and ORM I use to talk to PostgreSQL, in modern 2.x style, with Alembic for migrations and pytest for tests.
status: learning
started: 2026-11-20
links:
  docs: https://docs.sqlalchemy.org/en/21/
  repo: https://github.com/sqlalchemy/sqlalchemy
language: []
lifecycle: [design, build, test]
domain: [backend, data]
kind: [library]
prerequisites: [postgresql]
roadmap:
  - title: Core basics
    goal: Connect to Postgres from Python, run parameterised SQL and control exactly when a transaction commits.
    learn:
      - The engine as a long-lived factory and connection pool, created once per process
      - Database URLs with an explicit driver, postgresql+psycopg://user:pass@host:5432/db
      - text() with bound parameters, and why f-strings in SQL are an injection bug
      - Commit as you go with engine.connect() versus begin once with engine.begin()
      - Result objects - rows, scalar_one(), scalars() and mappings()
    practice:
      - Install sqlalchemy and psycopg[binary] with uv and connect to the Postgres container
      - Insert and read inventory rows with text() and named parameters
      - Turn on echo=True and watch BEGIN, COMMIT and ROLLBACK in the log
    doneWhen:
      - I can say which code path commits and which rolls back without running it
      - No SQL in my code is built with string formatting
    notes: [sqlalchemy-engine-connection-session]
  - title: ORM models and relationships
    goal: Model Warehouse and Item as typed ORM classes that produce the same schema I would write by hand.
    learn:
      - DeclarativeBase, Mapped[] annotations and mapped_column(), and how nullability follows from Optional types
      - Choosing column types - Numeric for prices with Decimal, DateTime(timezone=True), Identity() keys
      - relationship() with back_populates, and cascade="all, delete-orphan" versus ON DELETE CASCADE
      - Constraints in the model - unique, index, CheckConstraint and ForeignKey
      - Object states (transient, pending, persistent, detached) and the identity map
    practice:
      - Write the Warehouse and Item models and compare the generated DDL with my hand-written SQL
      - Add items through warehouse.items and check what gets flushed and in which order
      - Delete a warehouse and observe what happens to its items with and without delete-orphan
    doneWhen:
      - The ORM-generated DDL matches the schema from the PostgreSQL roadmap
      - I can explain the difference between flush and commit
    notes: [sqlalchemy-orm-models-and-relationships]
  - title: Querying with select
    goal: Write every query a small inventory app needs with select(), without N+1 problems.
    learn:
      - select(), where(), order_by(), limit() and the Session.scalars and Session.execute entry points
      - Joins along relationships, aggregates with func and group_by, and getting rows rather than objects
      - Lazy loading and the N+1 problem
      - selectinload, joinedload (and why it needs unique() for collections) and raiseload
      - Bulk UPDATE and DELETE statements versus changing objects one by one
    practice:
      - Implement list-items, low-stock and stock-value-per-warehouse queries
      - Log SQL while rendering a list of warehouses with items, then fix the N+1 with selectinload
      - Set lazy="raise" on a relationship and see which code paths break
    doneWhen:
      - Listing warehouses with their items issues a fixed number of queries regardless of row count
      - I never reach for the legacy session.query() API
    notes: [sqlalchemy-querying-with-select]
  - title: Sessions and transactions in an app
    goal: Use one session per unit of work in a small inventory app, with commits and rollbacks in exactly one place.
    learn:
      - sessionmaker as the session factory, configured once alongside the engine
      - Session per request, and why sessions must never be shared between threads or requests
      - The begin-once pattern, with Session.begin() committing or rolling back automatically
      - expire_on_commit, DetachedInstanceError, and returning plain data from the service layer
      - Isolation levels, with_for_update(), and retrying serialisation failures
    practice:
      - Write a get_session dependency that yields a session and closes it after the request
      - Implement receive-stock with SELECT ... FOR UPDATE and test it with two concurrent threads
      - Make a request fail halfway through and confirm nothing from it was committed
    doneWhen:
      - There is exactly one place in the app that calls commit
      - Concurrent stock updates never lose an increment
    notes: [postgresql-transactions-and-isolation]
  - title: Migrations with Alembic
    goal: Evolve the inventory schema through reviewed, reversible migrations instead of create_all().
    learn:
      - alembic init, env.py, target_metadata and reading the database URL from the environment
      - Autogenerate, and what it cannot detect (renames, anonymous constraints, some type changes)
      - Naming conventions on MetaData so every constraint has a stable name
      - upgrade, downgrade, current, history and alembic check
      - Data migrations with op.execute, and expand-then-contract changes for live systems
    practice:
      - Generate the initial migration for Warehouse and Item and read every line before applying it
      - Rename a column and fix the autogenerated drop-and-add into alter_column
      - Run upgrade head, downgrade -1 and upgrade head again on a database with data in it
    doneWhen:
      - A fresh database reaches the current schema with a single alembic upgrade head
      - alembic check passes in CI, so models and migrations never drift
    notes: [database-migrations-with-alembic]
  - title: Testing
    goal: Test database code against a real Postgres, fast and isolated, locally and in CI.
    learn:
      - Why SQLite is not a substitute for Postgres in tests
      - pytest fixtures and scopes - session-scoped engine, function-scoped connection and session
      - The external transaction pattern with join_transaction_mode="create_savepoint"
      - Running Postgres for tests in Docker locally and as a service container in GitHub Actions
      - Testing migrations as well as models
    practice:
      - Write conftest.py fixtures that roll back every test, and prove it with a test that counts rows
      - Test that the CHECK constraint on quantity raises IntegrityError
      - Run the suite in GitHub Actions against a postgres:18 service container
    doneWhen:
      - Tests can run in any order and leave the database empty
      - The CI pipeline runs alembic upgrade head and the full test suite on every push
    notes: [testing-sqlalchemy-code-with-pytest-and-postgres]
resources:
  - title: SQLAlchemy unified tutorial
    url: https://docs.sqlalchemy.org/en/21/tutorial/index.html
    kind: tutorial
  - title: ORM quick start
    url: https://docs.sqlalchemy.org/en/21/orm/quickstart.html
    kind: docs
  - title: ORM querying guide
    url: https://docs.sqlalchemy.org/en/21/orm/queryguide/index.html
    kind: docs
  - title: What's new in SQLAlchemy 2.1
    url: https://docs.sqlalchemy.org/en/21/changelog/migration_21.html
    kind: docs
  - title: Alembic tutorial
    url: https://alembic.sqlalchemy.org/en/latest/tutorial.html
    kind: docs
  - title: Psycopg 3 documentation
    url: https://www.psycopg.org/psycopg3/docs/
    kind: docs
---

## Why I'm learning it

I write Python every day for ML work, but almost always against files, object stores or a feature store, rarely a relational database. To build proper backend services I need a solid way to talk to PostgreSQL from Python, and SQLAlchemy is the standard: it is both a SQL toolkit (Core) and an ORM, and the ORM sits on top of Core rather than hiding it. I used Hibernate in a Java and Spring job, so the ORM ideas (sessions, identity map, lazy loading) are familiar, but I want to learn the modern 2.x API properly rather than copying old `session.query()` snippets from the internet.

## How it fits with the rest of my stack

SQLAlchemy is the layer between Python code and PostgreSQL, using the psycopg 3 driver. Alembic, written by the same author, turns changes to my models into migration scripts. Locally, Postgres runs in Docker and Docker Compose; in CI, the same `postgres:18` image can run as a service container so that pytest exercises real Postgres behaviour. Everything I learn on the PostgreSQL roadmap (constraints, indexes, isolation levels) shows up here as model options, query options and session settings.

SQLAlchemy 2.1 is the current release. It needs Python 3.11 or newer, and `postgresql://` URLs now default to psycopg 3, though I always write the driver explicitly as `postgresql+psycopg://`.

## How to use this roadmap

Do the stages in order, after at least the first two PostgreSQL stages.

1. **Core basics**: two or three evenings. Skipping Core makes the ORM feel like magic.
2. **ORM models and relationships**: about a week.
3. **Querying with select**: about a week; this is where most real bugs (N+1, accidental lazy loads) live.
4. **Sessions and transactions in an app**: a few evenings, paired with the PostgreSQL transactions stage.
5. **Migrations with Alembic**: about a week. From this point on, schema changes go through migrations and `create_all()` is for tests only.
6. **Testing**: about a week, finishing with the suite running against a real PostgreSQL service in CI.

The notes share one small example domain (warehouses and items), so each stage builds on the last.
