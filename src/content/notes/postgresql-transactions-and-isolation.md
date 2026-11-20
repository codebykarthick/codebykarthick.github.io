---
title: PostgreSQL transactions, isolation and locking
summary: MVCC, the three isolation levels Postgres really has, row locks with FOR UPDATE and SKIP LOCKED, and what vacuum and idle transactions have to do with it.
technologies: [postgresql, sqlalchemy, python]
topics: [transactions, best-practices, performance]
updated: 2026-11-20
---

The inventory API project changes stock levels from concurrent requests. If two requests each dispatch one bolt at the same moment, the quantity must drop by two, not one. These notes are about how Postgres makes that possible and which tool to use for which job.

## MVCC in one paragraph

Postgres uses multi-version concurrency control. An `UPDATE` does not overwrite a row in place: it writes a new version of the row and marks the old one as dead from that transaction onwards. Each statement (or transaction, depending on isolation level) reads from a **snapshot**, so it sees only versions committed before the snapshot was taken. The result: **readers never block writers and writers never block readers**. Writers do block other writers that touch the same row, because each row version can only have one pending update.

The cost of MVCC is dead row versions, which `VACUUM` cleans up later (more on that below).

## Isolation levels

| Level | Snapshot taken | What can still go wrong |
| --- | --- | --- |
| READ COMMITTED (default) | per statement | each statement can see different committed data; lost updates in read-modify-write code |
| REPEATABLE READ | at the first statement of the transaction | concurrent update of the same row raises a serialisation failure; write skew is possible |
| SERIALIZABLE | at the first statement, plus dependency tracking | nothing, but any transaction may fail with a serialisation failure and must be retried |

`READ UNCOMMITTED` is accepted but behaves exactly like `READ COMMITTED`: Postgres never shows uncommitted data. Coming from Oracle: Oracle's default is also read committed, and what Oracle calls `SERIALIZABLE` is snapshot isolation, which corresponds to Postgres's `REPEATABLE READ`. Postgres's `SERIALIZABLE` is stronger and catches anomalies such as write skew.

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ;
-- ...
COMMIT;
```

## The lost update, and three fixes

The classic bug, which I reproduced with ten threads each dispatching one bolt ten times (expected result 1000 to 900):

```python
# Read, modify in Python, write back: final quantity was 980, not 900
item = session.scalars(select(Item).where(Item.sku == sku)).one()
item.quantity -= amount
```

Two transactions read 1000, both write 999, and one decrement disappears. `READ COMMITTED` permits this because each statement is fine on its own.

**Fix 1: let the database do the arithmetic.** A single atomic `UPDATE` is correct under `READ COMMITTED`: the second writer waits for the first to commit, then re-checks its `WHERE` clause against the new row version.

```sql
UPDATE item
SET quantity = quantity - 1
WHERE sku = 'BOLT-M6' AND quantity >= 1
RETURNING quantity;
```

Zero rows returned means "not enough stock". This is the simplest and fastest option when the logic fits in SQL.

**Fix 2: lock the row before reading it.** `SELECT ... FOR UPDATE` takes a row lock, so a second transaction doing the same blocks until the first commits, then reads the fresh value.

```sql
BEGIN;
SELECT quantity FROM item WHERE sku = 'BOLT-M6' FOR UPDATE;
-- application logic decides the new quantity
UPDATE item SET quantity = 999 WHERE sku = 'BOLT-M6';
COMMIT;
```

In SQLAlchemy this is `select(Item).where(...).with_for_update()`. Use it when the decision needs Python logic between the read and the write.

**Fix 3: raise the isolation level and retry.** Under `REPEATABLE READ`, the second writer gets `ERROR: could not serialize access due to concurrent update` (SQLSTATE `40001`). The whole transaction must be retried from the start:

```python
import psycopg
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

RepeatableReadSession = sessionmaker(
    engine.execution_options(isolation_level="REPEATABLE READ")
)
RETRYABLE = (psycopg.errors.SerializationFailure, psycopg.errors.DeadlockDetected)


def dispatch_stock(sku: str, amount: int, attempts: int = 5) -> None:
    for attempt in range(1, attempts + 1):
        try:
            with RepeatableReadSession.begin() as session:
                item = session.scalars(select(Item).where(Item.sku == sku)).one()
                if item.quantity < amount:
                    raise ValueError(f"not enough {sku} in stock")
                item.quantity -= amount
            return
        except OperationalError as exc:
            if isinstance(exc.orig, RETRYABLE) and attempt < attempts:
                continue
            raise
```

SQLAlchemy wraps driver errors, so the psycopg exception is on `exc.orig`. In my test, ten threads hammering one row caused 64 retries and some calls still ran out of attempts. Retries suit low-contention workloads; for a single hot row, fixes 1 or 2 are better.

## SKIP LOCKED and NOWAIT

`FOR UPDATE SKIP LOCKED` skips rows another transaction has locked instead of waiting. That turns a table into a safe work queue for several workers:

```sql
CREATE TABLE stock_movement_job (
    id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payload jsonb NOT NULL,
    done_at timestamptz
);

BEGIN;
SELECT id, payload
FROM stock_movement_job
WHERE done_at IS NULL
ORDER BY id
LIMIT 10
FOR UPDATE SKIP LOCKED;
-- process the batch, then
UPDATE stock_movement_job SET done_at = now() WHERE id = ANY('{1,2,3}');
COMMIT;
```

Each worker gets a different batch, and if a worker crashes its transaction rolls back and the rows become available again. `FOR UPDATE NOWAIT` instead raises an error immediately if the row is locked, which is useful when a user action should fail fast rather than queue.

## Deadlocks

If transaction A locks row 1 then wants row 2, while B holds row 2 and wants row 1, neither can proceed. Postgres detects this after `deadlock_timeout` (1 second by default) and aborts one of them with SQLSTATE `40P01`. The fix is to **always lock rows in a consistent order**, for example by sorting item ids before updating several items in one transaction.

## Vacuum and idle transactions

Dead row versions from updates and deletes stay in the table until `VACUUM` marks their space as reusable. Autovacuum does this in the background and also runs `ANALYZE`; I leave it on. What breaks it is a **long-running or idle-in-transaction session**: vacuum cannot remove dead versions that an older, still-open transaction might need to see, so tables bloat. `pg_stat_activity` shows them:

```sql
SELECT pid, state, now() - xact_start AS xact_age, query
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY xact_age DESC NULLS LAST;

SELECT pg_cancel_backend(12345);     -- cancel the running query
SELECT pg_terminate_backend(12345);  -- close the whole connection
```

Setting `idle_in_transaction_session_timeout` on the app role is a cheap safety net.

## Gotchas

- **Every statement is in a transaction.** Outside `BEGIN`, each statement auto-commits. psycopg and SQLAlchemy open a transaction implicitly, so forgetting to commit or roll back leaves the connection idle in transaction.
- **After an error, the transaction is aborted.** Every later statement fails with "current transaction is aborted" until `ROLLBACK`.
- **Serialisation failures can happen at `COMMIT`** under `SERIALIZABLE`, so the retry must wrap the whole transaction, not one statement.
- **Do not hold transactions open across slow work.** No HTTP calls or model inference between `BEGIN` and `COMMIT`.
- **`FOR UPDATE` in a join locks rows in every joined table** unless I write `FOR UPDATE OF item`.

## Check yourself

1. Why does the read-modify-write pattern lose updates under `READ COMMITTED`, but a single `UPDATE ... SET quantity = quantity - 1` does not?
2. Which isolation level corresponds to Oracle's `SERIALIZABLE`, and what extra anomaly does Postgres's `SERIALIZABLE` prevent?
3. When would I choose `SKIP LOCKED` over `NOWAIT`, and over a plain `FOR UPDATE`?
4. What two SQLSTATE codes should a retry loop catch, and where does SQLAlchemy put the original driver exception?
5. Why does an idle-in-transaction connection cause table bloat?

## Further reading

- [Concurrency control (MVCC)](https://www.postgresql.org/docs/current/mvcc.html)
- [Transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- [Explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- [SELECT, the locking clause](https://www.postgresql.org/docs/current/sql-select.html)
- [Routine vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html)
- [SQLAlchemy, setting transaction isolation levels](https://docs.sqlalchemy.org/en/21/orm/session_transaction.html)
