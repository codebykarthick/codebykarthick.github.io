---
title: Go CI with Postgres service containers
summary: A complete GitHub Actions workflow for a Go module - gofmt, go vet, golangci-lint, govulncheck, a Go version matrix, and go test -race against a postgres:18 service container after goose migrations.
technologies: [github-actions, go, postgresql]
topics: [ci-cd, testing]
updated: 2026-11-20
---

Integration tests that matter for a Postgres-backed service (constraints, locking, concurrent duplicate inserts) need a real PostgreSQL, and CI has to provide one. InferenceFlow's P13 lists the CI jobs it wants: formatting, tests, `-race`, vet, a security audit, build and integration tests. This note covers everything except the image build, for an illustrative module with SQL migrations in `db/migrations` and integration tests that read `DATABASE_URL`. GitHub Actions supplies the database as a **service container**: a Docker container the runner starts alongside a job and removes afterwards.

## The workflow

```yaml
# .github/workflows/ci.yml
name: ci

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

defaults:
  run:
    shell: bash

jobs:
  lint:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-go@v7
        with:
          go-version: "1.27.x"
          check-latest: true
      - name: Check formatting
        run: |
          unformatted="$(gofmt -l .)"
          if [ -n "$unformatted" ]; then
            echo "Files need gofmt:"; echo "$unformatted"; exit 1
          fi
      - name: Check go.mod and go.sum are tidy
        run: go mod tidy -diff
      - run: go vet ./...
      - uses: golangci/golangci-lint-action@v9
        with:
          version: v2.15.0

  vuln:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-go@v7
        with:
          go-version: "1.27.x"
          check-latest: true
      - run: go run golang.org/x/vuln/cmd/govulncheck@v1.10.0 ./...

  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    strategy:
      fail-fast: false
      matrix:
        go: ["1.27.x", "1.26.x"]

    services:
      postgres:
        image: postgres:18
        env:
          POSTGRES_USER: inferenceflow
          POSTGRES_PASSWORD: inferenceflow
          POSTGRES_DB: inferenceflow_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U inferenceflow -d inferenceflow_test"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

    env:
      DATABASE_URL: postgres://inferenceflow:inferenceflow@localhost:5432/inferenceflow_test?sslmode=disable
      GOTOOLCHAIN: local

    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false

      - uses: actions/setup-go@v7
        with:
          go-version: ${{ matrix.go }}

      - name: Run migrations
        run: go run github.com/pressly/goose/v3/cmd/goose@v3.30.1 -dir db/migrations postgres "$DATABASE_URL" up

      - name: Run tests
        run: go test -race -count=1 ./...

  ci-ok:
    if: always()
    needs: [lint, vuln, test]
    runs-on: ubuntu-latest
    steps:
      - name: Fail unless every job succeeded
        run: |
          [ "${{ contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') || contains(needs.*.result, 'skipped') }}" = "false" ]
```

actionlint reports nothing on it, and I ran the same steps (goose, gofmt, `go mod tidy -diff`, vet, `go test -race`, govulncheck) in a `golang:1.27` container against a Compose test database.

## Walking through it

### Three parallel jobs

`lint`, `vuln` and `test` run on separate runners at the same time. Formatting and vet failures appear within a minute instead of after the database tests, and each is its own check on the pull request.

### setup-go and caching

`actions/setup-go` installs Go and, by default, caches the module cache and build cache. The key includes the runner OS, architecture, Go version and a hash of `go.sum`, so each matrix entry gets its own cache and a run with unchanged dependencies skips both downloading and recompiling them. `check-latest: true` makes the lint and vuln jobs fetch the newest 1.27 patch rather than whatever the runner image has cached, which matters for govulncheck below.

### Lint: cheap checks first

- **`gofmt -l`** lists unformatted files. It prints names but exits 0 either way, hence the explicit test; it caught a stray trailing comment in my scratch module.
- **`go mod tidy -diff`** fails if `go.mod` or `go.sum` would change, catching a forgotten `go mod tidy` without modifying anything.
- **`go vet`** is the baseline static check that ships with Go.
- **golangci-lint** runs a configurable set of linters (v2's standard set includes `govet`, `errcheck`, `staticcheck`, `unused` and `ineffassign`) from a `.golangci.yml` with `version: "2"`. The action needs setup-go first, downloads the pinned binary and caches its own analysis results. Pinning `version` stops a new linter release failing CI on a Monday morning.

### govulncheck

govulncheck checks the module's dependencies *and* the standard library of the Go that runs it against the Go vulnerability database, and only reports vulnerabilities in code my program actually calls. That's why the job uses the newest patch release: an old toolchain on the runner would report standard-library vulnerabilities my release builds don't have. `go run ...@v1.10.0` pins the tool without adding it to `go.mod`.

### The service container

Everything under `services.postgres` maps onto `docker run` options:

- **`image: postgres:18`** matches my Compose file, so local and CI behaviour agree.
- **`env`** creates the user and an empty `inferenceflow_test` database on start-up.
- **`ports: 5432:5432`** publishes the port on the runner. The steps run directly on the runner VM, so they connect to `localhost:5432`.
- **`options`** are passed to `docker create`. The `--health-*` flags give the container a health check, and **the runner waits for it to report healthy before starting any step**. Without them the first test can hit a database that's still initialising.

If the job ran in a container (`container: golang:1.27`), the hostname would be the service label `postgres` and `ports:` would be unnecessary. Service containers only work on Linux runners.

### Migrations, then tests

Running goose as its own step means a broken migration fails as "Run migrations", not as a confusing test failure, and it exercises the real migration files on every pull request. Tests then read `DATABASE_URL` and skip when it's unset, so `go test ./...` still works on a laptop with no database.

- **`-race`** enables the race detector. It needs cgo and a C compiler, both present on the Ubuntu runners, and the Go docs put its cost at 2-20x execution time and 5-10x memory. It only finds races in code paths the tests actually run.
- **`-count=1`** disables Go's test result caching, so integration tests that depend on the database always run.

### The Go version matrix

The test job runs on the two supported Go releases, 1.27 and 1.26. Two details make that honest:

- **The `go` line in `go.mod` must allow the older version.** If it says `go 1.27.4`, a 1.26 toolchain can't build the module.
- **`GOTOOLCHAIN: local`.** With the default `auto`, Go 1.26 reads a newer `go` line and silently downloads and uses that toolchain. I confirmed this in a `golang:1.26` container: with `auto` it switched to 1.27.4; with `local` it failed with `go.mod requires go >= 1.27.4`. The official `golang` images already set `local`; setup-go's documentation doesn't mention it, so I set it explicitly.

For an application that only ever ships on the newest release, I'd drop the 1.26 entry rather than lower the `go` line. `fail-fast: false` keeps one failing entry from cancelling the other, so I can compare them.

### One required check

Branch protection sees each matrix entry as a separate check, such as `test (1.27.x)`, and changing the matrix leaves stale required checks pending forever. `ci-ok` is the single check to require: `if: always()` makes it run even when a dependency failed (otherwise it would be skipped, and a skipped required check counts as passing), and its script fails unless every needed job succeeded.

## Gotchas

- **`localhost` versus the service label.** Runner steps use `localhost`; steps in a job container use `postgres`.
- **No health options.** The runner then waits only for the container to start, not for Postgres to accept connections.
- **The toolchain switching under the matrix.** Without `GOTOOLCHAIN: local`, both entries can quietly test the same Go.
- **Cached test results.** Without `-count=1`, an integration test whose code didn't change reports `(cached)` and never touches the new schema.
- **Unpinned tools.** `@latest` for goose, govulncheck or golangci-lint means CI changes without a commit.

## Check yourself

1. Why do the test steps use `localhost:5432`, and what changes inside a job container?
2. What do the `--health-*` options change about when the steps start?
3. Why does the vuln job use `check-latest: true`?
4. What does `GOTOOLCHAIN: local` prevent, and what must the `go` line in `go.mod` say for the 1.26 entry to mean anything?
5. Why is `ci-ok` the required check rather than the matrix jobs, and why does it need `if: always()`?

## Further reading

- [GitHub Docs: building and testing Go](https://docs.github.com/en/actions/tutorials/build-and-test-code/go)
- [GitHub Docs: creating PostgreSQL service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers)
- [actions/setup-go](https://github.com/actions/setup-go)
- [golangci-lint-action](https://github.com/golangci/golangci-lint-action)
- [Go: vulnerability checking tutorial](https://go.dev/doc/tutorial/govulncheck)
- [Go: toolchains and GOTOOLCHAIN](https://go.dev/doc/toolchain)
- [Go: race detector](https://go.dev/doc/articles/race_detector)
