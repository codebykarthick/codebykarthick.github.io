---
title: Docker volumes and networking
summary: Where container data should live (named volumes, bind mounts, tmpfs) and how containers reach each other and the host, including the localhost trap.
technologies: [docker]
topics: [containers, networking]
updated: 2026-11-20
---

Two questions come up the moment a Python service talks to a database in Docker: where does the database's data live, and what hostname does the app use to reach it? Both have simple answers once the model is clear.

## Storage: three kinds of mount

A container's own writable layer disappears with the container, so anything that has to persist goes in a mount.

| Mount | Lives in | Good for | Not for |
| --- | --- | --- | --- |
| **Named volume** | Docker-managed storage | Database data, anything Docker should own | Editing files from my editor |
| **Bind mount** | A host path I choose | Source code during development, config files | Database data on a Mac (slow, permission issues) |
| **tmpfs** | Memory | Scratch files, secrets that must never touch disk | Anything that must survive a restart |

### Named volumes

```sh
docker volume create pgdata
docker run -d --name db \
  -e POSTGRES_PASSWORD=dev \
  -v pgdata:/var/lib/postgresql \
  postgres:18

docker rm -f db
docker run -d --name db -e POSTGRES_PASSWORD=dev -v pgdata:/var/lib/postgresql postgres:18
# the data is still there
```

The volume exists independently of any container. Removing the container leaves it alone; only `docker volume rm` or a prune deletes it.

The mount path matters. **From PostgreSQL 18 the official image's data directory moved to `/var/lib/postgresql/18/docker`, and the volume should be mounted at `/var/lib/postgresql`.** For 17 and earlier it was `/var/lib/postgresql/data`. Most older tutorials use the old path. Mounting at the wrong one means Postgres writes to an anonymous volume and the data is quietly lost when the container is recreated.

If a volume is empty when first mounted, Docker copies the image's existing files at that path into it. A bind mount doesn't do this; it simply hides whatever the image had there.

### Bind mounts

```sh
docker run --rm -it -v "$PWD/src:/app/src" inventory-api:dev
```

Edits on the host show up in the container straight away, which is what I want for hot reload in development. The trade-offs: file ownership is the host's (a non-root container user may not be able to write), and on macOS file sharing goes through the Docker Desktop VM, so heavy I/O such as a database is noticeably slower.

`--mount type=bind,source=...,target=...` is the more explicit syntax. Unlike `-v`, it errors if the source doesn't exist instead of silently creating an empty directory.

### Backing up a volume

Volumes don't have a direct export command, so I use a throwaway container:

```sh
docker run --rm -v pgdata:/data -v "$PWD:/backup" busybox \
  tar czf /backup/pgdata.tgz -C /data .
```

For Postgres specifically, `pg_dump` via `docker exec` is the better backup, because copying files from under a running database isn't guaranteed to be consistent.

## Networking: who can reach whom

### Publishing ports to the host

Containers have their own network namespace. To reach one from my laptop I publish a port:

```sh
docker run -d -p 127.0.0.1:5432:5432 -e POSTGRES_PASSWORD=dev postgres:18
#               host-ip:host-port:container-port
```

Without `127.0.0.1`, Docker publishes on all interfaces (`0.0.0.0`), so anyone on the same network can reach my dev database. On Linux servers Docker also writes its own firewall rules, which can bypass `ufw`. For a database I only need locally, I always bind to `127.0.0.1`, or don't publish at all.

`EXPOSE` in a Dockerfile publishes nothing. It's metadata.

### Container to container: user-defined networks

```sh
docker network create inventory
docker run -d --name db --network inventory -e POSTGRES_PASSWORD=dev postgres:18
docker run --rm --network inventory \
  -e DATABASE_URL=postgresql+psycopg://postgres:dev@db:5432/postgres \
  inventory-api:dev
```

On a **user-defined bridge network**, Docker runs an embedded DNS server, so containers reach each other **by container name** (`db`), on the **container port** (5432). No `-p` is needed for container-to-container traffic. Publishing is only for traffic from outside Docker.

The **default** bridge network (what you get without `--network`) has no name resolution. That's a common reason "it can't find `db`". Compose creates a user-defined network for every project automatically, so this mostly goes away there.

### The localhost trap

Inside a container, `localhost` means *that container*. So:

| App runs | Database runs | Host in `DATABASE_URL` |
| --- | --- | --- |
| On my Mac | Container with `-p 127.0.0.1:5432:5432` | `localhost` |
| In a container | Another container on the same network | `db` (container or service name) |
| In a container | Directly on my Mac | `host.docker.internal` (Docker Desktop) |
| In a container | Container on a different network, with `-p` | Not `localhost`; `host.docker.internal` plus the host port works, but a shared network is cleaner |

The mirror-image mistake: a server inside a container listening on `127.0.0.1` can't be reached through a published port. It has to listen on `0.0.0.0`.

```sh
docker network ls
docker network inspect inventory     # which containers are attached, and their IPs
docker exec -it db getent hosts db   # check name resolution from inside
```

## Gotchas

- **Wrong Postgres mount path for the image version.** `/var/lib/postgresql` for 18+, `/var/lib/postgresql/data` for 17 and earlier. Check `docker volume ls` for unexpected anonymous volumes.
- **`POSTGRES_PASSWORD` only applies to an empty data directory.** Changing it later in `docker run` or Compose does nothing to an existing volume. Change the password in SQL, or delete the volume if the data is disposable.
- **Publishing databases on `0.0.0.0`.** Bind to `127.0.0.1` unless something outside the machine genuinely needs access.
- **Using the host port between containers.** If Postgres is published as `5433:5432`, other containers still connect on `5432`.
- **`docker compose down -v` and `docker volume prune`** delete data. Fine for a test database, painful for anything else.

## Check yourself

1. Why should Postgres data go in a named volume rather than a bind mount on macOS?
2. In `-p 127.0.0.1:5433:5432`, which number does another container on the same network use, and which does `psql` on my Mac use?
3. Why can two containers resolve each other by name on a user-defined network but not on the default bridge?
4. My API container uses `DATABASE_URL=...@localhost:5432/...` and can't connect to Postgres in another container. Why, and what's the fix?
5. Where should the volume be mounted for `postgres:18`, and what happens if I use the old path?

## Further reading

- [Docker docs: volumes](https://docs.docker.com/engine/storage/volumes/)
- [Docker docs: bind mounts](https://docs.docker.com/engine/storage/bind-mounts/)
- [Docker docs: networking overview](https://docs.docker.com/engine/network/)
- [Docker docs: bridge network driver](https://docs.docker.com/engine/network/drivers/bridge/)
- [Postgres official image: PGDATA and volumes](https://hub.docker.com/_/postgres)
