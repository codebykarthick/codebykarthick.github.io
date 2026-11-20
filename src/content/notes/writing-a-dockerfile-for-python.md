---
title: Writing a Dockerfile for a Python service
summary: From a naive Dockerfile to a cache-friendly, multi-stage, non-root image for a uv project, with the reasoning behind each line.
technologies: [docker, python]
topics: [images, best-practices, security]
updated: 2026-11-20
---

The goal is an image for the inventory API that rebuilds in seconds when I change code, contains only what it needs to run, and doesn't run as root. I'm assuming a uv project with a src layout (see the uv setup note) and an ASGI app served by uvicorn at `inventory_api.main:app`.

## The naive version, and why it's slow

```dockerfile
FROM python:3.14-slim
WORKDIR /app
COPY . .
RUN pip install uv && uv sync
CMD uvicorn inventory_api.main:app --host 0.0.0.0
```

It works, but it has three problems:

1. `COPY . .` comes before the install, so **any** code change invalidates the cache and reinstalls every dependency.
2. The shell-form `CMD` runs under `/bin/sh -c`, so uvicorn isn't PID 1 and never receives `SIGTERM`. `docker stop` waits 10 seconds and then kills it.
3. It ships uv, the build cache and dev dependencies, and runs as root.

## Rule one: order layers from least to most frequently changed

Docker reuses a cached layer only if the instruction *and every layer before it* are unchanged. Dependencies change weekly; code changes every few minutes. So install dependencies from the lockfile first, then copy the code:

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.14-slim

COPY --from=ghcr.io/astral-sh/uv:0.13.9 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_DEV=1 \
    UV_PYTHON_DOWNLOADS=0

WORKDIR /app

# 1. Dependencies only: this layer is cached until uv.lock or pyproject.toml changes
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project

# 2. The project itself: cheap, because dependencies are already installed
COPY . /app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked

ENV PATH="/app/.venv/bin:$PATH"
CMD ["uvicorn", "inventory_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

What each piece is doing:

- **`COPY --from=ghcr.io/astral-sh/uv:...`** copies the uv binary out of Astral's image. It's quicker and more reproducible than `pip install uv`, and pinning the version keeps builds stable.
- **`--mount=type=bind`** makes `uv.lock` and `pyproject.toml` visible to that one `RUN` without copying them into a layer, so the layer's cache key depends on exactly those files.
- **`--no-install-project`** installs dependencies but not my package, because the source isn't there yet.
- **`--mount=type=cache`** is a BuildKit cache that persists between builds but never ends up in the image. Even when the lockfile changes, uv only downloads what's new.
- **`UV_LINK_MODE=copy`** stops uv warning that it can't hard-link from the cache mount into the environment, since they're on different filesystems.
- **`UV_COMPILE_BYTECODE=1`** writes `.pyc` files at build time, so the first request after start-up doesn't pay for it.
- **`UV_NO_DEV=1`** leaves out the `dev` dependency group (pytest, ruff).
- **`UV_PYTHON_DOWNLOADS=0`** makes uv use the image's Python rather than downloading its own.
- **Exec-form `CMD`** (a JSON array) runs uvicorn directly as PID 1, so it gets `SIGTERM` and shuts down gracefully.
- **`--host 0.0.0.0`**: inside a container, listening on `127.0.0.1` means only the container itself can connect, and published ports won't work.

## Rule two: keep the build context small

`COPY . /app` sends whatever is in the directory. A `.dockerignore` keeps local junk out of both the context and the cache key:

```text
.venv
.git
__pycache__/
*.pyc
.pytest_cache
.ruff_cache
.env
compose.yaml
Dockerfile
```

`.venv` is the important one. Copying a macOS virtual environment into a Linux image breaks in confusing ways, and it would overwrite the environment the build just created. `.env` matters too, because it usually contains secrets.

## The production version: multi-stage and non-root

A multi-stage build uses one stage to build and a second, clean stage to run. Only what I copy across ends up in the final image.

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.14-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.13.9 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_DEV=1 UV_PYTHON_DOWNLOADS=0
WORKDIR /app

RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project --no-editable

COPY . /app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-editable

FROM python:3.14-slim AS runtime
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --no-create-home app

COPY --from=builder --chown=app:app /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

USER app
WORKDIR /app
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"]

CMD ["uvicorn", "inventory_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

What changed:

- **`--no-editable`** installs my package into `.venv` as a normal package rather than a link back to `/app/src`. The virtual environment is then self-contained, so the runtime stage needs only `.venv`, not the source tree.
- **The runtime stage has no uv**, no build cache and no compilers. If a dependency needed `gcc` to build a wheel, I'd install it in the builder stage only.
- **A non-root user.** If someone exploits the app, they land as an unprivileged user rather than root inside the container. `--chown` on the `COPY` makes sure that user can read the environment.
- **`PYTHONUNBUFFERED=1`** stops `print` output sitting in a buffer when stdout isn't a terminal, so logs appear immediately.
- **`HEALTHCHECK`** lets Docker and Compose report the container as healthy or unhealthy. The slim image has no `curl`, so the check uses Python's standard library. Kubernetes ignores `HEALTHCHECK` and uses its own probes.
- **`EXPOSE`** is documentation only. It doesn't publish anything; `-p` does.

```sh
docker build -t inventory-api:dev .
docker run --rm inventory-api:dev id          # uid=10001(app) ...
docker image ls inventory-api                 # compare sizes with the single-stage build
docker scout quickview inventory-api:dev      # or: trivy image inventory-api:dev
```

## Gotchas

- **Different base images across stages.** The virtual environment points at the builder's Python by absolute path. The runtime stage must use the same Python image and version, or every console script fails with "no such file or directory".
- **Files outside the package.** With `--no-editable`, only what's inside `src/inventory_api/` is installed. `alembic.ini` and a top-level `migrations/` folder need their own `COPY`, or should live inside the package.
- **Secrets in build arguments or layers.** `ARG` values and copied files are visible in the image history. Use `RUN --mount=type=secret` for build-time secrets, and environment variables at run time.
- **`apt-get` hygiene.** Run `apt-get update && apt-get install -y --no-install-recommends ... && rm -rf /var/lib/apt/lists/*` in one `RUN`, so the cleanup actually reduces the layer.
- **Forgetting the syntax line.** `# syntax=docker/dockerfile:1` opts into the latest stable Dockerfile frontend, which keeps `--mount` features available regardless of the local Docker version.

## Check yourself

1. Why does copying the source *after* installing dependencies make rebuilds faster?
2. What does `--no-editable` change, and why does the runtime stage depend on it?
3. Why does a shell-form `CMD` make `docker stop` take 10 seconds?
4. What would break if the builder used `python:3.14-slim` and the runtime used `python:3.13-slim`?
5. Why is `.venv` in `.dockerignore` even though the build creates one?

## Further reading

- [uv: using uv in Docker](https://docs.astral.sh/uv/guides/integration/docker/)
- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
- [Docker: building best practices](https://docs.docker.com/build/building/best-practices/)
- [Docker: multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
- [Docker: build cache optimisation](https://docs.docker.com/build/cache/optimize/)
