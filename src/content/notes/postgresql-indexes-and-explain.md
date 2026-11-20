---
title: PostgreSQL indexes and EXPLAIN
summary: How B-tree, composite, partial and expression indexes work in PostgreSQL 18, and how to read EXPLAIN ANALYZE to decide which ones the inventory schema needs.
technologies: [postgresql]
topics: [performance, querying, debugging]
updated: 2026-11-20
---

An index is a separate, sorted data structure that lets Postgres find rows without reading the whole table. Indexes are not free: each one takes disk space and slows down every `INSERT`, `UPDATE` and `DELETE` on the table. The goal is the smallest set of indexes that serves the queries the application really runs, and `EXPLAIN ANALYZE` is how I find out what those queries need.

## Generating realistic data first

Plans on a ten-row table are meaningless, because Postgres will (correctly) just read the whole thing. So I load the inventory schema with generated data:

```sql
INSERT INTO warehouse (name)
SELECT 'Warehouse ' || g FROM generate_series(1, 50) AS g;

INSERT INTO item (warehouse_id, sku, name, quantity, price, created_at)
SELECT 1 + (g % 50), 'SKU-' || g, 'Item ' || g,
       (g * 7919) % 1000,
       round((random() * 100)::numeric, 2),
       now() - (g % 365) * interval '1 day'
FROM generate_series(1, 200000) AS g;

ANALYZE;  -- refresh planner statistics after a bulk load
```

## Reading a plan

`EXPLAIN` shows the plan the planner chose with its estimates. `EXPLAIN ANALYZE` also runs the query and adds what actually happened. In Postgres 18, `ANALYZE` includes buffer counts by default.

The low-stock query for one warehouse, with no index beyond the primary key and the unique `sku`:

```sql
EXPLAIN ANALYZE SELECT * FROM item WHERE warehouse_id = 7 AND quantity < 5;
```

```text
Gather  (cost=1000.00..4819.51 rows=18 width=79) (actual time=4.604..5.477 rows=0.00 loops=1)
  Workers Planned: 1
  ->  Parallel Seq Scan on item  (cost=0.00..3817.71 rows=11 width=79) (actual time=3.281..3.281 rows=0.00 loops=2)
        Filter: ((quantity < 5) AND (warehouse_id = 7))
        Rows Removed by Filter: 100000
        Buffers: shared hit=2053
Execution Time: 5.486 ms
```

How I read it:

- **Read from the innermost node outwards.** Each `->` is a child that feeds its parent.
- **cost=start..total** is in arbitrary planner units, useful only for comparing plans.
- **rows** in the estimate versus **actual rows** is the most important comparison. A big mismatch means bad statistics or a condition the planner cannot estimate, and that is usually why it chose a poor plan. (Postgres 18 shows actual rows as an average with two decimals.)
- **loops**: actual numbers are per loop, so multiply by `loops` for the total.
- **Rows Removed by Filter: 100000** across two workers means it read all 200,000 rows to return none. That is the signal an index could help.
- **Buffers: shared hit** counts 8 kB pages found in Postgres's cache; `read` means pages fetched from the operating system or disk.

## B-tree indexes and scan types

The default index type is a B-tree, which supports `=`, `<`, `>`, `BETWEEN`, `IN`, `IS NULL` and sorting.

```sql
CREATE INDEX item_warehouse_id_idx ON item (warehouse_id);
```

After this, the same query becomes a **Bitmap Index Scan** feeding a **Bitmap Heap Scan**: it collects the matching row locations from the index (4,000 rows for warehouse 7), then reads the table pages in physical order and applies `quantity < 5` as a filter. Execution time dropped from 5.5 ms to 1.4 ms, but it still removed 4,000 rows by filter.

The scan types to recognise:

| Node | Meaning |
| --- | --- |
| Seq Scan | read every page of the table |
| Index Scan | walk the index, then fetch each matching row from the table |
| Index Only Scan | answer from the index alone (all needed columns are in it, and pages are marked all-visible by vacuum) |
| Bitmap Index Scan + Bitmap Heap Scan | collect many matches, then read table pages in order; good for medium-sized result sets |

## Composite indexes and column order

```sql
CREATE INDEX item_warehouse_quantity_idx ON item (warehouse_id, quantity);
```

Now both conditions are an `Index Cond`, the plan reads two buffers, and execution takes 0.02 ms. A composite index is sorted by the first column, then by the second within each value of the first, like a phone book sorted by surname then first name. The rule of thumb: **equality columns first, then the range or sort column**.

This index also serves `WHERE warehouse_id = 7` on its own, so the single-column `item_warehouse_id_idx` is now redundant and can be dropped.

Traditionally a composite index was useless for a query on only its second column. Postgres 18 adds **B-tree skip scan**: for `WHERE quantity < 5` the plan used `item_warehouse_quantity_idx` with `Index Searches: 51`, one search per distinct `warehouse_id`. That works because there are only 50 warehouses; with thousands of distinct leading values it would not pay off. I still design with the leading column first and treat skip scan as a bonus.

Indexes also remove sorts. For "the 20 most recent items in a warehouse":

```sql
CREATE INDEX item_warehouse_created_idx ON item (warehouse_id, created_at DESC);

EXPLAIN ANALYZE
SELECT sku FROM item WHERE warehouse_id = 7 ORDER BY created_at DESC LIMIT 20;
```

Without the index the plan was Bitmap Heap Scan, then Sort (top-N heapsort over 4,000 rows), then Limit, in 1.7 ms. With it, the plan is a plain `Index Scan` under `Limit` that stops after 20 rows, in 0.04 ms.

## Partial and expression indexes

A **partial index** only contains rows matching a `WHERE` clause. If the API constantly asks for low-stock items, and they are a small fraction of the table:

```sql
CREATE INDEX item_low_stock_idx ON item (warehouse_id) WHERE quantity < 10;
```

The planner uses it only when the query's condition implies the index's condition, so `quantity < 10` or `quantity < 5` qualifies, but `quantity < 20` does not.

An **expression index** indexes the result of an expression. A case-insensitive SKU lookup does a sequential scan, even with the unique index on `sku`, until the expression itself is indexed:

```sql
CREATE INDEX item_sku_lower_idx ON item (lower(sku));
SELECT * FROM item WHERE lower(sku) = 'sku-42';  -- now uses the index
```

For `jsonb` columns, a **GIN** index (`USING gin (attributes)`) supports containment queries such as `attributes @> '{"colour": "red"}'`.

## Gotchas

- **Foreign keys are not indexed automatically.** `PRIMARY KEY` and `UNIQUE` create indexes; `REFERENCES` does not. Without an index on `item.warehouse_id`, deleting a warehouse scans the whole `item` table to check for children.
- **EXPLAIN ANALYZE executes the statement.** For `UPDATE` or `DELETE`, wrap it: `BEGIN; EXPLAIN ANALYZE UPDATE ...; ROLLBACK;`.
- **A sequential scan is not always wrong.** If a query returns a large share of the table, reading it sequentially is cheaper than thousands of random index lookups.
- **Functions and casts on the column hide it from the index.** `WHERE lower(sku) = ...` or `WHERE created_at::date = ...` cannot use a plain index on that column.
- **`CREATE INDEX` blocks writes to the table.** On a live table use `CREATE INDEX CONCURRENTLY`, which cannot run inside a transaction block (this matters for Alembic migrations).
- **Stale statistics cause bad plans.** Autovacuum normally runs `ANALYZE`, but after a bulk load I run it by hand.

## Check yourself

1. In a plan, what does a large gap between estimated `rows` and actual `rows` tell me, and what is the first thing to try?
2. Why does an index on `(warehouse_id, quantity)` make a separate index on `(warehouse_id)` redundant, but not one on `(quantity)` in general?
3. When would the planner use `item_low_stock_idx`, and when would it ignore it?
4. Why would an index on `item.warehouse_id` be worth having even if the API never filtered items by warehouse?
5. How do I safely see the plan of a `DELETE` without deleting anything?

## Further reading

- [Indexes](https://www.postgresql.org/docs/current/indexes.html)
- [Multicolumn indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html)
- [Partial indexes](https://www.postgresql.org/docs/current/indexes-partial.html)
- [Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)
- [CREATE INDEX, including CONCURRENTLY](https://www.postgresql.org/docs/current/sql-createindex.html)
- [Use the index, Luke](https://use-the-index-luke.com/)
