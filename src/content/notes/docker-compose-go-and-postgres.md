---
title: Docker Compose for a Go service and Postgres
summary: A compose.yaml for a Go API and postgres:18 - healthchecks, start-up ordering, a pgx DATABASE_URL, goose migrations as a one-off service, Compose Watch rebuilds and a throwaway test database.
technologies: [docker, postgresql, go]
topics: [containers, setup, networking, migrations]
updated: 2026-11-20
---

Running Postgres, a migration step and an API by hand means remembering networks, volumes, environment variables and start-up order. Compose puts all of that in one file. InferenceFlow needs a reproducible Postgres as soon as its P4 integration tests exist, and a full Compose stack in P13, so this is the shape I want to understand first. The service below is illustrative: a Go API under `cmd/api`, SQL migrations under `db/migrations`, and the Dockerfile from the Dockerfile note. I ran every command here against a scratch module.

Compose is the `docker compose` CLI plugin (v2 and later), not the old hyphenated `docker-compose` tool. The default file name is `compose.yaml`, and the top-level `version:` key is obsolete.

## The file

```yaml
# compose.yaml
name: inferenceflow

services:
  db:
    image: postgres:18
    environment:
      POSTGRES_USER: inferenceflow
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-inferenceflow}
      POSTGRES_DB: inferenceflow
    volumes:
      - pgdata:/var/lib/postgresql
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
      start_interval: 1s

  migrate:
    build:
      context: .
      target: migrate
    environment:
      GOOSE_DRIVER: postgres
      GOOSE_DBSTRING: postgres://inferenceflow:${POSTGRES_PASSWORD:-inferenceflow}@db:5432/inferenceflow?sslmode=disable
    depends_on:
      db:
        condition: service_healthy

  api:
    build:
      context: .
      target: runtime
    environment:
      HTTP_ADDR: ":8080"
      DATABASE_URL: postgres://inferenceflow:${POSTGRES_PASSWORD:-inferenceflow}@db:5432/inferenceflow?sslmode=disable&pool_max_conns=10
    ports:
      - "127.0.0.1:8080:8080"
    depends_on:
      db:
        condition: service_healthy
        restart: true
      migrate:
        condition: service_completed_successfully
    develop:
      watch:
        - action: rebuild
          path: ./cmd
        - action: rebuild
          path: ./internal
        - action: rebuild
          path: go.mod
        - action: rebuild
          path: go.sum

  db-test:
    image: postgres:18
    profiles: [test]
    environment:
      POSTGRES_USER: inferenceflow
      POSTGRES_PASSWORD: inferenceflow
      POSTGRES_DB: inferenceflow_test
    tmpfs:
      - /var/lib/postgresql
    ports:
      - "127.0.0.1:5433:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U inferenceflow -d inferenceflow_test"]
      interval: 2s
      retries: 15

volumes:
  pgdata:
```

`HTTP_ADDR` and `DATABASE_URL` match the configuration names InferenceFlow's README proposes; the values are mine.

## The database service

**The volume path.** From PostgreSQL 18 the official image keeps its data in a versioned directory under `/var/lib/postgresql`, and the volume must be mounted there. Older tutorials mount `/var/lib/postgresql/data`, which with 18 leaves the real data in an anonymous volume that's lost when the container is recreated. After `docker compose down` and `up`, my migration service printed `no migrations to run. current version: 1`, which proved the data survived.

**The healthcheck.** `pg_isready` checks that the server accepts connections. `$${POSTGRES_USER}` has a doubled `$` so Compose doesn't interpolate it when reading the file; the shell inside the container expands it. `start_period` gives Postgres time to initialise before failures count, and `start_interval` checks every second during that window.

**The port.** Bound to `127.0.0.1` so only my machine can reach it, for `psql` and for running `go test` on the host.

## Start-up ordering

A plain `depends_on: [db]` only waits for the container to *start*. Postgres then spends a few seconds initialising, and anything connecting immediately fails. The two conditions here do the real work:

- **`service_healthy`** waits until `db`'s healthcheck passes.
- **`service_completed_successfully`** waits until `migrate` has *exited with status 0*. If a migration fails, the API never starts, which is what I want.

`restart: true` restarts the API if Compose restarts the database. None of this helps once things are running: the Go service still needs connection timeouts and should fail readiness clearly if Postgres goes away.

## `DATABASE_URL` for pgx

pgx accepts a URL (`postgres://user:pass@host:port/db?sslmode=disable`) or a keyword/value string (`host=db user=inferenceflow dbname=inferenceflow`). Three details:

- **Host `db`, port `5432`.** Service names are DNS names on the project network, and containers talk on the container port, not the published one.
- **`sslmode=disable`.** pgx defaults to `prefer`, which tries TLS first. Being explicit avoids surprises; outside a local network, TLS should be required instead.
- **`pool_max_conns=10`** is read by `pgxpool.ParseConfig` and stripped before connecting. Plain `pgx.Connect`, or goose, would pass it to the server as a run-time parameter, which fails. That's why `GOOSE_DBSTRING` doesn't have it.

## Migrations as a one-off service

InferenceFlow's plan treats migrations as an explicit deployment step, not something every replica races to do at start-up. A dedicated `migrate` service mirrors that locally. It's built from two extra Dockerfile stages:

```dockerfile
FROM golang:1.27 AS goose
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go install -trimpath \
      -tags='no_azuresql no_clickhouse no_libsql no_mssql no_mysql no_sqlite3 no_vertica no_ydb' \
      github.com/pressly/goose/v3/cmd/goose@v3.30.1

FROM gcr.io/distroless/static-debian13:nonroot AS migrate
COPY --from=goose /go/bin/goose /goose
COPY db/migrations /migrations
ENV GOOSE_MIGRATION_DIR=/migrations
ENTRYPOINT ["/goose"]
CMD ["up"]
```

The build tags leave out goose's other database drivers. goose reads `GOOSE_DRIVER`, `GOOSE_DBSTRING` and `GOOSE_MIGRATION_DIR` from the environment, so any subcommand works as a one-off:

```sh
docker compose run --rm migrate status
docker compose run --rm migrate down
```

The `runtime` stage must stay last in the Dockerfile, so a plain `docker build` still produces the API image.

Running migrations on start (goose as a library, with migrations embedded through `embed.FS`) is simpler for a single instance. With several replicas they race, and a slow migration delays every start-up, so I'd keep it for experiments.

## A rebuild loop with Compose Watch

Go has no interpreter to reload, and distroless has no `stat` or `mkdir` for Watch's `sync` action, so `rebuild` is the natural fit: when a watched path changes, Compose rebuilds the image and recreates the container.

```sh
docker compose up -d --wait   # start everything, wait for healthchecks
docker compose watch          # rebuild api when Go files change
```

Editing a file under `cmd/` rebuilt and replaced my API container within seconds, because the Dockerfile's cache mounts keep compilation incremental. Paths outside the list, such as `db/migrations`, don't trigger anything; I rerun `migrate` for those.

## A separate test database

Integration tests shouldn't touch my development data. `db-test` sits behind a **profile**, so a plain `up` ignores it, and its data lives on **tmpfs**: fast, and gone when the container stops.

```sh
docker compose --profile test up -d --wait db-test
export DATABASE_URL='postgres://inferenceflow:inferenceflow@localhost:5433/inferenceflow_test?sslmode=disable'
go run github.com/pressly/goose/v3/cmd/goose@v3.30.1 -dir db/migrations postgres "$DATABASE_URL" up
go test -race -count=1 ./...
docker compose --profile test down
```

This mirrors the CI job in the Go CI note, where a service container plays the same role.

## Everyday commands

```sh
docker compose ps -a                 # status and health, including exited migrate
docker compose logs -f api
docker compose exec db psql -U inferenceflow
docker compose config                # the file with every variable resolved
docker compose down                  # keep pgdata
docker compose down -v               # delete pgdata: a clean database
```

## Gotchas

- **`localhost` in `DATABASE_URL` inside a container.** That's the API container itself; use the service name.
- **The pre-18 volume path.** Mount `/var/lib/postgresql` for `postgres:18`.
- **Changing `POSTGRES_PASSWORD` after the first run.** It only applies to an empty data directory. Change it in SQL or `down -v`.
- **Pool parameters in a non-pool connection string.** `pool_max_conns` breaks goose and `pgx.Connect`.
- **Interpolation versus container environment.** `${POSTGRES_PASSWORD:-inferenceflow}` is resolved from my shell or `.env` when Compose reads the file; `environment:` sets variables inside the container. `.env` never goes in Git.

## Check yourself

1. Why does the API use `db:5432` while tests on my Mac use `localhost:5433`?
2. What do `service_healthy` and `service_completed_successfully` each wait for?
3. Why run goose as its own service rather than inside the API's start-up?
4. Why does the Watch config use `rebuild` rather than `sync` for a Go service on distroless?
5. What makes `db-test` both opt-in and disposable?

## Further reading

- [Docker Compose documentation](https://docs.docker.com/compose/)
- [Compose: control start-up order](https://docs.docker.com/compose/how-tos/startup-order/)
- [Compose: use Compose Watch](https://docs.docker.com/compose/how-tos/file-watch/)
- [Compose: profiles](https://docs.docker.com/compose/how-tos/profiles/)
- [Postgres official image: PGDATA and volumes](https://hub.docker.com/_/postgres)
- [pgxpool: connection string parameters](https://pkg.go.dev/github.com/jackc/pgx/v5/pgxpool)
- [goose](https://pressly.github.io/goose/)
