---
title: Python CI with Postgres service containers
summary: A complete GitHub Actions workflow for a uv project - ruff, a Python version matrix, a postgres:18 service container with health checks, migrations and pytest against a real database.
technologies: [github-actions, python, postgresql]
topics: [ci-cd, testing]
updated: 2026-11-20
---

The inventory API's tests run against a real PostgreSQL, because SQLite behaves differently in ways that matter: types, constraints, locking and `ON CONFLICT`. CI has to do the same. GitHub Actions does this with **service containers**: Docker containers the runner starts alongside a job and tears down afterwards.

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

jobs:
  lint:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v10.3.3
      - run: uv sync --locked
      - run: uv run ruff check .
      - run: uv run ruff format --check .

  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    continue-on-error: ${{ matrix.experimental == true }}
    strategy:
      fail-fast: false
      matrix:
        python-version: ["3.14"]
        include:
          - python-version: "3.15"
            experimental: true

    services:
      postgres:
        image: postgres:18
        env:
          POSTGRES_USER: inventory
          POSTGRES_PASSWORD: inventory
          POSTGRES_DB: inventory_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U inventory -d inventory_test"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

    env:
      DATABASE_URL: postgresql+psycopg://inventory:inventory@localhost:5432/inventory_test

    steps:
      - uses: actions/checkout@v7

      - uses: astral-sh/setup-uv@v10.3.3
        with:
          python-version: ${{ matrix.python-version }}

      - name: Install dependencies
        run: uv sync --locked

      - name: Run migrations
        run: uv run alembic upgrade head

      - name: Run tests
        run: uv run pytest --junitxml=junit.xml

      - name: Upload test report
        if: ${{ !cancelled() }}
        uses: actions/upload-artifact@v7
        with:
          name: junit-${{ matrix.python-version }}
          path: junit.xml
```

## Walking through it

### Two jobs, not one

`lint` and `test` run in parallel on separate runners. Lint finishes in seconds, so a formatting mistake shows up straight away instead of after the database tests. Each appears as its own check on the pull request, so I can see at a glance which failed.

### setup-uv and caching

`astral-sh/setup-uv` installs uv and, on GitHub-hosted runners, turns on its cache automatically (`enable-cache` defaults to `auto`). The cache key includes a hash of `uv.lock`, so a run with unchanged dependencies restores the uv cache and `uv sync` takes a second or two. There's no need for `actions/setup-python`. Given `python-version`, setup-uv sets `UV_PYTHON`, and uv downloads that interpreter if the runner doesn't have it.

One thing to know about versions: from v8 onwards setup-uv no longer publishes a moving major tag such as `@v10`, so it has to be referenced by a full version (`@v10.3.3`) or, better, a commit SHA (see the security note). The `actions/*` actions still have major tags like `@v7`.

### `uv sync --locked`

`--locked` fails the job if `uv.lock` is out of date with `pyproject.toml`. That catches the classic "added a dependency, forgot to commit the lockfile" mistake in CI rather than in production. `uv sync` installs the `dev` group by default, so pytest and ruff are there alongside runtime dependencies such as Alembic.

### The matrix

`strategy.matrix` runs the `test` job once per combination. Here that's the version I deploy (3.14) plus the newest release (3.15), which is marked `experimental` through `include`. `continue-on-error` lets the 3.15 job fail without failing the workflow, so I find out early when a dependency isn't ready, without blocking merges. `fail-fast: false` stops one failing combination cancelling the others, which matters when the point is to compare results.

### The service container

Everything under `services.postgres` maps onto `docker run` options:

- **`image: postgres:18`**: same major version as my Compose file, so CI and local behaviour match.
- **`env`**: the image's initialisation variables. They create the user and an empty `inventory_test` database on start-up.
- **`ports: 5432:5432`** publishes the container port on the runner. Because the steps run *directly on the runner VM*, they connect to `localhost:5432`.
- **`options`** are passed to `docker create`. The `--health-*` flags give the container a health check, and **the runner waits for it to report healthy before starting the steps**. Without them, the job can start while Postgres is still initialising and the first test fails with "connection refused".

`pg_isready` with `-U` and `-d` checks the server is accepting connections. It would succeed without them, but Postgres would log a failed login for user `root` every few seconds.

If the job itself ran in a container (`container: python:3.14-slim`), the networking changes: the job and the service share a Docker network, the hostname is the service label `postgres`, and `ports:` isn't needed. Running on the runner is simpler and faster to set up, so that's my default.

Service containers only work on Linux runners.

### Migrations, then tests

Running `alembic upgrade head` as its own step means a broken migration fails as "Run migrations" rather than as a confusing test error. It also tests the migrations themselves on every pull request, which a test suite that calls `metadata.create_all()` would not. The pytest fixtures then read `DATABASE_URL` from the environment and wrap each test in a transaction that's rolled back (see the SQLAlchemy testing note).

The database is brand new for every job, so there's no state leaking between runs, and nothing to clean up.

### Keeping the report

`if: ${{ !cancelled() }}` uploads the JUnit report whether the tests passed or failed, but not when the run was cancelled. The artifact name includes the Python version because two matrix jobs uploading the same artifact name would conflict.

## Matching local development

The same commands work on my laptop with the Compose database running:

```sh
docker compose up -d db
export DATABASE_URL=postgresql+psycopg://inventory:inventory@localhost:5432/inventory_test
uv run alembic upgrade head
uv run pytest
```

Ideally the only difference between the two environments is who started Postgres.

## Gotchas

- **`localhost` versus the service name.** Steps on the runner use `localhost` and the mapped port; steps in a job container use the service label.
- **No health options.** The runner then only waits for the container to *start*, not for Postgres to be ready.
- **Required checks and matrices.** Branch protection sees each combination as a separately named check, such as `test (3.14)`. Renaming the job or changing the matrix leaves the old required check pending forever. The usual fix is to require one small summary job instead: it `needs` the matrix, runs with `if: always()`, and fails unless every matrix job succeeded. (Without `if: always()` it's *skipped* when a dependency fails, and a skipped required check counts as passing.)
- **Plain `uv sync` in CI.** Without `--locked`, uv quietly updates the lockfile on the runner and tests something I never committed.
- **Secrets for a throwaway database.** The service password doesn't need to be a secret; the database exists for a few minutes on a private VM. Real credentials still belong in `secrets`.

## Check yourself

1. Why does the test step use `localhost:5432`, and what would change if the job ran in a container?
2. What do the `--health-*` options change about when the steps start?
3. What does `uv sync --locked` protect against that plain `uv sync` doesn't?
4. Why run `alembic upgrade head` as a separate step instead of creating tables in a fixture?
5. What do `fail-fast: false` and `continue-on-error` each do in this matrix?

## Further reading

- [GitHub Docs: creating PostgreSQL service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers)
- [GitHub Docs: about service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/use-docker-service-containers)
- [GitHub Docs: running variations of jobs with a matrix](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations)
- [uv: using uv in GitHub Actions](https://docs.astral.sh/uv/guides/integration/github/)
- [astral-sh/setup-uv](https://github.com/astral-sh/setup-uv)
