---
name: Python
summary: "My main language from ML work. This roadmap covers the backend side: packaging, typing, testing, small services and concurrency."
status: comfortable
started: 2026-11-20
links:
  docs: https://docs.python.org/3/
  repo: https://github.com/python/cpython
language: []
lifecycle: [build, test]
domain: [backend, data, ml]
kind: [language]
prerequisites: []
roadmap:
  - title: Project setup and packaging
    goal: Start any new service as a reproducible uv project that a teammate, a container or a CI runner can install identically.
    learn:
      - pyproject.toml as the single home for metadata, dependencies and tool config
      - The src layout, and why it stops tests passing by accident against the working directory
      - Lockfiles (uv.lock) versus version ranges in pyproject.toml
      - Dependency groups for dev-only tools such as pytest and ruff
      - Pinning the interpreter with .python-version and requires-python
    practice:
      - Create the inventory API skeleton with uv init --package, add a runtime and a dev dependency, and commit the lockfile
      - Delete .venv, run uv sync --locked, and confirm everything still works
      - Expose a console script entry point in [project.scripts] and run it with uv run
    doneWhen:
      - A fresh clone needs only uv sync to get a working environment
      - I can explain the difference between uv lock, uv sync and uv run
    notes: [python-project-setup-with-uv]
  - title: Typing and code quality
    goal: Keep a growing service readable and catch whole classes of bugs before running anything.
    learn:
      - Type hints for functions, generics (PEP 695 syntax) and Protocols for structural typing
      - Dataclasses versus Pydantic models, and where each belongs in a service
      - Ruff as linter and formatter, configured in pyproject.toml
      - A static type checker (mypy or pyright) in strict mode on new code
    practice:
      - Turn on ruff with a sensible rule set and fix or explicitly ignore every finding
      - Run mypy --strict on the service package and remove every Any that leaks out of a public function
      - Model a request payload once as a dataclass and once as a Pydantic model, and note the differences
    doneWhen:
      - ruff check, ruff format --check and the type checker all pass locally and in CI
      - Public functions in the service are fully annotated
    notes: []
  - title: Testing with pytest
    goal: Write fast, isolated tests and know when a test needs a real database.
    learn:
      - Test discovery, plain assert and readable failure output
      - Fixtures, fixture scopes and conftest.py for sharing setup
      - Parametrize for table-driven tests
      - monkeypatch and tmp_path for environment variables and files
      - Unit tests versus integration tests against real dependencies
    practice:
      - Write parametrised tests for a pure stock-calculation function, including edge cases
      - Build a session-scoped fixture that reads DATABASE_URL and a function-scoped one that yields a clean state
      - Configure pytest in pyproject.toml with testpaths and strict markers
    doneWhen:
      - uv run pytest runs the whole suite in seconds
      - I can say which tests would break if Postgres were swapped for SQLite, and why I don't do that
    notes: [testing-sqlalchemy-code-with-pytest-and-postgres]
  - title: Building a small service
    goal: Structure a small HTTP service the way backend teams expect, with configuration and logs that work in containers.
    learn:
      - Twelve-factor configuration from environment variables, validated at start-up
      - The logging module, log levels, and logging to stdout for containers
      - Separating the HTTP layer, domain logic and database access
      - Graceful start-up and shutdown, and a health endpoint
    practice:
      - Add a settings object that fails fast when DATABASE_URL is missing
      - Configure logging once at start-up and replace every print with a logger call
      - Add a /health endpoint that checks the database connection
    doneWhen:
      - The service runs with no config files, only environment variables
      - Logs show level, logger name and message, and no secrets
    notes: [sqlalchemy-engine-connection-session]
  - title: Concurrency basics
    goal: Choose between sync, threads and asyncio for a database-backed service, with reasons rather than habit.
    learn:
      - I/O-bound versus CPU-bound work, and what the GIL does and does not limit
      - Threads and thread pools for blocking I/O
      - asyncio, the event loop, and why one blocking call stalls everything
      - How connection pool size bounds real database concurrency
      - The free-threaded build (supported since 3.14) and why it doesn't change the I/O story
    practice:
      - Time 50 slow HTTP calls sequentially, with a ThreadPoolExecutor and with asyncio.gather
      - Put a blocking time.sleep inside an async handler and watch request latency climb
      - Load-test the service with a pool of 5 connections and observe where requests queue
    doneWhen:
      - I can justify sync or async for the inventory API in two sentences
      - I know where requests wait when the connection pool is exhausted
    notes: [sqlalchemy-engine-connection-session]
  - title: Shipping the service
    goal: Run the same project unchanged in a container and in CI.
    learn:
      - Installing a uv project inside a Docker image
      - Running lint, type checks and tests in GitHub Actions against a real Postgres
    practice:
      - Build an image for the service and run it against Postgres in Compose
      - Get a green CI run on a pull request
    doneWhen:
      - The project installs the same way on my laptop, in Docker and in CI
    notes: [writing-a-dockerfile-for-python, python-ci-with-postgres-service-containers]
resources:
  - title: The Python tutorial and library reference
    url: https://docs.python.org/3/
    kind: docs
  - title: uv documentation
    url: https://docs.astral.sh/uv/
    kind: docs
  - title: Python typing documentation
    url: https://typing.python.org/en/latest/
    kind: docs
  - title: pytest documentation
    url: https://docs.pytest.org/en/stable/
    kind: docs
  - title: Ruff documentation
    url: https://docs.astral.sh/ruff/
    kind: tool
  - title: asyncio documentation
    url: https://docs.python.org/3/library/asyncio.html
    kind: docs
---

## Why I'm learning it

I already write Python every day, but almost all of it is ML code: notebooks, training scripts and pipelines where the process starts, does a lot of work and exits. Backend services are different. They run for weeks, handle many small requests at once, hold database connections, and have to be installed the same way on a laptop, in a container and in CI. The language is the same; the habits are not.

This roadmap is about those habits: packaging a project properly, leaning on types and linters as a service grows, testing against real dependencies, configuring through the environment, and understanding concurrency well enough to pick sync or async on purpose. My Java and Spring background helps here, because most of these ideas (dependency management, layered services, connection pools) have direct equivalents. Part of the work is learning the Python names for things I already know.

## How it fits with the rest of my stack

Python is the language everything else in this learning path is used from. SQLAlchemy is the Python toolkit I'm using to talk to PostgreSQL, so the typing and testing stages feed straight into it. Docker packages the Python service, which is why the project setup stage leans on uv and a lockfile: a reproducible install is what makes a small, cacheable image possible. GitHub Actions runs the same uv commands I run locally, so if `uv sync --locked` and `uv run pytest` work on my machine they should work in CI.

## How to use this roadmap

Since I'm already comfortable with the language, the stages are short:

1. **Project setup and packaging**: half a day. Do this first; every other roadmap assumes it.
2. **Typing and code quality**: a day to set up, then ongoing.
3. **Testing with pytest**: one to two days. Revisit after the SQLAlchemy testing stage.
4. **Building a small service**: two to three days, alongside the Docker Compose stage.
5. **Concurrency basics**: two days. Best done once the service talks to a real database, so the pool experiments mean something.
6. **Shipping the service**: covered by the Docker and GitHub Actions roadmaps; this stage is the checkpoint.

All of it gets applied in the inventory API project, which grows a stage at a time rather than waiting until the end.
