---
title: Querying with select() in SQLAlchemy 2.x
summary: Filtering, joining, aggregating and bulk-updating inventory data with select(), plus lazy loading, the N+1 problem and how eager loading options fix it.
technologies: [sqlalchemy, python, postgresql]
topics: [querying, performance]
updated: 2026-11-20
---

In SQLAlchemy 2.x, Core and the ORM share one query language: build a statement with `select()`, then run it with `session.scalars()` or `session.execute()`. The old `session.query(Item).filter(...)` API is legacy; most blog posts still use it, so I translate them as I read rather than copying them.

All examples assume the `Warehouse` and `Item` models from the inventory API project and an open `session`.

## Two ways to run a select

```python
from sqlalchemy import select

# ORM objects: scalars() unwraps the first column of each row
items = session.scalars(select(Item).where(Item.quantity < 10)).all()

# Rows of columns: execute() returns Row tuples with named access
rows = session.execute(select(Item.sku, Item.quantity)).all()
for row in rows:
    print(row.sku, row.quantity)
```

Rule of thumb: **`scalars()` when selecting one entity or one column, `execute()` when selecting several things**. Without `scalars()`, `select(Item)` gives one-element rows like `(Item,)`, which is a common source of confusion.

Fetching one result:

| Call | Zero rows | More than one row |
| --- | --- | --- |
| `.one()` | raises `NoResultFound` | raises `MultipleResultsFound` |
| `.one_or_none()` | returns `None` | raises |
| `.first()` | returns `None` | returns the first, silently |

`session.get(Item, 42)` fetches by primary key and checks the identity map first, so it may not query at all. `session.scalar(stmt)` is shorthand for the first column of the first row, which suits counts:

```python
from sqlalchemy import func

total = session.scalar(select(func.count()).select_from(Item))
```

## Filtering, ordering and paging

```python
stmt = (
    select(Item)
    .where(Item.quantity < 10, Item.name.ilike("%bolt%"))  # several conditions are ANDed
    .order_by(Item.quantity, Item.sku)
    .limit(20)
    .offset(40)
)
low_stock_bolts = session.scalars(stmt).all()
```

Useful column operators: `==`, `!=`, `<`, `.in_([...])`, `.is_(None)`, `.like()`, `.ilike()`, `.between()`. Combine with `or_()`, `and_()` and `not_()` from `sqlalchemy`. Every value is sent as a bound parameter, so this is safe from injection.

Statements are immutable and composable, which makes optional filters easy:

```python
def list_items(session: Session, warehouse_id: int | None = None, max_quantity: int | None = None):
    stmt = select(Item).order_by(Item.sku)
    if warehouse_id is not None:
        stmt = stmt.where(Item.warehouse_id == warehouse_id)
    if max_quantity is not None:
        stmt = stmt.where(Item.quantity <= max_quantity)
    return session.scalars(stmt).all()
```

## Joins and aggregates

Joining along a relationship lets SQLAlchemy work out the `ON` clause from the foreign key:

```python
stmt = (
    select(Item)
    .join(Item.warehouse)
    .where(Warehouse.name == "London", Item.quantity < 2)
)
```

Stock value per warehouse, returning rows rather than objects:

```python
stmt = (
    select(
        Warehouse.name,
        func.count(Item.id).label("item_count"),
        func.sum(Item.quantity * Item.price).label("stock_value"),
    )
    .join(Warehouse.items)
    .group_by(Warehouse.id, Warehouse.name)
    .order_by(func.sum(Item.quantity * Item.price).desc())
)
for name, item_count, stock_value in session.execute(stmt):
    print(name, item_count, stock_value)  # stock_value is a Decimal
```

`.join()` is an inner join, so warehouses with no items disappear; `.outerjoin()` keeps them (with a count of 0). For "warehouses that have an empty item", `.where(Warehouse.items.any(Item.quantity == 0))` renders an `EXISTS` subquery without duplicating rows.

## Lazy loading and the N+1 problem

By default, relationships are **lazy**: `warehouse.items` is loaded with a separate query the first time I touch it. That is convenient and a performance trap:

```python
for warehouse in session.scalars(select(Warehouse)):
    print(warehouse.name, len(warehouse.items))  # one extra query per warehouse
```

With five warehouses I counted six queries: one for the warehouses, plus one per warehouse. With 500 warehouses it is 501. This is the N+1 problem, and `echo=True` on the engine makes it very visible.

## Eager loading options

Loader options tell the query to fetch related objects up front:

```python
from sqlalchemy.orm import joinedload, raiseload, selectinload

# Collections: one extra query with WHERE warehouse_id IN (...), 2 queries in total
stmt = select(Warehouse).options(selectinload(Warehouse.items))
warehouses = session.scalars(stmt).all()

# Many-to-one: a LEFT OUTER JOIN in the same query, 1 query in total
stmt = select(Item).options(joinedload(Item.warehouse))
items = session.scalars(stmt).all()
```

- **`selectinload`** is the documented best default for collections: the main query is untouched and the related rows come in one additional `SELECT ... WHERE ... IN`.
- **`joinedload`** suits many-to-one relationships, where the join adds columns but not rows.
- `joinedload` on a **collection** multiplies parent rows (one per child), so SQLAlchemy requires `.unique()` on the result: `session.scalars(stmt).unique().all()`. Forgetting it raises `InvalidRequestError`.

To make accidental lazy loads impossible, use **`raiseload`**: per query with `.options(raiseload("*"))`, or for a relationship with `relationship(..., lazy="raise")`. Any unplanned access then raises immediately instead of quietly adding queries. In an API, where objects are serialised after the query, I would rather find out in a test.

## Bulk UPDATE, DELETE and upserts

Changing objects one at a time loads every row into Python. For set-based changes, run the statement directly:

```python
from sqlalchemy import delete, update

session.execute(update(Item).where(Item.quantity == 0).values(quantity=1))
session.execute(delete(Item).where(Item.sku.like("DISCONTINUED-%")))
```

Arithmetic on the column (`values(quantity=Item.quantity + 10)`) runs inside Postgres, which is also how to avoid lost updates.

PostgreSQL's `INSERT ... ON CONFLICT` comes from the dialect's own `insert`:

```python
from sqlalchemy.dialects.postgresql import insert

stmt = insert(Item).values(
    warehouse_id=1, sku="BOLT-M6", name="M6 bolt", quantity=10, price=Decimal("0.12")
)
stmt = stmt.on_conflict_do_update(
    index_elements=[Item.sku],
    set_={"quantity": Item.quantity + stmt.excluded.quantity},
).returning(Item.quantity)
new_quantity = session.execute(stmt).scalar_one()
```

## Gotchas

- **`session.execute(select(Item))` returns rows, not items.** Use `scalars()` for entities.
- **`.first()` hides bugs.** If exactly one row is expected, `.one()` or `.one_or_none()` will tell me when that assumption breaks.
- **`limit()` without `order_by()` returns arbitrary rows.** Postgres guarantees no order without `ORDER BY`, so pagination must be ordered by something unique.
- **Lazy loading after the session closes fails** with `DetachedInstanceError`. Eager-load what the response needs before returning.
- **Bulk `update()` and `delete()` bypass ORM cascades.** A bulk delete of warehouses does not apply `delete-orphan` to their items in Python; only database-level rules (`ON DELETE CASCADE`, `CHECK`) still apply.

## Check yourself

1. When do I use `session.scalars()` and when `session.execute()`?
2. Why does listing warehouses and their items produce N+1 queries by default, and what is the usual fix?
3. Why does `joinedload` on a collection require `.unique()`, and why does `selectinload` not?
4. What does `raiseload` do, and why is it useful in an API codebase?
5. How would I rewrite `session.query(Item).filter_by(sku="BOLT-M6").first()` in 2.x style, and would I keep `.first()`?

## Further reading

- [Unified tutorial, selecting data](https://docs.sqlalchemy.org/en/21/tutorial/data_select.html)
- [ORM querying guide](https://docs.sqlalchemy.org/en/21/orm/queryguide/index.html)
- [Writing SELECT statements for ORM mapped classes](https://docs.sqlalchemy.org/en/21/orm/queryguide/select.html)
- [Relationship loading techniques](https://docs.sqlalchemy.org/en/21/orm/queryguide/relationships.html)
- [PostgreSQL dialect, INSERT ... ON CONFLICT](https://docs.sqlalchemy.org/en/21/dialects/postgresql.html)
