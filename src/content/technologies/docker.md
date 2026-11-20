---
name: Docker
summary: Packaging Go services and their PostgreSQL dependency into containers, from first docker run to small, non-root, distroless images and a Compose stack.
status: learning
started: 2026-11-20
links:
  docs: https://docs.docker.com/
  repo: https://github.com/moby/moby
language: []
lifecycle: [build, deploy, operate]
domain: [devops, backend]
kind: [tool, platform]
prerequisites: []
roadmap:
  - title: Images and containers
    goal: Run, inspect and clean up containers confidently, and explain what an image actually is.
    apply: "InferenceFlow P4: PostgreSQL, SQL-first persistence and transactions (running Postgres locally in a container)"
    learn:
      - An image is a read-only stack of layers plus config; a container is a running process with a thin writable layer on top
      - Containers share the host kernel and are isolated with namespaces and cgroups; they are not VMs
      - Tags are mutable pointers, digests are immutable content addresses
      - On a Mac, Docker Desktop runs a Linux VM, and Apple silicon builds arm64 images by default
      - The container lifecycle (create, start, stop, remove) and why containers should be disposable
    practice:
      - Run postgres:18 and golang:1.27 interactively, then exec into the running Postgres container and open psql
      - Use docker image history and docker image inspect to see layers, entrypoint and environment
      - Write a file into a container's writable layer, remove the container, and confirm the file is gone
    doneWhen:
      - I can explain image, container, layer, tag and digest without notes
      - docker system df shows nothing I can't account for
    notes: [docker-images-containers-and-layers]
  - title: Writing Dockerfiles for Go
    goal: Build a Go service into a small, non-root image that rebuilds in seconds when only code changes.
    apply: "InferenceFlow P13: delivery, deployment and lifecycle management (multi-stage builds and minimal runtime images)"
    learn:
      - Core instructions (FROM, WORKDIR, COPY, RUN, ARG, ENTRYPOINT, CMD) and exec form versus shell form
      - Layer order, with go.mod and go.sum copied and modules downloaded before the source
      - BuildKit cache mounts for the module cache and the build cache
      - CGO_ENABLED=0, -trimpath and -ldflags for a static, reproducible binary with a version stamped in
      - Distroless static versus scratch, and what each leaves out (shell, CA certificates, time zone data, users)
      - Signals and PID 1, and why the binary must handle SIGTERM itself
    practice:
      - Write a multi-stage Dockerfile for a small Go HTTP service under cmd/api and compare it with a single-stage golang:1.27 image
      - Change one .go file, rebuild, and confirm the module download layer is cached
      - Add a -healthcheck flag to the binary and use it from an exec-form HEALTHCHECK
      - Cross-compile an amd64 image on an arm64 Mac with BUILDPLATFORM, TARGETOS and TARGETARCH
    doneWhen:
      - The final image is under 20 MB, has no shell and runs as a non-root user
      - docker stop returns well inside the 10-second timeout because the server drains and exits
    notes: [writing-a-dockerfile-for-go]
  - title: Volumes and networking
    goal: Persist data outside containers and connect containers to each other and to the host on purpose.
    apply: "InferenceFlow P4: PostgreSQL, SQL-first persistence and transactions (a local database whose data survives restarts)"
    learn:
      - Named volumes, bind mounts and tmpfs, and when each is right
      - The postgres:18 volume path, /var/lib/postgresql, and why older tutorials are wrong for it
      - Publishing ports with -p, and binding to 127.0.0.1 so databases aren't exposed to the network
      - User-defined bridge networks and DNS by container name
      - Why localhost inside a container means the container itself
    practice:
      - Run Postgres with a named volume, recreate the container and confirm the data survives
      - Put a Go API container and Postgres on one user-defined network and connect by container name
      - Run go test in a golang:1.27 container against a bind-mounted working copy
    doneWhen:
      - I can predict which hostname and port the app needs in each setup
      - Database data survives docker rm and a fresh docker run
    notes: [docker-volumes-and-networking]
  - title: Compose for multi-service development
    goal: Bring up the API, its migrations and Postgres with one command, with start-up ordering and a fast rebuild loop.
    apply: "InferenceFlow P4: PostgreSQL, SQL-first persistence and transactions (reproducible Postgres for integration tests), extended to the full stack in P13"
    learn:
      - compose.yaml services, networks, volumes and profiles, and the docker compose commands
      - Healthchecks plus depends_on with service_healthy and service_completed_successfully
      - Interpolation and .env files versus the container environment
      - A pgx DATABASE_URL, and which parameters belong to pgxpool rather than the server
      - Compose Watch rebuild actions for a compiled language
    practice:
      - Write compose.yaml with the API, postgres:18 and a goose migrate service that must finish before the API starts
      - Add a tmpfs-backed test database behind a profile and run the integration tests against it
      - Use docker compose watch so editing a .go file rebuilds and replaces the API container
    doneWhen:
      - docker compose up --wait gives a migrated database and a healthy API from a clean checkout
      - I know which of docker compose down and down -v I want, and why
    notes: [docker-compose-go-and-postgres]
  - title: Production-ready images
    goal: Ship a pinned, scanned, multi-platform image whose builds are fast and whose contents I can account for.
    apply: "InferenceFlow P13: delivery, deployment and lifecycle management (version-pinned images and migrations as a separate deployment step)"
    learn:
      - Pinning base images by digest and letting Dependabot propose updates
      - Multi-platform images and why Go cross-compiles instead of emulating
      - Image scanning, SBOMs and provenance attestations
      - go version -m and govulncheck -mode=binary on the shipped binary
      - Debugging containers that have no shell
    practice:
      - Pin golang and distroless by digest and compare a rebuild before and after a base image update
      - Scan the image with Docker Scout or Trivy and record each finding
      - Run govulncheck in binary mode against the binary copied out of the image
    doneWhen:
      - Every image I deploy is referenced by digest, and I can say which commit and module versions it contains
      - A scan reports no unexplained critical findings
    notes: []
resources:
  - title: Docker docs - get started
    url: https://docs.docker.com/get-started/
    kind: tutorial
  - title: Dockerfile reference
    url: https://docs.docker.com/reference/dockerfile/
    kind: docs
  - title: Building best practices
    url: https://docs.docker.com/build/building/best-practices/
    kind: docs
  - title: Multi-stage builds
    url: https://docs.docker.com/build/building/multi-stage/
    kind: docs
  - title: Distroless container images
    url: https://github.com/GoogleContainerTools/distroless
    kind: tool
  - title: Docker Compose documentation
    url: https://docs.docker.com/compose/
    kind: docs
---

## Why I'm learning it

Most of my ML work has run in environments someone else set up: a managed notebook, a training cluster, an environment that "works on my machine". Backend services can't rely on that. A service has to run identically on my laptop, in CI and in production, and its dependencies, a PostgreSQL database above all, have to come up the same way every time.

Go changes what Docker is for. A Go service compiles to one static binary, so the image itself can be tiny and boring. The interesting parts are a Dockerfile that rebuilds in seconds, a runtime image with no shell to exploit, and a local environment where Postgres, migrations and the API start in the right order with one command.

## How it fits with the rest of my stack

Docker sits between the code and everything that runs it. The Go roadmap comes first: a module, a `cmd/api` entry point and a server that shuts down cleanly on `SIGTERM`, because the container depends on all three. PostgreSQL runs as a container in development, with a named volume for its data, so I never install it on my Mac; the PostgreSQL notes cover the database itself. Compose wires the API to it through a `DATABASE_URL` that pgx reads, and runs goose migrations as a separate step. GitHub Actions then reuses all of this: the same `postgres:18` image as a CI service container, and the same Dockerfile built, cached and published to GitHub Container Registry.

For InferenceFlow, the [system-in-go](https://github.com/codebykarthick/system-in-go) project, the plan puts Docker Compose and automated CI in P13, with reproducible dependency setups arriving earlier, as soon as P4's integration tests need a real database.

## How to use this roadmap

1. **Images and containers**: one day. Mostly running and inspecting things; no Dockerfiles yet.
2. **Writing Dockerfiles for Go**: one to two days, once there is a Go service with a health endpoint to package.
3. **Volumes and networking**: one day. This is where most "it can't connect" confusion goes away.
4. **Compose for multi-service development**: two days, alongside InferenceFlow P4, so the integration tests have a database from the start.
5. **Production-ready images**: two days, alongside the GitHub Actions image-publishing stage and InferenceFlow P13.

Each stage's `apply` line names the InferenceFlow phase where I expect to use it; the examples in the notes are illustrative rather than taken from that repository, which is still documentation only.
