---
title: PostgreSQL indexes and EXPLAIN
summary: How B-tree, composite and partial indexes work in PostgreSQL 18, how to read EXPLAIN ANALYZE, and which indexes a job-processing schema actually needs.
technologies: [postgresql, go]
topics: [performance, querying, debugging]
updated: 2026-11-20
---

An index is a separate, sorted structure that lets Postgres find rows without reading the whole table. Each one costs space and slows every write, and a jobs table is written constantly, so the goal is the smallest set of indexes that serves the queries the application really runs. The examples use the job-processing sketch from the essentials note.

## Generating realistic data first

Plans on a ten-row table are meaningless, so I load 200,000 jobs over 50 tenants, mostly finished, with 1% queued:

```sql
INSERT INTO tenants (id, name)
SELECT 'tenant-' || g, 'Tenant ' || g FROM generate_series(1, 50) AS g;

SELECT setseed(0.42);  -- repeatable random()
INSERT INTO jobs (tenant_id, idempotency_key, request_hash, document_ref,
                  rule_set_version, status, created_at, next_attempt_at)
SELECT 'tenant-' || (1 + floor(random() * 50)::int),
       'key-' || g, md5(g::text), 'docs/' || g || '.pdf', 'rules-v3',
       CASE WHEN g % 100 = 0 THEN 'queued'
            WHEN g % 100 = 1 THEN 'running'
            WHEN g % 100 < 5 THEN 'failed'
            ELSE 'succeeded' END,
       now() - g * interval '1 minute',
       now() - g * interval '1 minute'
FROM generate_series(1, 200000) AS g;

ANALYZE;  -- refresh planner statistics after a bulk load
```

## Reading a plan

`EXPLAIN` shows the chosen plan with estimates; `EXPLAIN ANALYZE` also runs the query and reports what happened. In Postgres 18 it includes buffer counts by default, so it is equivalent to `EXPLAIN (ANALYZE, BUFFERS)`. The query is a tenant's most recent failed jobs:

```sql
EXPLAIN ANALYZE
SELECT id, status, created_at FROM jobs
WHERE tenant_id = 'tenant-7' AND status = 'failed'
ORDER BY created_at DESC
LIMIT 20;
```

```text
Limit  (cost=4806.17..4806.22 rows=20 width=33) (actual time=3.279..3.281 rows=20.00 loops=1)
  Buffers: shared hit=2730
  ->  Sort  (cost=4806.17..4806.48 rows=126 width=33) (actual time=3.278..3.279 rows=20.00 loops=1)
        Sort Key: created_at DESC
        Sort Method: top-N heapsort  Memory: 26kB
        ->  Bitmap Heap Scan on jobs  (cost=176.35..4802.81 rows=126 width=33) (actual time=0.615..3.255 rows=104.00 loops=1)
              Recheck Cond: (tenant_id = 'tenant-7'::text)
              Filter: (status = 'failed'::text)
              Rows Removed by Filter: 3958
              Heap Blocks: exact=2691
              ->  Bitmap Index Scan on jobs_tenant_key_uniq  (cost=0.00..176.32 rows=4253 width=0) (actual time=0.411..0.411 rows=4062.00 loops=1)
                    Index Cond: (tenant_id = 'tenant-7'::text)
                    Index Searches: 1
Execution Time: 3.326 ms
```

How I read it:

- **Innermost node first.** Each `->` is a child feeding its parent. **cost** is in planner units, only useful for comparing plans.
- **Estimated versus actual rows** is the key comparison: 126 versus 104 here is fine. A big mismatch means poor statistics or a condition the planner cannot estimate, and that is usually why a plan is bad. Postgres 18 prints actual rows with two decimals because they are averages per loop.
- **Rows Removed by Filter: 3958** means it fetched 4,062 rows to keep 104. That is the signal a better index would help.
- **Buffers: shared hit** counts 8 kB pages found in Postgres's cache; `read` means pages fetched from the operating system.

The surprise is that it already used an index: `jobs_tenant_key_uniq` on `(tenant_id, idempotency_key)`, created by the unique constraint. Its leading column is `tenant_id`, so it serves any tenant filter, and a separate index on `tenant_id` alone would be redundant.

## Scan types

| Node | Meaning |
| --- | --- |
| Seq Scan | read every page of the table |
| Index Scan | walk the index, then fetch each matching row from the table |
| Index Only Scan | answer from the index alone, if every needed column is in it and vacuum has marked the pages all-visible |
| Bitmap Index Scan + Bitmap Heap Scan | collect many matches, then read table pages in physical order |

## Composite indexes and column order

```sql
CREATE INDEX jobs_tenant_status_created_idx ON jobs (tenant_id, status, created_at);
```

The same query becomes an `Index Scan Backward` under `Limit`, with both conditions in `Index Cond`, 24 buffers and 0.06 ms. Reading backwards yields `created_at DESC` order, so there is no sort and it stops after 20 rows. A composite index is sorted by the first column, then the second within it, like a phone book. The rule of thumb: **equality columns first, then the range or sort column**.

## Skip scan in Postgres 18

Traditionally a composite index was useless for a query that skipped its leading column. Postgres 18 adds **B-tree skip scan**: for `WHERE status = 'queued'` on its own, the plan used `jobs_tenant_status_created_idx` with `Index Searches: 85`, one descent per distinct leading prefix. That pays off because there are only 50 tenants; with thousands it would not. I still design with the leading column first and treat skip scan as a bonus.

## Partial indexes for the claim query

Workers repeatedly ask for the next runnable job (the full claim with `FOR UPDATE SKIP LOCKED` is in the transactions note):

```sql
SELECT id FROM jobs
WHERE status = 'queued' AND next_attempt_at <= now()
ORDER BY next_attempt_at
LIMIT 10
FOR UPDATE SKIP LOCKED;
```

Using only the composite index, the plan fetched all 2,000 queued rows and sorted them: 1.4 ms. Queued jobs are a tiny, constantly changing slice of the table, which is what a **partial index** is for:

```sql
CREATE INDEX jobs_runnable_idx ON jobs (next_attempt_at) WHERE status = 'queued';
```

Now the plan is `Index Scan using jobs_runnable_idx` under `LockRows`, reading in `next_attempt_at` order and stopping after ten rows: 0.05 ms. The index is 64 kB against 9.7 MB for the composite one, and finished jobs never touch it. The planner only uses it when the query's condition implies the index's: `status = 'queued'` does, `status IN ('queued', 'running')` does not.

## Keyset pagination

`LIMIT 20 OFFSET 3000` makes Postgres produce 3,020 rows and discard 3,000, so every page is slower than the last. Keyset pagination passes the last row seen instead, with `id` as a tie-breaker:

```sql
SELECT id, status, created_at FROM jobs
WHERE tenant_id = $1 AND status = $2
  AND (created_at, id) < ($3, $4)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

With `id` appended to the index, `(tenant_id, status, created_at, id)`, the whole row comparison became an `Index Cond` and, after a `VACUUM`, the plan was an `Index Only Scan Backward` with `Heap Fetches: 0`.

## Plans for queries sent from Go

pgx prepares and caches statements by default, and sqlc queries use `$1` placeholders. After five executions Postgres may switch a prepared statement to a **generic plan** that ignores the actual parameter values. I can see that plan without values using `EXPLAIN (GENERIC_PLAN)`:

```sql
EXPLAIN (GENERIC_PLAN)
SELECT id FROM jobs WHERE status = $1 AND next_attempt_at <= now()
ORDER BY next_attempt_at LIMIT 10;
```

This gave a parallel sequential scan: with `status = $1`, the planner cannot prove the partial index applies. So in the sqlc query file I write `status = 'queued'` as a literal. Skewed columns suffer too, since a generic plan estimates 50,000 rows for any status when `queued` has 2,000 and `succeeded` 190,000.

## Gotchas

- **Foreign keys are not indexed automatically.** `PRIMARY KEY` and `UNIQUE` create indexes; `REFERENCES` does not. Here the unique constraints happen to lead with `tenant_id` and `job_id`, so both foreign keys are covered; without that, deleting a job would scan `job_attempts`.
- **EXPLAIN ANALYZE executes the statement.** For writes, wrap it: `BEGIN; EXPLAIN ANALYZE UPDATE ...; ROLLBACK;`.
- **A sequential scan is not always wrong.** `WHERE status = 'succeeded'` matches 95% of rows, and a sequential scan is the right plan.
- **Functions on the column hide it from the index.** `date_trunc('day', created_at) = ...` scanned the whole table. Rewrite it as a range (`created_at >= ... AND created_at < ...`). An expression index is the alternative, but only for immutable expressions, and `date_trunc` on `timestamptz` depends on `TimeZone`, so Postgres refuses it.
- **`CREATE INDEX` blocks writes.** On a live table use `CREATE INDEX CONCURRENTLY`, which cannot run inside a transaction, so the goose migration needs `-- +goose NO TRANSACTION`.
- **Stale statistics cause bad plans.** Autovacuum normally runs `ANALYZE`, but after a bulk load I run it by hand.

## Check yourself

1. In a plan, what does a large gap between estimated and actual rows tell me, and what is the first thing to try?
2. Why did the first query use the unique constraint's index, and what makes a separate `tenant_id` index redundant?
3. When does the planner use `jobs_runnable_idx`, and why does `status = $1` in a prepared statement stop it?
4. Why is keyset pagination faster than `OFFSET` for deep pages, and why does it need `id` as a tie-breaker?
5. What does Postgres 18 skip scan change about column order, and when does it stop helping?

## Further reading

- [Indexes](https://www.postgresql.org/docs/current/indexes.html)
- [Multicolumn indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html)
- [Partial indexes](https://www.postgresql.org/docs/current/indexes-partial.html)
- [Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)
- [CREATE INDEX, including CONCURRENTLY](https://www.postgresql.org/docs/current/sql-createindex.html)
- [pgx v5 package documentation, query exec modes](https://pkg.go.dev/github.com/jackc/pgx/v5)
- [Use the index, Luke](https://use-the-index-luke.com/)
