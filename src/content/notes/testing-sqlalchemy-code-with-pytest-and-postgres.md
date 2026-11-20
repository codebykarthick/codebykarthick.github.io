---
title: Testing SQLAlchemy code with pytest and Postgres
summary: Fast, isolated database tests against real PostgreSQL, using pytest fixtures, Alembic migrations and a rolled-back transaction per test with join_transaction_mode.
technologies: [sqlalchemy, postgresql]
topics: [testing, transactions]
updated: 2026-11-20
---

Database code is only worth testing against the database it will run on. These notes set up a test suite for the inventory example so that every test runs against real PostgreSQL 18, starts with empty tables, and cleans up after itself in milliseconds, without truncating or recreating anything.

## Why not SQLite?

It is tempting to point tests at in-memory SQLite because it needs no server. It hides exactly the bugs I most want to catch:

- Foreign keys, and so `ON DELETE CASCADE`, are not enforced unless switched on for every connection with `PRAGMA foreign_keys`.
- There is no real timestamp type, let alone `timestamptz`; datetimes are stored as strings.
- `Numeric` values are stored as floating point, so `Decimal` precision bugs are invisible.
- `SELECT ... FOR UPDATE`, `ON CONFLICT` from the PostgreSQL dialect, `jsonb` and partial indexes do not exist.
- Isolation and locking behaviour is completely different.

Postgres in Docker starts in a couple of seconds, so there is no good reason not to use it.

## The database for tests

Tests use their own database, `inventory_test`, never the development one. With the Compose setup from the Docker notes:

```sh
docker compose up -d db
docker compose exec db createdb -U inventory inventory_test
export DATABASE_URL=postgresql+psycopg://inventory:inventory@localhost:5432/inventory_test
uv add --dev pytest
```

In GitHub Actions, a `postgres:18` service container creates `inventory_test` itself and the workflow sets the same `DATABASE_URL`, then runs `uv run alembic upgrade head` before `uv run pytest`. The GitHub Actions roadmap's service-container note shows the same pattern for a Go project.

## The pattern: one transaction per test, rolled back

The idea, straight from the SQLAlchemy documentation on "joining a Session into an external transaction":

1. Open a connection and `BEGIN` a transaction on it.
2. Give the test a `Session` bound to that connection.
3. Let the test do anything, including calling `session.commit()`.
4. Roll back the outer transaction at the end. Nothing the test did ever becomes visible.

Step 3 is the clever part. With `join_transaction_mode="create_savepoint"`, the session never commits or rolls back the outer transaction. Instead, it runs inside a `SAVEPOINT`: `session.commit()` releases the savepoint and `session.rollback()` rolls back to it, so code under test behaves normally while the outer transaction stays in the fixture's control.

## The conftest.py fixtures

```python
# tests/conftest.py
import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Connection, Engine, create_engine, make_url
from sqlalchemy.orm import Session

DATABASE_URL = os.environ["DATABASE_URL"]
PROJECT_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    if not make_url(DATABASE_URL).database.endswith("_test"):
        pytest.exit("DATABASE_URL must point at a *_test database", returncode=1)

    # Bring the schema to the latest migration (a no-op if CI already did it)
    command.upgrade(Config(PROJECT_ROOT / "alembic.ini"), "head")

    engine = create_engine(DATABASE_URL)
    yield engine
    engine.dispose()


@pytest.fixture
def connection(engine: Engine) -> Iterator[Connection]:
    with engine.connect() as connection:
        transaction = connection.begin()
        yield connection
        transaction.rollback()


@pytest.fixture
def session(connection: Connection) -> Iterator[Session]:
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        yield session
```

Why it is built this way:

- **Fixture scopes.** The engine (and its pool) is created once per test run (`scope="session"`, meaning the pytest session, not the SQLAlchemy one). The connection and ORM session are per test (the default function scope).
- **Migrations, not `create_all()`.** The schema comes from `alembic upgrade head`, so every test run also proves the migrations produce a working schema. Running it from the fixture means a plain `uv run pytest` works locally, and when CI has already migrated, the call does nothing.
- **The `_test` guard.** Tests read the same `DATABASE_URL` variable as the app, so the guard stops me from accidentally running the suite against my development data.
- **Teardown order.** The session closes first (end of its `with` block), then the outer transaction rolls back, then the connection returns to the pool.

## Writing tests

Service functions take a `Session` argument (see the engine and session note), so tests simply pass the fixture in:

```python
# tests/test_stock.py
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from inventory_api.models import Item, Warehouse
from inventory_api.services import receive_stock


@pytest.fixture
def london(session: Session) -> Warehouse:
    warehouse = Warehouse(
        name="London",
        items=[Item(sku="BOLT-M6", name="M6 bolt", quantity=5, price=Decimal("0.12"))],
    )
    session.add(warehouse)
    session.commit()  # releases a SAVEPOINT; the outer transaction is still open
    return warehouse


def test_receive_stock_adds_to_quantity(session: Session, london: Warehouse) -> None:
    item = receive_stock(session, "BOLT-M6", 10)
    session.commit()

    assert item.quantity == 15


def test_quantity_cannot_go_negative(session: Session, london: Warehouse) -> None:
    london.items[0].quantity = -1

    with pytest.raises(IntegrityError, match="ck_item_quantity_non_negative"):
        session.flush()

    session.rollback()  # back to the last savepoint; the fixture data survives
    assert session.scalar(select(func.count()).select_from(Item)) == 1


def test_each_test_starts_empty(session: Session) -> None:
    assert session.scalar(select(func.count()).select_from(Warehouse)) == 0
```

The constraint test matches on the constraint's name, which is predictable thanks to the naming convention on the models. The last test is a canary: if isolation ever breaks, it fails whatever order the tests run in.

For HTTP-level tests, the same idea applies: override the app's session dependency so that request handlers receive the test's `session`.

## Gotchas

- **Commit in data fixtures, do not just flush.** I first wrote the `london` fixture with `session.flush()`. Then `session.rollback()` in the constraint test rolled back to the savepoint started *before* the fixture ran, and the warehouse vanished. `session.commit()` releases that savepoint, so later rollbacks only undo the test's own work.
- **Concurrency tests need real commits.** Everything here happens on one connection. To test `SELECT ... FOR UPDATE` with two concurrent sessions, use a separate fixture that commits for real and truncates the tables afterwards, and mark those tests so they can be run separately.
- **Do not use `create_all()` in one place and Alembic in another.** If tests build the schema differently from production, a broken migration passes CI.
- **Server-side defaults are frozen per transaction.** `now()` returns the transaction's start time, so every `created_at` within one test is identical. Tests about ordering by time should set timestamps explicitly.
- **Keep fixtures function-scoped** for anything that touches the database. A session-scoped `session` fixture would leak state between tests.

## Check yourself

1. What does `join_transaction_mode="create_savepoint"` change about what `session.commit()` and `session.rollback()` do?
2. Why did the `london` fixture lose its data when it used `flush()` instead of `commit()`?
3. Why does the conftest run Alembic migrations instead of `Base.metadata.create_all()`?
4. Which kinds of test cannot use the rolled-back transaction pattern, and what would I do instead?
5. Name three behaviours of the inventory schema that a SQLite-based test suite would not catch.

## Further reading

- [Joining a session into an external transaction](https://docs.sqlalchemy.org/en/21/orm/session_transaction.html)
- [pytest fixtures](https://docs.pytest.org/en/stable/how-to/fixtures.html)
- [Alembic API, running commands from Python](https://alembic.sqlalchemy.org/en/latest/api/commands.html)
- [Official postgres Docker image](https://hub.docker.com/_/postgres)
