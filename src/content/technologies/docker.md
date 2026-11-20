---
name: Docker
summary: Packaging the Python service and its database into containers, from first docker run to small, non-root production images.
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
    learn:
      - An image is a read-only stack of layers plus config; a container is a running process with a thin writable layer on top
      - Containers share the host kernel and are isolated with namespaces and cgroups; they are not VMs
      - Tags are mutable pointers, digests are immutable content addresses
      - On a Mac, Docker Desktop runs a Linux VM, and Apple silicon builds arm64 images by default
      - The container lifecycle (create, start, stop, remove) and why containers should be disposable
    practice:
      - Run postgres:18 and python:3.14-slim interactively, then exec into the running Postgres container and open psql
      - Use docker image history and docker image inspect to see layers, entrypoint and environment
      - Fill a container's writable layer with a file, remove the container, and confirm the file is gone
    doneWhen:
      - I can explain image, container, layer, tag and digest without notes
      - docker system df shows nothing I can't account for
    notes: [docker-images-containers-and-layers]
  - title: Writing Dockerfiles for Python
    goal: Write a Dockerfile for a uv project that rebuilds in seconds when only application code changes.
    learn:
      - Core instructions (FROM, WORKDIR, COPY, RUN, ENV, CMD, ENTRYPOINT) and exec form versus shell form
      - Layer caching order, with dependencies installed before the source is copied
      - .dockerignore, and why .venv and .git must never reach the build context
      - Installing uv from its official image and using uv sync --locked inside the build
      - Signals and PID 1, and why the server process must receive SIGTERM
    practice:
      - Write a Dockerfile for the inventory API skeleton and run it with docker run -p 8000:8000
      - Change one Python file, rebuild, and confirm only the final layers rebuild
      - Time docker stop with a shell-form CMD and then with an exec-form CMD
    doneWhen:
      - A code-only change rebuilds without reinstalling dependencies
      - docker stop returns in well under the 10-second timeout
    notes: [writing-a-dockerfile-for-python]
  - title: Volumes and networking
    goal: Persist data outside containers and connect containers to each other and to the host on purpose.
    learn:
      - Named volumes, bind mounts and tmpfs, and when each is right
      - Publishing ports with -p, and binding to 127.0.0.1 so databases aren't exposed to the network
      - User-defined bridge networks and DNS by container name
      - Why localhost inside a container means the container itself
    practice:
      - Run Postgres with a named volume, recreate the container and confirm the data survives
      - Put the API and Postgres on one user-defined network and connect by container name
      - Back up a named volume to a tar file with a throwaway container
    doneWhen:
      - I can predict which hostname and port the app needs in each setup
      - Database data survives docker rm and a fresh docker run
    notes: [docker-volumes-and-networking]
  - title: Compose for multi-service development
    goal: Bring up the API and Postgres with one command, with start-up ordering and a fast edit loop.
    learn:
      - compose.yaml services, networks and volumes, and the docker compose v2 commands
      - Healthchecks plus depends_on with condition service_healthy
      - Environment variables, .env files and variable interpolation
      - Compose Watch (sync and rebuild) versus bind mounts for live reload
    practice:
      - Write compose.yaml for the inventory API and postgres:18 with a healthcheck and a named volume
      - Run migrations as a one-off container with docker compose run --rm
      - Use docker compose watch so code edits sync and a pyproject.toml change triggers a rebuild
    doneWhen:
      - docker compose up gives a working API and database from a clean checkout
      - docker compose down keeps the data, and docker compose down -v removes it, and I know which I wanted
    notes: [docker-compose-python-and-postgres]
  - title: Production-ready images
    goal: Ship a small, non-root, scanned image whose builds are fast in CI.
    learn:
      - Multi-stage builds that leave compilers and build tools out of the final image
      - Running as a non-root user, and file ownership with COPY --chown
      - BuildKit cache mounts for package managers
      - HEALTHCHECK, labels and image metadata
      - Image scanning and keeping base images up to date
    practice:
      - Convert the Dockerfile to a builder and runtime stage and compare image sizes
      - Add a non-root user and confirm with docker run --rm image id
      - Scan the image with Docker Scout or Trivy and fix or record each critical finding
    doneWhen:
      - The final image has no uv, no compilers and no root process
      - A CI rebuild with unchanged dependencies is mostly cache hits
    notes: [writing-a-dockerfile-for-python, building-and-pushing-docker-images-with-actions]
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
  - title: Using uv in Docker
    url: https://docs.astral.sh/uv/guides/integration/docker/
    kind: docs
  - title: Docker Compose documentation
    url: https://docs.docker.com/compose/
    kind: docs
  - title: Multi-stage builds
    url: https://docs.docker.com/build/building/multi-stage/
    kind: docs
---

## Why I'm learning it

Most of my ML work has run in environments someone else set up: a managed notebook, a training cluster, a conda environment that "works on my machine". Backend services can't rely on that. A service needs to run identically on my laptop, in CI and in production, and it needs its dependencies (a specific Python, system libraries, a database) to come with it.

Docker is the standard way to get there. I've used images other people built, but I want to understand what an image actually is, write Dockerfiles that build fast and stay small, and run a realistic local environment with a database in it instead of installing Postgres on my Mac.

## How it fits with the rest of my stack

Docker sits between the code and everything that runs it. The Python service is packaged into an image built from a uv lockfile, so the Python project setup stage comes first. PostgreSQL runs as a container in local development, with a named volume for its data, which means I never install it directly. SQLAlchemy connects to that container through a `DATABASE_URL` that Compose provides. GitHub Actions builds the same Dockerfile in CI, caches its layers and publishes the image to GitHub Container Registry, which is why the production-images stage and the GitHub Actions publishing stage are best done together.

## How to use this roadmap

1. **Images and containers**: one day. Mostly running and inspecting things; resist writing Dockerfiles yet.
2. **Writing Dockerfiles for Python**: two days. Needs the Python project setup stage done first.
3. **Volumes and networking**: one day. This is where most "it can't connect" confusion goes away.
4. **Compose for multi-service development**: two days. Do it alongside the first PostgreSQL stage so there's a real database to work with.
5. **Production-ready images**: two to three days, ideally alongside the GitHub Actions stage on building and publishing images.

Each stage maps to a milestone in the inventory API project: the Compose stage gives it a database, and the last stage produces the image that CI publishes.
