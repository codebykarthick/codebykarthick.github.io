---
title: Database migrations with Alembic
summary: Setting up Alembic for the inventory API, reading the URL from the environment, autogenerating and reviewing migrations, naming conventions, and data migrations.
technologies: [sqlalchemy, python, postgresql]
topics: [migrations, best-practices]
updated: 2026-11-20
---

`Base.metadata.create_all()` creates missing tables, but it never changes an existing one. Once the inventory API project has real data, every schema change (a new column, a renamed column, an index) has to be applied to a live database in a controlled, repeatable way. Alembic does this with **migration scripts**: small Python files, each with an `upgrade()` and a `downgrade()`, chained together by revision ids and kept in version control next to the code.

Alembic records the current revision in a one-row table, `alembic_version`, in the database itself.

## Setting up

```sh
uv add alembic
uv run alembic init migrations
```

This creates, at the top level of the repository:

```text
alembic.ini              # configuration: script location, logging, a placeholder URL
migrations/
  env.py                 # runs the migrations: connects, configures, calls upgrade()
  script.py.mako         # template for new migration files
  versions/              # the migration scripts themselves
```

There is also a `pyproject` template (`alembic init --template pyproject migrations`) that moves most settings into `pyproject.toml`, leaving only the URL and logging in `alembic.ini`. Either works; the important edits are in `env.py`.

## Two edits to env.py

**1. Read the database URL from the environment.** The generated `alembic.ini` has `sqlalchemy.url = driver://user:pass@localhost/dbname`. Committing real credentials there is a mistake, and the URL differs between my laptop, CI and production anyway. Near the top of `env.py`, after `config = context.config`:

```python
import os

# configparser treats % as interpolation syntax, so escape it
config.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"].replace("%", "%%"))
```

Setting it on the config, rather than only creating an engine by hand, means both online mode and offline (`--sql`) mode pick it up. Using `os.environ[...]` rather than `.get()` makes a missing variable fail loudly instead of silently connecting to some default.

**2. Point autogenerate at the models.** Replace `target_metadata = None` with:

```python
from inventory_api.models import Base

target_metadata = Base.metadata
```

The project uses a src layout that uv installs into its virtual environment, so `uv run alembic` can import `inventory_api` from anywhere in the project. Every model module must be imported by the time this runs, or its tables will look like they were deleted.

## Naming conventions first

Postgres invents names for constraints that do not have one (`item_sku_key`, `item_warehouse_id_fkey`). Alembic needs to know a constraint's name to drop or alter it later, and autogenerate cannot reliably detect unnamed constraints at all. The fix is a naming convention on the `MetaData`, set **before** the first migration:

```python
from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

convention = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=convention)
```

Check constraints still need a short name of their own, because the `ck` pattern uses `%(constraint_name)s`: `CheckConstraint("quantity >= 0", name="quantity_non_negative")` becomes `ck_item_quantity_non_negative`.

## Autogenerate, then review

```sh
export DATABASE_URL=postgresql+psycopg://inventory:inventory@localhost:5432/inventory
uv run alembic revision --autogenerate -m "create warehouse and item"
```

Alembic compares `target_metadata` with the live database and writes the difference as a script. For the inventory models, the first migration contains `op.create_table("warehouse", ...)`, `op.create_table("item", ...)` and `op.create_index(op.f("ix_item_warehouse_id"), ...)`, with every constraint named by the convention.

Autogenerate detects added and removed tables and columns, nullability changes, column type changes, and basic changes to indexes, explicitly named unique constraints and foreign keys. It **cannot** detect:

- **Renamed tables or columns.** They appear as a drop plus an add, which would delete the data.
- **Anonymously named constraints**, hence the naming convention.
- Some special types, such as `Enum` on databases without a native enum type.

So the generated file is a draft. When I renamed `Item.description` to `Item.notes`, autogenerate produced:

```python
op.add_column("item", sa.Column("notes", sa.String(), nullable=True))
op.drop_column("item", "description")
```

which would silently throw away every description. The correct migration is:

```python
def upgrade() -> None:
    op.alter_column("item", "description", new_column_name="notes")


def downgrade() -> None:
    op.alter_column("item", "notes", new_column_name="description")
```

## Running migrations

```sh
uv run alembic upgrade head      # apply everything not yet applied
uv run alembic current           # which revision is the database at?
uv run alembic history           # the chain of revisions
uv run alembic downgrade -1      # undo the most recent migration
uv run alembic upgrade head --sql  # print the SQL instead of running it (offline mode)
uv run alembic check             # fail if the models have changes with no migration
```

Postgres has transactional DDL, and by default the generated `env.py` runs the whole `upgrade` command (every pending migration) in a single transaction: if any step fails, everything rolls back and `alembic_version` is unchanged.

`alembic check` is worth running in CI: it fails when someone changes a model and forgets to generate a migration.

## Data migrations

Not every migration changes the schema. To normalise existing SKUs to upper case, create an empty revision and write SQL:

```sh
uv run alembic revision -m "uppercase skus"
```

```python
def upgrade() -> None:
    op.execute(sa.text("UPDATE item SET sku = upper(sku) WHERE sku <> upper(sku)"))


def downgrade() -> None:
    pass  # irreversible: the original casing is gone
```

I write data migrations in SQL, not by importing my ORM models: the models describe the schema as it is **today**, while the migration must keep working against the schema as it was at that point in history.

## Changes on a live database

Some operations are unsafe on a busy table. `CREATE INDEX` blocks writes, and `CREATE INDEX CONCURRENTLY` cannot run in a transaction. Alembic has an escape hatch:

```python
def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.create_index(
            "ix_item_low_stock",
            "item",
            ["warehouse_id"],
            postgresql_where=sa.text("quantity < 10"),
            postgresql_concurrently=True,
        )
```

The same index must also be declared on the model (`Index("ix_item_low_stock", "warehouse_id", postgresql_where=text("quantity < 10"))` in `__table_args__`), otherwise `alembic check` reports it as something to remove.

For renames and type changes on a live system, the safe pattern is **expand and contract**: add the new column, deploy code that writes both, backfill, switch reads, and drop the old column in a later release.

## Gotchas

- **Never edit a migration that has already run somewhere else.** Write a new one instead.
- **Two branches, two heads.** If two people generate migrations from the same parent, `alembic heads` shows two heads and `upgrade head` refuses. `alembic merge -m "merge heads" heads` creates a revision that joins them.
- **Test downgrades.** Running `upgrade head`, `downgrade -1` and `upgrade head` against a database with data catches most broken scripts.
- **Do not mix `create_all()` and Alembic** outside tests. A database created by `create_all()` has no `alembic_version` row.
- **Server defaults and Postgres-specific details** sometimes need hand edits in the generated script; always read it before committing.

## Check yourself

1. Why does `env.py` escape `%` when setting `sqlalchemy.url` from an environment variable?
2. What would happen if I applied an autogenerated migration for a column rename without editing it?
3. Why should the naming convention be in place before the very first migration?
4. Why should data migrations avoid importing the application's ORM models?
5. What does `alembic check` protect against, and where should it run?

## Further reading

- [Alembic tutorial](https://alembic.sqlalchemy.org/en/latest/tutorial.html)
- [Auto generating migrations](https://alembic.sqlalchemy.org/en/latest/autogenerate.html)
- [The importance of naming constraints](https://alembic.sqlalchemy.org/en/latest/naming.html)
- [Generating SQL scripts (offline mode)](https://alembic.sqlalchemy.org/en/latest/offline.html)
- [Cookbook](https://alembic.sqlalchemy.org/en/latest/cookbook.html)
- [SQLAlchemy constraint naming conventions](https://docs.sqlalchemy.org/en/21/core/constraints.html)
