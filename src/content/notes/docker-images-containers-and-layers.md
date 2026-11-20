---
title: Docker images, containers and layers
summary: What an image actually is, how a container differs from it, why layers make builds fast, and the commands I use to run, inspect and clean up.
technologies: [docker]
topics: [fundamentals, images, containers]
updated: 2026-11-20
---

Before writing any Dockerfiles I want the vocabulary straight. Most early Docker confusion ("where did my file go?", "why is this image 1 GB?", "why does it work on my Mac but not on the server?") comes from a fuzzy idea of what images and containers are.

## Containers are processes, not VMs

A container is an ordinary Linux process (or group of processes) that the kernel isolates:

- **Namespaces** give it its own view of process IDs, network interfaces, mount points and hostname.
- **cgroups** limit how much CPU and memory it can use.

There's no guest operating system and no separate kernel. All containers on a host share the host's kernel, which is why they start in milliseconds and why a Linux image needs a Linux kernel. On my Mac, Docker Desktop quietly runs a small Linux VM and all containers live inside it. That's worth remembering when file sharing feels slow or `localhost` behaves unexpectedly.

## Images are stacks of read-only layers

An image is two things:

1. An ordered list of **layers**. Each layer is a tarball of filesystem changes: files added, changed or deleted.
2. A **config**: the default command, environment variables, working directory, exposed ports and user.

Most Dockerfile instructions that change the filesystem (`RUN`, `COPY`, `ADD`) produce a new layer. When I build, Docker can reuse a layer from cache as long as the instruction and everything before it are unchanged. That is the whole basis of fast rebuilds, and why the *order* of instructions matters so much (see the Dockerfile note).

Layers are content-addressed and shared. If ten images use `python:3.14-slim` as their base, its layers are stored once on disk and downloaded once.

Layers are also additive. Deleting a file in a later layer hides it but doesn't shrink the image, because the earlier layer still contains it. This is why `RUN apt-get install ... && rm -rf /var/lib/apt/lists/*` has to be a single `RUN`, and why secrets copied into an early layer stay recoverable even if a later layer deletes them.

```sh
docker image history python:3.14-slim   # one line per layer, with sizes
docker image inspect python:3.14-slim   # config: Env, Cmd, Entrypoint, Architecture
```

## A container is an image plus a writable layer

When I `docker run` an image, Docker stacks a thin **writable layer** on top of the read-only layers and starts the configured process. Anything the process writes goes into that writable layer, which exists only as long as the container does.

```sh
docker run --name scratch -it python:3.14-slim bash
# inside: echo hello > /tmp/note.txt; exit
docker start -ai scratch      # the file is still there: same container
docker rm scratch
docker run --rm -it python:3.14-slim cat /tmp/note.txt   # gone: new container
```

This is the single most important idea for running databases: **data that must outlive the container belongs in a volume**, not in the writable layer.

## Tags and digests

`postgres:18` is a **tag**: a human-friendly, *mutable* pointer. The maintainers move it every time they publish a patch release. A **digest** such as `postgres@sha256:...` identifies exact image content and never changes.

For local development, tags are fine. For production deploys and anything that needs to be reproducible, I pin the digest, or at least a specific tag such as `postgres:18.1`, and let a bot propose updates.

Images are also built per **platform**. Most official images are multi-platform, and Docker pulls the variant that matches the host. My Mac is Apple silicon (`linux/arm64`), while most CI runners and cloud servers are `linux/amd64`. An image I build locally and push from my Mac will not run on an amd64 server unless I build for that platform, for example with `docker buildx build --platform linux/amd64,linux/arm64`.

## The commands I actually use

```sh
# Run
docker run --rm -it python:3.14-slim python          # throwaway interactive container
docker run -d --name db -e POSTGRES_PASSWORD=dev \
  -p 127.0.0.1:5432:5432 postgres:18                 # background service

# Inspect
docker ps                  # running containers (add -a for stopped ones)
docker logs -f db          # follow stdout/stderr
docker exec -it db psql -U postgres    # run a second process in a running container
docker inspect db          # full config and state as JSON
docker stats               # live CPU and memory per container

# Lifecycle
docker stop db             # SIGTERM, then SIGKILL after 10 seconds
docker start db
docker rm db               # remove (add -f to stop and remove)

# Clean up
docker system df           # what's using disk
docker image prune         # dangling images
docker system prune        # stopped containers, unused networks, dangling images, build cache
```

`docker exec` is my main debugging tool: it starts an extra process inside an existing container, so I can poke around without restarting it.

## Gotchas

- **Treating containers as pets.** If I `docker exec` in and `pip install` something, it's gone the next time the container is recreated. Changes belong in the Dockerfile.
- **`latest` isn't "newest".** It's just the default tag name, and it only means "newest" if the publisher keeps it that way. Don't rely on it.
- **Architecture mismatches.** `exec format error` almost always means an arm64 image on an amd64 host or the other way round.
- **Disk creep.** Old images and build cache pile up quickly. `docker system df` before assuming the machine is out of space for some other reason.
- **`docker system prune --volumes`** also deletes unused volumes, which may be my local database. Read the prompt before typing `y`.

## Check yourself

1. Why does deleting a file in a later `RUN` instruction not reduce the image size?
2. What happens to files a process writes inside a container when the container is removed? What about when it's only stopped?
3. What's the difference between `postgres:18` and `postgres@sha256:...`, and when would I want each?
4. Why might an image built on my Mac fail with `exec format error` on a CI runner or server?
5. What does `docker exec` do that `docker run` doesn't?

## Further reading

- [Docker docs: what is a container?](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/)
- [Docker docs: understanding image layers](https://docs.docker.com/get-started/docker-concepts/building-images/understanding-image-layers/)
- [Docker docs: multi-platform images](https://docs.docker.com/build/building/multi-platform/)
- [Docker CLI reference](https://docs.docker.com/reference/cli/docker/)
