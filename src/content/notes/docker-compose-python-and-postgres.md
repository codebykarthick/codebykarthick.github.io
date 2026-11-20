---
title: Docker Compose for a Python service and Postgres
summary: A compose.yaml that runs the API and postgres:18 together, with a healthcheck, start-up ordering, a named volume, DATABASE_URL, and a fast edit loop with Compose Watch.
technologies: [docker, postgresql, python]
topics: [containers, setup, networking]
updated: 2026-11-20
---

Running two containers by hand means remembering networks, volumes, environment variables and start-up order. Compose puts all of that in one file and turns it into `docker compose up`. It's my local development environment for the inventory API, and the file doubles as documentation of what the service needs.

Compose is now the `docker compose` plugin (v2), not the old `docker-compose` Python tool. The default file name is `compose.yaml`, and the top-level `version:` key is obsolete; recent versions warn if it's present.

## The file

```yaml
# compose.yaml
name: inventory

services:
  db:
    image: postgres:18
    environment:
      POSTGRES_USER: inventory
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-inventory}
      POSTGRES_DB: inventory
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

  api:
    build:
      context: .
      dockerfile: Dockerfile.dev
    command: ["uvicorn", "inventory_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
    environment:
      DATABASE_URL: postgresql+psycopg://inventory:${POSTGRES_PASSWORD:-inventory}@db:5432/inventory
      LOG_LEVEL: debug
    ports:
      - "127.0.0.1:8000:8000"
    depends_on:
      db:
        condition: service_healthy
        restart: true
    develop:
      watch:
        - action: sync
          path: ./src
          target: /app/src
        - action: rebuild
          path: uv.lock
        - action: rebuild
          path: pyproject.toml

volumes:
  pgdata:
```

## What each part is for

### Service names are hostnames

Compose creates a network for the project and attaches every service to it, with DNS by service name. That's why `DATABASE_URL` uses `@db:5432`. It's the service name and the **container** port, not `localhost` and not the published port. The `ports:` entry on `db` is only there so tools on my Mac (`psql`, a GUI client, or pytest run outside Docker) can reach it at `localhost:5432`.

The URL scheme `postgresql+psycopg://` tells SQLAlchemy to use psycopg 3. A bare `postgresql://` makes SQLAlchemy pick its default driver, psycopg2, which I haven't installed.

### Healthcheck plus `depends_on`

A plain `depends_on: [db]` only waits for the db *container to start*. Postgres then spends a few seconds initialising (much longer on the very first run, when it creates the database), and an API that connects immediately crashes.

`condition: service_healthy` makes Compose wait until the healthcheck passes. `pg_isready` checks that the server is accepting connections. A few details:

- `$${POSTGRES_USER}`: the doubled `$` stops Compose interpolating the variable when it reads the file, so the shell inside the container expands it instead.
- `start_period` gives Postgres time to initialise before failed checks count against `retries`, and `start_interval` checks more often during that window, so a healthy database is noticed within about a second (needs Docker Engine 25 or newer).
- `restart: true` restarts the API if Compose restarts the database, for example after I change its configuration.

This only orders start-up. The app should still retry or fail clearly if the database goes away later; Compose won't save it then.

### The named volume

`pgdata` keeps data across `docker compose down` and `up`. Note the mount path, `/var/lib/postgresql`: it's correct for `postgres:18` and later, whereas older tutorials use `/var/lib/postgresql/data` (see the volumes note).

### Environment variables: two different mechanisms

This trips everyone up:

1. **Interpolation**: `${POSTGRES_PASSWORD:-inventory}` is replaced when Compose *reads the file*, using my shell environment or a `.env` file next to `compose.yaml`. `:-inventory` is the fallback.
2. **Container environment**: the `environment:` (or `env_file:`) block sets variables *inside the container*.

A `.env` file feeds the first, not the second, unless I also reference it with `env_file:`. `docker compose config` prints the file with everything resolved, which is the quickest way to see what Compose actually thinks.

The default password is fine because the database is only reachable from my machine. Real secrets don't go in `compose.yaml`, and `.env` goes in `.gitignore`.

## A fast edit loop: Compose Watch

The production Dockerfile installs the package non-editable and copies only the virtual environment, which is great for image size but useless for live editing. For development I use a `Dockerfile.dev`: the single-stage version from the Dockerfile note, where `uv sync` installs my package in editable mode from `/app/src`.

Then `develop.watch` handles the rest:

- **`sync`** copies changed files from `./src` into `/app/src` in the running container. uvicorn's `--reload` notices and restarts the worker in about a second.
- **`rebuild`** rebuilds the image and replaces the container when dependencies change, because new packages need a new `uv sync` layer.

```sh
docker compose up --watch     # start everything and watch, logs mixed together
# or, in a second terminal after `docker compose up -d`:
docker compose watch
```

The image needs `stat`, `mkdir` and `rmdir` available, and the container user must be able to write to the target path. `python:3.14-slim` is fine on both counts.

### The bind-mount alternative

```yaml
    volumes:
      - ./src:/app/src
```

This also works, and it's what most older guides show. The trap is mounting the whole project (`.:/app`): that hides the `/app/.venv` the image built and replaces it with my Mac's `.venv`, or with nothing. If I bind-mount, I mount only `src`.

## Everyday commands

```sh
docker compose up -d --build           # start in the background, rebuilding images
docker compose ps                      # status, including health
docker compose logs -f api             # follow one service
docker compose exec db psql -U inventory   # shell into the running database
docker compose run --rm api alembic upgrade head   # one-off migration container
docker compose down                    # stop and remove containers and network; keep volumes
docker compose down -v                 # ...and delete pgdata: a clean database
```

## Gotchas

- **`localhost` in `DATABASE_URL` inside a container.** That's the API container itself. Use the service name.
- **Changing `POSTGRES_PASSWORD` after the first run.** It's only applied when the data directory is empty. Either change it in SQL or run `down -v`.
- **Thinking `depends_on` alone waits for readiness.** It doesn't without `condition: service_healthy` and a healthcheck.
- **Leaving `version: "3.8"` at the top.** It's obsolete; delete it.
- **`docker-compose` with a hyphen** is the old v1 tool. Use `docker compose`.
- **Running the production image with Watch.** Syncing into `/app/src` does nothing when the package is installed non-editable in `.venv`.

## Check yourself

1. Why does the API use `db:5432` while `psql` on my Mac uses `localhost:5432`?
2. What does `condition: service_healthy` add over a plain `depends_on`, and what does it still not protect against?
3. Why is `$${POSTGRES_USER}` written with two dollar signs?
4. What's the difference between a `.env` file and an `env_file:` entry?
5. Why does the watch config sync `src` but rebuild on `uv.lock`?

## Further reading

- [Docker Compose documentation](https://docs.docker.com/compose/)
- [Compose: control start-up order](https://docs.docker.com/compose/how-tos/startup-order/)
- [Compose: use Compose Watch](https://docs.docker.com/compose/how-tos/file-watch/)
- [Compose: environment variables](https://docs.docker.com/compose/how-tos/environment-variables/)
- [Compose file reference: services](https://docs.docker.com/reference/compose-file/services/)
- [uv: using uv in Docker, including Compose Watch](https://docs.astral.sh/uv/guides/integration/docker/)
