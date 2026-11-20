---
title: SQLAlchemy engine, connection and session
summary: What the engine, connection and session each do in SQLAlchemy 2.1, how transactions begin and end, and the session-per-request pattern for the inventory example.
technologies: [sqlalchemy, postgresql]
topics: [fundamentals, setup, transactions]
updated: 2026-11-20
---

SQLAlchemy has three objects I need to keep straight: the **engine**, the **connection** and the **session**. Most confusing bugs (connections left open, data that silently never commits, `DetachedInstanceError`) come from mixing up their lifetimes.

| Object | What it is | Lifetime |
| --- | --- | --- |
| `Engine` | connection pool plus dialect; knows how to reach the database | one per database per process |
| `Connection` | one checked-out DBAPI connection, with a transaction on it | one unit of work (Core) |
| `Session` | ORM unit of work and identity map, using a connection under the hood | one request or job |

## Installing

```sh
uv add sqlalchemy "psycopg[binary]"
```

SQLAlchemy 2.1 needs Python 3.11 or newer. `psycopg[binary]` ships a pre-compiled libpq, which is the easy option for development.

## The engine

```python
import os

from sqlalchemy import create_engine

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg://inventory:inventory@localhost:5432/inventory",
)

engine = create_engine(
    DATABASE_URL,
    echo=False,          # True logs every SQL statement, BEGIN, COMMIT and ROLLBACK
    pool_size=5,         # connections kept open in the pool
    max_overflow=10,     # extra connections allowed under burst load
    pool_pre_ping=True,  # test a connection before use, to survive database restarts
)
```

- The URL format is `dialect+driver://user:password@host:port/database`. Since 2.1, plain `postgresql://` also defaults to psycopg 3, but writing `+psycopg` makes the driver explicit and avoids surprises in older environments.
- Creating the engine does not connect; the first connection happens on first use.
- The engine is expensive and thread-safe. Create it **once** at module level or application start-up, never per request.
- Passwords with special characters such as `@` or `/` must be URL-encoded. `sqlalchemy.URL.create(...)` builds the URL from parts and avoids that problem.

## Connections and Core

Core works with SQL statements directly. `text()` wraps raw SQL, and values always go in as **bound parameters** (`:name`), never by string formatting:

```python
from sqlalchemy import text

with engine.connect() as conn:
    result = conn.execute(
        text("SELECT sku, quantity FROM item WHERE quantity < :threshold"),
        {"threshold": 10},
    )
    for row in result:
        print(row.sku, row.quantity)
```

Result objects have a few useful shapes:

```python
conn.execute(text("SELECT count(*) FROM item")).scalar_one()      # exactly one value
conn.execute(text("SELECT sku FROM item")).scalars().all()        # first column as a list
conn.execute(text("SELECT sku, quantity FROM item")).mappings().all()  # list of dict-like rows
```

## Two ways to manage a transaction

SQLAlchemy never auto-commits. A transaction begins implicitly on the first statement, and I choose one of two styles to end it.

**Commit as you go**, with `engine.connect()`:

```python
with engine.connect() as conn:
    conn.execute(
        text("INSERT INTO warehouse (name) VALUES (:name)"),
        [{"name": "London"}, {"name": "Leeds"}],  # a list runs executemany
    )
    conn.commit()
# leaving the block without commit() rolls back
```

**Begin once**, with `engine.begin()`:

```python
with engine.begin() as conn:
    conn.execute(text("UPDATE item SET quantity = quantity + 10 WHERE sku = :sku"), {"sku": "BOLT-M6"})
# commits if the block succeeds, rolls back if it raises
```

I prefer begin once: the transaction boundary is the indentation, and there is no way to forget the commit.

## The session

The ORM `Session` holds the objects I have loaded or added, tracks changes to them, and writes those changes in a **flush** before queries and on commit. It gets a connection from the engine when it first needs one.

`sessionmaker` is a factory configured once with the engine:

```python
from sqlalchemy.orm import sessionmaker

SessionLocal = sessionmaker(engine, expire_on_commit=False)
```

The same two transaction styles exist here. The begin-once form is the one to reach for:

```python
from decimal import Decimal

from inventory_api.models import Item, Warehouse

with SessionLocal.begin() as session:
    london = Warehouse(name="London")
    london.items.append(Item(sku="BOLT-M6", name="M6 bolt", quantity=500, price=Decimal("0.12")))
    session.add(london)
# commit happens here, then the session closes
```

The longer, equivalent form is `with Session(engine) as session, session.begin():`.

## Session per request

In a web API, each request gets its own session, and one place in the code decides whether to commit. With FastAPI, for example, a dependency does this:

```python
from collections.abc import Iterator

from sqlalchemy.orm import Session


def get_session() -> Iterator[Session]:
    with SessionLocal.begin() as session:
        yield session  # commits after the handler returns, rolls back if it raised
```

Service functions take a `Session` argument and never call `commit()` themselves. That keeps them composable (two service calls share one transaction) and easy to test.

## Expiring objects on commit

By default, `commit()` expires every loaded object, so the next attribute access reloads it from the database. That is safe while the session is open, but once the session is closed the object is **detached** and has nothing to reload from:

```python
with Session(engine) as session:
    warehouse = session.scalars(select(Warehouse)).first()
    session.commit()

warehouse.name  # DetachedInstanceError: the commit expired it, and the session is gone
```

Setting `expire_on_commit=False` on the sessionmaker keeps the loaded values usable after commit, which suits request-scoped sessions that return objects to a serialiser. The trade-off is that those values may be stale; better still, convert to plain data (for example Pydantic models) before the session closes.

## Gotchas

- **One engine, many sessions.** Creating an engine per request leaks pools and connections.
- **Never share a session between threads or concurrent requests.** Sessions are not thread-safe.
- **`flush` is not `commit`.** A flush sends SQL inside the transaction; nothing is permanent until commit.
- **Autoflush runs before every statement the session executes** (in 2.1 that includes Core statements too, not just ORM queries). If a pending object is invalid, the error appears at the next query, not at `add()`.
- **f-strings in SQL are SQL injection.** Use `:param` in `text()`, or the expression language.
- **Watch `max_connections`.** Postgres defaults to 100. Four app processes with `pool_size=5, max_overflow=10` can already use 60 at peak.

## Check yourself

1. Why should the engine be created once per process, and what does it hold?
2. What happens to the data if a `with engine.connect() as conn:` block ends without `conn.commit()`?
3. In the session-per-request dependency above, where is the commit, and what makes it roll back?
4. What does `expire_on_commit=False` change, and what problem does it solve?
5. What is the difference between a flush and a commit?

## Further reading

- [Unified tutorial, working with transactions and the DBAPI](https://docs.sqlalchemy.org/en/21/tutorial/dbapi_transactions.html)
- [Engine configuration](https://docs.sqlalchemy.org/en/21/core/engines.html)
- [Connection pooling](https://docs.sqlalchemy.org/en/21/core/pooling.html)
- [Session basics](https://docs.sqlalchemy.org/en/21/orm/session_basics.html)
- [Transactions and connection management](https://docs.sqlalchemy.org/en/21/orm/session_transaction.html)
- [PostgreSQL dialect and psycopg](https://docs.sqlalchemy.org/en/21/dialects/postgresql.html)
