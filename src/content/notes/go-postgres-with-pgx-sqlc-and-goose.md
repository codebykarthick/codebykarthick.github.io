---
title: Go and PostgreSQL with pgx, sqlc and goose
summary: Reviewed goose migrations, sqlc queries for pgx/v5, one pgxpool per process, a transaction helper that rolls back on error, idempotent inserts with ON CONFLICT and PgError mapping.
technologies: [go, postgresql]
topics: [migrations, querying, transactions, best-practices]
updated: 2026-11-20
---

Phase P4 replaces InferenceFlow's in-memory store with PostgreSQL while every HTTP and domain test stays green. The Roadmap's stack is SQL-first: migrations written by hand and applied by goose, queries written in SQL and turned into typed Go by sqlc, and pgx/v5 as the driver. Nothing generates SQL I have not read, which matters because the concurrency guarantees live in that SQL.

Versions I tested against: pgx v5.13.0, sqlc v1.31.1, goose v3.30.1 and the `postgres:18` image.

## Migrations with goose

A migration is a plain SQL file with annotated up and down sections:

```sql
-- +goose Up
CREATE TABLE jobs (
    id               uuid PRIMARY KEY,
    tenant_id        text NOT NULL,
    idempotency_key  text NOT NULL,
    request_hash     text NOT NULL,
    status           text NOT NULL CHECK (status IN
                       ('received', 'queued', 'running', 'succeeded', 'failed', 'cancelled')),
    rule_set_version text NOT NULL,
    document_ref     text NOT NULL,
    attempt_count    integer NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT jobs_tenant_key_uq UNIQUE (tenant_id, idempotency_key)
);

-- +goose Down
DROP TABLE jobs;
```

This follows the Roadmap's illustrative schema, plus a named constraint so errors can be mapped precisely. With goose pinned as a tool in `go.mod`, the CLI reads its settings from the environment:

```sh
export GOOSE_DRIVER=postgres GOOSE_DBSTRING="$DATABASE_URL" GOOSE_MIGRATION_DIR=db/migrations
go tool goose status
go tool goose up
go tool goose -s create add_results sql   # -s: sequential 00004_ rather than a timestamp
```

The README is explicit that migrations are a deployment step, not something every replica races to run at start-up. In tests I apply them from Go with goose's provider API over a `database/sql` handle borrowed from the pool:

```go
db := stdlib.OpenDBFromPool(pool)
defer db.Close()
p, err := goose.NewProvider(goose.DialectPostgres, db, os.DirFS("db/migrations"))
if err != nil {
	return err
}
_, err = p.Up(ctx)
```

## Typed queries with sqlc

sqlc reads the migrations as the schema and annotated queries as input:

```yaml
version: "2"
sql:
  - engine: postgresql
    schema: db/migrations
    queries: db/queries
    gen:
      go:
        package: sqlcdb
        out: internal/postgres/sqlcdb
        sql_package: pgx/v5
        overrides:
          - db_type: uuid
            go_type:
              import: uuid
              type: UUID
          - db_type: timestamptz
            go_type:
              import: time
              type: Time
```

The overrides map `uuid` to the standard library's `uuid.UUID` (new in Go 1.27) and `timestamptz` to `time.Time` instead of pgtype wrappers; both scanned correctly with pgx in my tests. Queries use named parameters so generated structs have readable fields:

```sql
-- name: InsertJob :one
INSERT INTO jobs (id, tenant_id, idempotency_key, request_hash, status, rule_set_version, document_ref)
VALUES (@id, @tenant_id, @idempotency_key, @request_hash, @status, @rule_set_version, @document_ref)
ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
RETURNING id, status, updated_at;

-- name: GetJobByKey :one
SELECT id, request_hash, status, rule_set_version, document_ref, updated_at
FROM jobs
WHERE tenant_id = @tenant_id AND idempotency_key = @idempotency_key;
```

`sqlc generate` writes `InsertJob(ctx, InsertJobParams) (InsertJobRow, error)` and friends, plus a `DBTX` interface satisfied by both the pool and a transaction. `sqlc vet` and `sqlc diff` belong in CI so generated code never drifts from the SQL. sqlc does not choose transaction boundaries or make a slow query fast; that is still my job.

## One pool per process

```go
pool, err := pgxpool.New(ctx, cfg.DatabaseURL) // pool_max_conns etc. can go in the URL
if err != nil {
	return err
}
defer pool.Close()
```

The pool is built once in `main` and passed to adapters. Its size is a budget shared with worker concurrency: if 32 workers each hold a connection while 8 exist, 24 wait in `Acquire`, and that wait counts against their context deadlines. Pool contention is one of the metrics the Roadmap asks for later.

## A transaction helper

```go
func WithTx(ctx context.Context, pool *pgxpool.Pool, fn func(q *sqlcdb.Queries) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }() // no-op after a successful Commit
	if err := fn(sqlcdb.New(tx)); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}
```

The deferred rollback covers early returns and panics. pgx also ships `pgx.BeginFunc(ctx, pool, func(pgx.Tx) error)` with the same semantics, and sqlc generates `q.WithTx(tx)` for mixing generated and hand-written statements. Transactions stay short: never hold one open across the inference call.

## Idempotent create-or-get

The README's invariant is that `(tenant_id, idempotency_key)` identifies one accepted submission, equivalent replays reuse it and different content conflicts. A `SELECT` followed by an `INSERT` races: two requests both see nothing and both insert. The unique constraint plus `ON CONFLICT DO NOTHING` makes the insert itself the arbiter:

```go
err = WithTx(ctx, s.pool, func(q *sqlcdb.Queries) error {
	row, err := q.InsertJob(ctx, params)
	switch {
	case err == nil: // we created it: audit and outbox rows join the same transaction
		created = true
		if err := q.InsertAuditEvent(ctx, auditParams(row)); err != nil {
			return err
		}
		return q.InsertOutboxEvent(ctx, executeRequested(tenantID, id))
	case errors.Is(err, pgx.ErrNoRows): // conflict: the key already exists
		existing, err := q.GetJobByKey(ctx, sqlcdb.GetJobByKeyParams{TenantID: tenantID, IdempotencyKey: key})
		if err != nil {
			return err
		}
		if existing.RequestHash != hash {
			return job.ErrIdempotencyConflict
		}
		out, err = restore(existing)
		return err
	default:
		return err
	}
})
```

On conflict, `RETURNING` yields no row, so a `:one` query returns `pgx.ErrNoRows`. Under the default READ COMMITTED level, `ON CONFLICT` waits for a concurrent inserter to commit, so the follow-up `SELECT` (a new statement with a new snapshot) sees its row. My integration test fires 20 concurrent submissions with the same key: exactly one reports `created`, all return the same job ID, and one outbox row exists.

## Mapping driver errors

Callers above the adapter should see domain errors, not pgx types:

```go
func mapErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return job.ErrNotFound
	}
	if pgErr, ok := errors.AsType[*pgconn.PgError](err); ok {
		switch pgErr.Code {
		case "23505": // unique_violation
			if pgErr.ConstraintName == "jobs_tenant_key_uq" {
				return job.ErrIdempotencyConflict
			}
		case "40001", "40P01": // serialization_failure, deadlock_detected
			return fmt.Errorf("%w: %w", ErrRetryableTx, err)
		}
	}
	return err
}
```

`github.com/jackc/pgerrcode` provides named constants if the literals feel too magic. Matching on `ConstraintName` keeps one unique violation from being mistaken for another.

## Proving it

Two integration tests carry the P4 exit gate: the concurrent duplicate submission above, and the Roadmap's rollback exercise, where `fn` inserts a job and then returns an injected error before the audit insert, and the test asserts the `jobs` table is still empty.

## Gotchas

- **Catching 23505 inside a transaction does not save it.** After any error, PostgreSQL aborts the transaction and every later statement fails with 25P02. That is why the conflict is handled with `ON CONFLICT`, not by catching the error and carrying on.
- **`DO NOTHING ... RETURNING` returns nothing on conflict.** Treat `pgx.ErrNoRows` as "exists", not as a failure.
- **Nullable columns need nullable Go types.** sqlc generates `pgtype.Text` and friends (or pointers with `emit_pointers_for_null_types`), and a plain `string` scan of NULL fails.
- **Rows hold a connection until closed.** `pgx.CollectRows` and sqlc's generated code close them; hand-written loops must `defer rows.Close()` and check `rows.Err()`.
- **Functions and `DO` blocks with semicolons** need `-- +goose StatementBegin` and `-- +goose StatementEnd` around them.

## Check yourself

1. Why is `SELECT` then `INSERT` not a safe idempotency check, even inside a transaction?
2. What does `InsertJob` return when the key already exists, and how does the code tell replay from conflict?
3. Why is the rollback deferred unconditionally, and why is that safe after `Commit`?
4. How do pool size and worker concurrency interact, and where does the waiting show up?
5. Why should migrations run as a separate deployment step rather than at every replica's start-up?

## Further reading

- [pgx v5 documentation](https://pkg.go.dev/github.com/jackc/pgx/v5) and [pgxpool](https://pkg.go.dev/github.com/jackc/pgx/v5/pgxpool)
- [sqlc, using Go and pgx](https://docs.sqlc.dev/en/latest/guides/using-go-and-pgx.html) and [sqlc configuration reference](https://docs.sqlc.dev/en/latest/reference/config.html)
- [goose documentation](https://pressly.github.io/goose/) and [repository](https://github.com/pressly/goose)
- [Accessing relational databases from Go](https://go.dev/doc/database/)
- [PostgreSQL INSERT and ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html)
- [PostgreSQL error codes](https://www.postgresql.org/docs/current/errcodes-appendix.html)
