---
name: GitHub Actions
summary: CI/CD for my Python repos - lint and test against real Postgres on every pull request, then build and publish Docker images.
status: learning
started: 2026-11-20
links:
  docs: https://docs.github.com/en/actions
  repo: https://github.com/actions/runner
language: []
lifecycle: [test, deploy]
domain: [devops]
kind: [platform]
prerequisites: [docker, python]
roadmap:
  - title: Anatomy and first workflow
    goal: Read any workflow file and predict when it runs, where, and in what order.
    learn:
      - Workflows, events, jobs, steps, runners and actions, and how they nest
      - Triggers such as push, pull_request and workflow_dispatch, with branch and path filters
      - Each job runs on a fresh runner; jobs run in parallel unless linked with needs
      - Expressions, contexts (github, env, matrix, secrets) and passing outputs via GITHUB_OUTPUT
      - Concurrency groups for cancelling superseded runs
    practice:
      - Write a hello-world workflow that runs on push and manual dispatch and prints values from the github context
      - Add a second job that needs the first and consumes one of its outputs
      - Push twice quickly and watch concurrency cancel the older run
    doneWhen:
      - I can explain why a step's environment variable isn't visible in the next job
      - actionlint reports nothing on my workflow files
    notes: [github-actions-anatomy]
  - title: CI for a Python project
    goal: Get lint, type checks and tests running on every push and pull request, fast and cached.
    learn:
      - astral-sh/setup-uv, its built-in cache and python-version input
      - uv sync --locked so CI fails when the lockfile is stale
      - Matrix builds across Python versions, and fail-fast
      - Splitting lint and test into separate jobs for faster feedback
    practice:
      - Add a lint job running ruff check and ruff format --check
      - Add a test job with a matrix over two Python versions
      - Break the lockfile on a branch and confirm CI catches it
    doneWhen:
      - A pull request shows separate lint and test checks
      - A second run with unchanged dependencies restores the uv cache
    notes: [python-ci-with-postgres-service-containers]
  - title: Service containers for Postgres-backed tests
    goal: Run the integration suite against a real PostgreSQL in CI, matching local development.
    learn:
      - The services key, health options and port mapping
      - Hostnames when the job runs on the runner (localhost) versus in a container (service name)
      - Passing DATABASE_URL to tests and running migrations before them
      - Service containers only work on Linux runners
    practice:
      - Add a postgres:18 service with a pg_isready health check to the test job
      - Run Alembic migrations and then pytest against the service
      - Make a test depend on a Postgres-only feature and confirm it passes in CI
    doneWhen:
      - The same tests pass locally against Compose and in CI against the service container
      - I know why the job waits for the service to report healthy
    notes: [python-ci-with-postgres-service-containers, testing-sqlalchemy-code-with-pytest-and-postgres]
  - title: Building and publishing Docker images
    goal: Build the image on every pull request and publish versioned tags to GitHub Container Registry from main and release tags.
    learn:
      - GHCR and authenticating with GITHUB_TOKEN plus permissions packages write
      - docker/metadata-action for tags and OCI labels
      - Buildx and docker/build-push-action, building without pushing on pull requests
      - The GitHub Actions cache backend for BuildKit (type=gha, mode=max)
    practice:
      - Add a workflow that builds the inventory API image on pull requests without pushing
      - Push to GHCR on main with branch, sha and semver tags
      - Compare build times with and without the gha cache
    doneWhen:
      - A merge to main produces a pullable image tagged with the commit SHA
      - A tag such as v0.1.0 produces 0.1.0 and 0.1 image tags
    notes: [building-and-pushing-docker-images-with-actions]
  - title: Security, permissions and reuse
    goal: Harden workflows against supply-chain and injection risks, and stop copy-pasting YAML between repos.
    learn:
      - Least-privilege GITHUB_TOKEN permissions, set at workflow level and raised per job
      - Pinning third-party actions to a full commit SHA, kept fresh by Dependabot
      - Script injection through untrusted context values, and the risks of pull_request_target
      - Environments, protection rules and OIDC instead of long-lived cloud secrets
      - Reusable workflows (workflow_call) versus composite actions
    practice:
      - Set permissions contents read at the top of every workflow and fix what breaks
      - Pin every action by SHA and add a Dependabot config for github-actions and uv
      - Extract the Python setup steps into a composite action and the CI job into a reusable workflow
    doneWhen:
      - zizmor or a similar audit reports no high-severity findings
      - Two jobs share setup through one composite action instead of duplicated steps
    notes: [github-actions-security-and-reuse]
resources:
  - title: GitHub Actions documentation
    url: https://docs.github.com/en/actions
    kind: docs
  - title: Workflow syntax reference
    url: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
    kind: docs
  - title: Using uv in GitHub Actions
    url: https://docs.astral.sh/uv/guides/integration/github/
    kind: docs
  - title: Docker Build GitHub Actions
    url: https://docs.docker.com/build/ci/github-actions/
    kind: docs
  - title: Security hardening for GitHub Actions
    url: https://docs.github.com/en/actions/reference/security/secure-use
    kind: docs
  - title: actionlint
    url: https://github.com/rhysd/actionlint
    kind: tool
---

## Why I'm learning it

In ML work I've mostly treated CI as something that already exists: tests run, a badge goes green, someone else maintains the YAML. For backend services that isn't good enough. The pipeline is what turns "it works on my machine" into "it works", and for a database-backed service that means running tests against a real PostgreSQL, not a mock. It's also the thing that builds and publishes the container image, so it sits directly in the path to production.

GitHub Actions is where my code already lives, so it's the obvious platform. I want to understand it well enough to write workflows from scratch, keep them fast, and keep them secure, since a workflow with write access to packages is a real supply-chain target.

## How it fits with the rest of my stack

GitHub Actions is where everything else gets checked and shipped. It runs the same uv commands I use locally for Python, so the Python project setup stage needs to be solid first. It starts a PostgreSQL service container for the test suite, the same version I run in Docker Compose, so the SQLAlchemy tests behave identically in both places. And it builds the Dockerfile from the Docker roadmap and pushes the result to GitHub Container Registry. That is why Docker and Python are listed as prerequisites: Actions mostly orchestrates tools I need to understand on their own first.

## How to use this roadmap

1. **Anatomy and first workflow**: half a day. Worth doing in a scratch repo so failed runs don't clutter real history.
2. **CI for a Python project**: one day, once the Python project setup stage is done.
3. **Service containers for Postgres-backed tests**: one day, after the SQLAlchemy testing stage, so there are real integration tests to run.
4. **Building and publishing Docker images**: one to two days, alongside the Docker production-images stage.
5. **Security, permissions and reuse**: one to two days. Don't skip it; most of it is cheap to do once and painful to retrofit.

The inventory API project picks these up as its CI and image-publishing milestones, and its final hardening milestone is this roadmap's last stage applied to a real repository.
