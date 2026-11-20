---
title: PostgreSQL essentials for app developers
summary: Running Postgres 18 in Docker, finding my way around psql, and sketching a job-processing schema whose constraints enforce tenant-scoped idempotency.
technologies: [postgresql, docker, go]
topics: [fundamentals, setup, data-modelling]
updated: 2026-11-20
---

The PostgreSQL basics I need before writing Go against it: running it, getting around psql, how it organises things, and designing tables that reject bad data by themselves. The running example is a job-processing domain in the spirit of [InferenceFlow](/projects/inferenceflow): tenants submit jobs with an idempotency key, and workers make attempts at them. The tables are my practice sketch, not the project's schema.

## Running Postgres 18 in Docker

```sh
docker volume create pgdata
docker run -d --name pg \
  -e POSTGRES_USER=inferenceflow \
  -e POSTGRES_PASSWORD=inferenceflow \
  -e POSTGRES_DB=inferenceflow \
  -p 127.0.0.1:5432:5432 \
  -v pgdata:/var/lib/postgresql \
  postgres:18
```

- `POSTGRES_PASSWORD` is required. `POSTGRES_USER` creates a superuser and `POSTGRES_DB` the first database.
- From 18 the image keeps its data in a version-specific directory (`/var/lib/postgresql/18/docker`), so the volume belongs at `/var/lib/postgresql`. Older tutorials mount `/var/lib/postgresql/data`, which 18 refuses. The versioned path makes `pg_upgrade` possible inside one volume.
- Binding to `127.0.0.1` keeps the database off the local network.

## Getting around in psql

```sh
docker exec -it pg psql -U inferenceflow -d inferenceflow
```

Meta-commands start with a backslash and are handled by psql itself; anything else is SQL and needs a terminating `;`.

| Command | What it does |
| --- | --- |
| `\l` | list databases |
| `\c dbname` | connect to another database |
| `\dn` / `\dt` | list schemas / tables |
| `\d jobs` | describe a table, its indexes and constraints |
| `\du` | list roles |
| `\x auto` | expanded output for wide rows |
| `\conninfo` | which database, user and host I am on |

## How Postgres organises things

- A **cluster** is one running server holding several **databases**. A connection is always to exactly one database.
- **Schemas** are namespaces inside a database. Since Postgres 15 ordinary roles cannot create objects in `public` unless granted `CREATE`.
- **Roles** are both users and groups. A "user" is a role with `LOGIN`.

Unlike Oracle, a schema is not tied to a user. The app should connect as a role that reads and writes rows but owns nothing; migrations run as the owner.

```sql
CREATE ROLE inferenceflow_app LOGIN PASSWORD 'change-me';
GRANT CONNECT ON DATABASE inferenceflow TO inferenceflow_app;
GRANT USAGE ON SCHEMA public TO inferenceflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO inferenceflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO inferenceflow_app;
```

`ON ALL TABLES` only covers tables that exist now; the default privileges cover tables future migrations create.

## Types worth choosing deliberately

| Need | Use | Avoid |
| --- | --- | --- |
| Surrogate key | `bigint GENERATED ... AS IDENTITY` | `serial` (legacy) |
| Public identifier | `uuid`, generated with `uuidv7()` (new in 18) | exposing sequential ids |
| A point in time | `timestamptz` | `timestamp` (no time zone) |
| Text | `text`, plus a `CHECK` for real rules | `char(n)` |
| Semi-structured data | `jsonb` | `json` |

`timestamptz` stores an absolute instant (in UTC) and converts on output using the session's `TimeZone`; plain `timestamp` is a wall-clock reading with no zone, which is almost never what an application means. pgx scans it into `time.Time`. `uuidv7()` values start with a timestamp, so new rows land at the end of the primary key index rather than at random positions.

## A job-processing schema sketch

```sql
CREATE TABLE tenants (
    id         text PRIMARY KEY CHECK (id <> ''),
    name       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
    id               uuid PRIMARY KEY DEFAULT uuidv7(),
    tenant_id        text NOT NULL REFERENCES tenants (id),
    idempotency_key  text NOT NULL CHECK (idempotency_key <> ''),
    request_hash     text NOT NULL,
    document_ref     text NOT NULL,
    rule_set_version text NOT NULL,
    status           text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('received', 'queued', 'running', 'succeeded', 'failed', 'cancelled')),
    attempt_count    integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at  timestamptz NOT NULL DEFAULT now(),
    lease_owner      text,
    lease_expires_at timestamptz,
    lease_token      bigint NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT jobs_tenant_key_uniq UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT jobs_lease_pair CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL))
);

CREATE TABLE job_attempts (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id       uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    attempt_no   integer NOT NULL CHECK (attempt_no > 0),
    worker_id    text NOT NULL,
    lease_token  bigint NOT NULL,
    leased_until timestamptz NOT NULL,
    started_at   timestamptz NOT NULL DEFAULT now(),
    ended_at     timestamptz,
    outcome      text CHECK (outcome IN ('succeeded', 'failed', 'retryable', 'lease_expired')),
    UNIQUE (job_id, attempt_no)
);
```

Why each piece is there:

- **NOT NULL** by default; a nullable column should be a decision.
- **CHECK on status** makes an invented state impossible. It does not enforce *transitions*; conditional `UPDATE`s do that (see the transactions note).
- **`jobs_lease_pair`** says a job either has an owner and an expiry, or neither.
- **UNIQUE (tenant_id, idempotency_key)** is the idempotency rule itself. The key is scoped to a tenant, so two tenants can both use `document-demo-001`. Naming the constraint lets Go code recognise it in errors.
- **REFERENCES** makes orphans impossible. Attempts cascade with their job; deleting a tenant that has jobs is refused.
- **UNIQUE (job_id, attempt_no)** also indexes `job_id`, so the foreign key needs no separate index.

## Idempotent submission without a race

Checking for the key with a `SELECT` and then inserting is broken: two concurrent requests can both see nothing and both insert. Let the unique constraint arbitrate instead:

```sql
INSERT INTO jobs (tenant_id, idempotency_key, request_hash, document_ref, rule_set_version)
VALUES ('acme', 'document-demo-001', 'sha256:9f2c', 'docs/acme/invoice-17.pdf', 'rules-v3')
ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
RETURNING id, status, created_at;
```

The first call returns the new row; a repeat returns zero rows, because `RETURNING` only reports inserted rows. If another transaction is mid-insert with the same key, `ON CONFLICT` waits for it to finish. In Go with pgx:

```go
var ErrIdempotencyConflict = errors.New("idempotency key reused with a different request")

// Submit returns the job's ID and whether this call created it.
func Submit(ctx context.Context, db *pgxpool.Pool, s Submission) (id string, created bool, err error) {
	err = db.QueryRow(ctx, `
		INSERT INTO jobs (tenant_id, idempotency_key, request_hash, document_ref, rule_set_version)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
		RETURNING id::text`,
		s.TenantID, s.Key, s.RequestHash, s.DocumentRef, s.RuleSetVersion,
	).Scan(&id)
	if err == nil {
		return id, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", false, err
	}
	// The key exists: the same request is a replay, a different one is a conflict.
	var hash string
	err = db.QueryRow(ctx, `
		SELECT id::text, request_hash FROM jobs
		WHERE tenant_id = $1 AND idempotency_key = $2`,
		s.TenantID, s.Key,
	).Scan(&id, &hash)
	if err != nil {
		return "", false, err
	}
	if hash != s.RequestHash {
		return "", false, ErrIdempotencyConflict
	}
	return id, false, nil
}
```

With 20 goroutines submitting the same key, one created the job and 19 got its ID back. The follow-up `SELECT` sees the winner's row because, under the default `READ COMMITTED`, each statement takes a fresh snapshot.

A plain `INSERT` fails with SQLSTATE `23505` instead, surfaced by pgx as a `*pgconn.PgError`. I check `pgErr.Code == "23505"` and `pgErr.ConstraintName == "jobs_tenant_key_uniq"` and map it to a domain error rather than leaking a raw SQL message.

## Gotchas

- **DDL is transactional.** Unlike Oracle, `CREATE TABLE` inside `BEGIN ... ROLLBACK` really is rolled back, so a failed goose migration can leave nothing behind.
- **Empty string is not NULL.** Oracle treats `''` as `NULL`; Postgres does not, hence the `<> ''` checks.
- **Unquoted identifiers fold to lower case.** `CREATE TABLE Jobs` creates `jobs`; quoting makes a name case-sensitive forever.
- **Deleting the container is fine; deleting the volume is not.** `docker rm pg` keeps data in `pgdata`; `docker volume rm pgdata` or `docker compose down -v` is permanent.
- **`localhost` inside a container is the container.** Another container reaches Postgres by service name on a shared network, as the [Docker Compose note](/knowledge/docker-compose-go-and-postgres) shows.

## Check yourself

1. Where should the volume be mounted for `postgres:18`, and why did the image move away from `/var/lib/postgresql/data`?
2. What does `timestamptz` actually store, and what changes when the session `TimeZone` changes?
3. Why is a `SELECT` followed by an `INSERT` not enough to enforce idempotency keys, and what does the unique constraint do instead?
4. Which constraints in the sketch create indexes automatically, and why does `job_attempts.job_id` not need its own?
5. Why does `INSERT ... ON CONFLICT DO NOTHING RETURNING id` return no rows on a replay, and how does the Go code tell a replay from a conflict?

## Further reading

- [PostgreSQL tutorial](https://www.postgresql.org/docs/current/tutorial.html)
- [Data types](https://www.postgresql.org/docs/current/datatype.html)
- [Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)
- [INSERT, including ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html)
- [psql reference](https://www.postgresql.org/docs/current/app-psql.html)
- [pgx v5 package documentation](https://pkg.go.dev/github.com/jackc/pgx/v5)
- [Official postgres Docker image](https://hub.docker.com/_/postgres)
