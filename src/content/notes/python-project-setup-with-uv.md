---
title: Python project setup with uv
summary: Starting a service as a uv project - pyproject.toml, the src layout, dependency groups, the lockfile, and the handful of commands that keep laptop, Docker and CI in sync.
technologies: [python]
topics: [setup, best-practices]
updated: 2026-11-20
---

For ML work I've lived with `requirements.txt`, conda environments and the occasional `pip freeze`. For a service that has to install identically on my laptop, in a Docker image and on a CI runner, I want one tool that manages the interpreter, the virtual environment, dependencies and a lockfile. That tool is [uv](https://docs.astral.sh/uv/). It replaces pip, pip-tools, virtualenv and pyenv for my purposes, and it's fast enough that reinstalling from scratch is no longer something to avoid.

## The mental model

There are three layers, and most confusion comes from mixing them up:

- **`pyproject.toml`** says what the project *needs*: version ranges such as `sqlalchemy>=2.1`. I edit this (or let `uv add` edit it).
- **`uv.lock`** records exactly what was *resolved*: every package, transitive ones included, at one version with hashes, for every platform. uv writes this; I commit it and never edit it by hand.
- **`.venv`** is what is *installed* on this machine. It's disposable and never committed.

`uv lock` goes from the first to the second, and `uv sync` from the second to the third. `uv run` does both if needed and then runs a command inside the environment.

## Creating the project

```sh
uv init --package inventory-api
cd inventory-api
uv python pin 3.14
```

`--package` gives a **src layout** (`src/inventory_api/`) and a `[build-system]` table, so the project is installed into its own environment like any other package. Without it, uv makes a simpler "application" project with no build system. I prefer the src layout for services because tests then import the *installed* package rather than whatever happens to be in the working directory, which catches packaging mistakes early.

`uv python pin` writes `.python-version`. The next `uv sync` or `uv run` downloads that interpreter if it isn't already installed, so there's no separate pyenv step. I'm using 3.14 as the conservative choice; 3.15 is out, but I'd rather wait until the libraries I depend on publish wheels for it.

The generated `pyproject.toml` looks roughly like this once I've added dependencies:

```toml
[project]
name = "inventory-api"
version = "0.1.0"
requires-python = ">=3.14"
dependencies = [
    "sqlalchemy>=2.1",
    "psycopg[binary]>=3.3",
]

[project.scripts]
inventory-api = "inventory_api:main"

[dependency-groups]
dev = [
    "pytest>=9.2",
    "ruff>=0.17",
]

[build-system]
requires = ["uv_build>=0.13,<0.14"]
build-backend = "uv_build"
```

I tighten `requires-python` to the version I actually test against. The generated value is often looser than what I use, and it affects how uv resolves the lockfile.

## Managing dependencies

```sh
uv add sqlalchemy "psycopg[binary]"   # runtime dependency
uv add --dev pytest ruff              # goes into [dependency-groups] dev
uv remove ruff
uv lock --upgrade-package sqlalchemy  # bump one package within its range
uv tree                               # see why something is installed
```

Dependency groups (PEP 735) are for things the project needs to develop but not to run: test runners, linters, type checkers. `uv sync` installs the `dev` group by default; `uv sync --no-dev` leaves it out, which is what I want in a production image.

## The everyday commands

```sh
uv sync            # make .venv match uv.lock exactly, removing anything else
uv run pytest      # run a command in the project environment
uv run inventory-api
uvx ruff check .   # run a tool in a throwaway environment, outside the project
```

I don't activate the virtual environment any more. `uv run` checks the lockfile is up to date, syncs if needed, and runs the command, so I never run tests against a stale environment. If I need an interactive shell in the environment, `source .venv/bin/activate` still works.

## Locked versus frozen

Two flags matter in CI and Docker:

- `uv sync --locked` fails if `uv.lock` doesn't match `pyproject.toml`. This is what I want in CI: someone changed a dependency and forgot to commit the lockfile, and the build should say so.
- `uv sync --frozen` uses the lockfile as-is without checking it against `pyproject.toml`. It's useful in a Dockerfile layer that only has `uv.lock` available, before the rest of the source is copied in.

## Tool configuration lives in pyproject.toml too

```toml
[tool.ruff]
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP"]

[tool.pytest]
testpaths = ["tests"]
addopts = ["-ra", "--strict-markers"]
```

`[tool.pytest]` with native TOML types is new in pytest 9; older guides use `[tool.pytest.ini_options]`, which still works.

## Gotchas

- **Not committing `uv.lock`.** For an application, the lockfile *is* the reproducibility. Commit it. (A library you publish to PyPI is different: users resolve their own versions.)
- **`uv pip install` inside a project.** It works, but it bypasses the lockfile, so the next `uv sync` will remove what it installed. Use `uv add`.
- **Copying `.venv` into Docker.** The environment contains absolute paths and platform-specific wheels. Add `.venv` to `.dockerignore` and let the image build its own.
- **Forgetting the src layout in imports.** With `--package`, the import name is `inventory_api` (underscore), and code must live under `src/inventory_api/`. Running `python some_file.py` from the repository root skips the installed package; use `uv run` or `python -m`.
- **Over-tight runtime pins.** `pyproject.toml` should say what I'm compatible with (`>=2.1`), not one exact version. The lockfile does the exact pinning.

## Check yourself

1. What's the difference between `uv lock`, `uv sync` and `uv run`, and which files does each touch?
2. Why does CI use `uv sync --locked` instead of plain `uv sync`?
3. When would I reach for `--frozen` instead of `--locked`?
4. What problem does the src layout prevent in tests?
5. Where should pytest and ruff be declared, and how do I keep them out of a production image?

## Further reading

- [uv: working on projects](https://docs.astral.sh/uv/guides/projects/)
- [uv: locking and syncing](https://docs.astral.sh/uv/concepts/projects/sync/)
- [uv: managing dependencies](https://docs.astral.sh/uv/concepts/projects/dependencies/)
- [Python Packaging User Guide: writing pyproject.toml](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/)
- [pytest: configuration](https://docs.pytest.org/en/stable/reference/customize.html)
