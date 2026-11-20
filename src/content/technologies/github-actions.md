---
name: GitHub Actions
summary: CI/CD for my Go repositories - vet, lint, race-checked tests against real Postgres and vulnerability checks on every pull request, then publishing images.
status: learning
started: 2026-11-20
links:
  docs: https://docs.github.com/en/actions
  repo: https://github.com/actions/runner
language: []
lifecycle: [test, deploy]
domain: [devops]
kind: [platform]
prerequisites: [docker, go]
roadmap:
  - title: Anatomy and first workflow
    goal: Read any workflow file and predict when it runs, where, and in what order.
    apply: "InferenceFlow P13: delivery, deployment and lifecycle management (the CI pipeline)"
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
  - title: CI for a Go module
    goal: Run formatting, vet, lint, race-checked tests and vulnerability checks on every push and pull request, fast and cached.
    apply: "InferenceFlow P13: delivery, deployment and lifecycle management (formatting, vet, tests, -race and security audit jobs)"
    learn:
      - actions/setup-go, its module and build cache, and check-latest
      - gofmt -l, go mod tidy -diff and go vet as cheap first checks
      - golangci-lint v2 through golangci-lint-action with a pinned linter version
      - go test -race -count=1 and what the race detector can and can't prove
      - govulncheck, and why it should run on the newest patch release
      - A matrix over the two supported Go versions, the go line in go.mod and GOTOOLCHAIN=local
    practice:
      - Add a lint job that fails on an unformatted file and on an untidy go.mod
      - Add a test matrix over Go 1.27 and 1.26 and confirm each entry really uses its own toolchain
      - Add a govulncheck job pinned to a specific release
    doneWhen:
      - A pull request shows separate lint, vuln and test checks, plus one summary check to require
      - A second run with unchanged go.sum restores the setup-go cache
    notes: [go-ci-with-postgres-service-containers]
  - title: Service containers for Postgres-backed tests
    goal: Run the integration suite against a real PostgreSQL in CI, matching local development.
    apply: "InferenceFlow P13: delivery, deployment and lifecycle management (integration tests in CI), once P4's integration tests exist"
    learn:
      - The services key, health options and port mapping
      - Hostnames when the job runs on the runner (localhost) versus in a container (service label)
      - Running goose migrations as a step before go test, with DATABASE_URL in the job environment
      - Service containers only work on Linux runners
    practice:
      - Add a postgres:18 service with a pg_isready health check to the test job
      - Run goose up and then the integration tests against the service
      - Break a migration on a branch and confirm CI fails at the migration step, not in a test
    doneWhen:
      - The same tests pass locally against the Compose test database and in CI against the service container
      - I know why the job waits for the service to report healthy
    notes: []
  - title: Building and publishing Docker images
    goal: Build the image on every pull request and publish versioned, multi-platform tags to GitHub Container Registry from main and release tags.
    apply: "InferenceFlow P13: delivery, deployment and lifecycle management (the build job and version-pinned images)"
    learn:
      - GHCR and authenticating with GITHUB_TOKEN plus permissions packages write
      - docker/metadata-action for tags, OCI labels and a version to stamp into the binary
      - Buildx and docker/build-push-action, building without pushing on pull requests
      - The gha cache backend (mode=max), and why BuildKit cache mounts aren't part of it
      - Multi-platform images built by Go cross-compilation rather than QEMU
    practice:
      - Add a workflow that builds the Go service image on pull requests without pushing
      - Push to GHCR on main with branch, sha and semver tags, for linux/amd64 and linux/arm64
      - Add a smoke-test job that loads the image and waits for /healthz
    doneWhen:
      - A merge to main produces a pullable image tagged with the commit SHA, with its digest on the run summary
      - A tag such as v0.1.0 produces 0.1.0 and 0.1 image tags
    notes: [building-and-pushing-docker-images-with-actions]
  - title: Security, permissions and reuse
    goal: Harden workflows against supply-chain and injection risks, and stop copy-pasting YAML between repositories.
    apply: "InferenceFlow P13: delivery, deployment and lifecycle management (secret injection and the security audit)"
    learn:
      - Least-privilege GITHUB_TOKEN permissions, set at workflow level and raised per job
      - Pinning third-party actions to a full commit SHA, kept fresh by Dependabot with a cooldown
      - Script injection through untrusted context values, and the risks of pull_request_target
      - Environments, protection rules and OIDC instead of long-lived cloud secrets
      - Reusable workflows (workflow_call) versus composite actions
    practice:
      - Set permissions contents read at the top of every workflow and fix what breaks
      - Pin every action by SHA and add a Dependabot config for github-actions, gomod and docker
      - Extract Go setup into a composite action and the CI job into a reusable workflow
    doneWhen:
      - zizmor reports no medium or high findings
      - Two jobs share setup through one composite action instead of duplicated steps
    notes: [github-actions-security-and-reuse]
resources:
  - title: GitHub Actions documentation
    url: https://docs.github.com/en/actions
    kind: docs
  - title: Workflow syntax reference
    url: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
    kind: docs
  - title: Building and testing Go
    url: https://docs.github.com/en/actions/tutorials/build-and-test-code/go
    kind: tutorial
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

In ML work I've mostly treated CI as something that already exists: tests run, a badge goes green, someone else maintains the YAML. For backend services that isn't good enough. The pipeline is what turns "it works on my machine" into "it works", and for a database-backed Go service that means race-checked tests against a real PostgreSQL, not a mock. It's also what builds and publishes the container image, so it sits directly in the path to production.

GitHub Actions is where my code already lives, so it's the obvious platform. I want to understand it well enough to write workflows from scratch, keep them fast, and keep them secure, since a workflow with write access to packages is a real supply-chain target.

## How it fits with the rest of my stack

GitHub Actions is where everything else gets checked and shipped. It runs the same Go commands I use locally (`gofmt`, `go vet`, `go test -race`, govulncheck), so the Go toolchain and testing habits need to be solid first. It starts a `postgres:18` service container for the integration tests, the same image I run in Docker Compose, and applies goose migrations before the tests, just as Compose does locally. And it builds the Dockerfile from the Docker roadmap and pushes the result to GitHub Container Registry. That is why Docker and Go are prerequisites: Actions mostly orchestrates tools I need to understand on their own first.

InferenceFlow's plan lists the CI jobs it wants in P13: formatting, tests, `-race`, vet, a security audit, compatibility checks, build, integration tests and a small smoke load test. This roadmap covers the general skills behind most of those.

## How to use this roadmap

1. **Anatomy and first workflow**: half a day, in a scratch repository so failed runs don't clutter real history.
2. **CI for a Go module**: one day. Nothing stops me running a minimal vet-and-test workflow long before P13; it's cheap once the module exists.
3. **Service containers for Postgres-backed tests**: one day, after there are real integration tests to run.
4. **Building and publishing Docker images**: one to two days, alongside the Docker production-images stage.
5. **Security, permissions and reuse**: one to two days. Don't skip it; most of it is cheap to do once and painful to retrofit.

Each stage's `apply` line names the InferenceFlow phase where it's used; the workflows in the notes are illustrative, and I validated them with actionlint rather than copying them from that repository.
