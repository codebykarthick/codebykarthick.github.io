---
title: Writing a Dockerfile for a Go service
summary: From a 1 GB naive image to a 13 MB multi-stage build - module caching, BuildKit cache mounts, a static binary, distroless or scratch, non-root, and health checks without a shell.
technologies: [docker, go]
topics: [images, best-practices, security]
updated: 2026-11-20
---

The goal is an image for a Go HTTP service that rebuilds in seconds when only code changes, contains the binary and almost nothing else, and doesn't run as root. The examples assume an illustrative module with its entry point under `cmd/api`, the layout InferenceFlow proposes, serving `/healthz` and shutting down on `SIGTERM`. Everything below I built and ran locally with `golang:1.27` (Go 1.27.4).

Go makes this easier than most languages. With cgo off, `go build` produces one statically linked file with no runtime to install, so the final image only needs that file plus CA certificates.

## The naive version, and why it's 1 GB

```dockerfile
FROM golang:1.27
WORKDIR /src
COPY . .
RUN go build -o /usr/local/bin/api ./cmd/api
CMD ["api"]
```

It works, but:

1. `COPY . .` comes first, so **any** change invalidates the cache and every module is downloaded again.
2. The image ships the whole Go toolchain, Debian, Git and a compiler: 1.1 GB on my machine, for an 11 MB binary.
3. It runs as root, and anyone who gets code execution has a shell and a compiler to work with.

## The production version

```dockerfile
# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM golang:1.27 AS build
WORKDIR /src

# 1. Dependencies: cached until go.mod or go.sum changes
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

# 2. Source and build: a code change only reruns from here
COPY . .
ARG VERSION=dev
ARG TARGETOS TARGETARCH
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath \
      -ldflags="-s -w -X main.version=${VERSION}" \
      -o /out/api ./cmd/api

# 3. Runtime: no shell, no package manager, non-root by default
FROM gcr.io/distroless/static-debian13:nonroot AS runtime
COPY --from=build /out/api /api
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/api", "-healthcheck"]
ENTRYPOINT ["/api"]
```

### Layer order and the module download

Docker reuses a cached layer only if the instruction *and every layer before it* are unchanged. Dependencies change weekly and code changes every few minutes, so `go.mod` and `go.sum` are copied on their own and `go mod download` runs before the source arrives. After editing a `.go` file, the rebuild log shows `COPY go.mod go.sum` and `go mod download` as `CACHED`, and only `COPY . .` and `go build` run.

### BuildKit cache mounts

`--mount=type=cache` gives a `RUN` step a directory that persists between builds but never becomes part of the image:

- **`/go/pkg/mod`** is the module cache (`GOMODCACHE` in the official image). When `go.sum` does change, only the new modules are downloaded.
- **`/root/.cache/go-build`** is the compiler's build cache (`GOCACHE` for root). Unchanged packages, including every dependency, aren't recompiled.

With both mounts a code-only rebuild of my scratch module took a few seconds. The catch is CI: cache mounts live in the local builder and aren't exported to the GitHub Actions cache, which I cover in the image-publishing note.

### The build flags

- **`CGO_ENABLED=0`** builds a pure-Go, statically linked binary that needs no C library at run time. The standard library falls back to its pure-Go DNS resolver and user lookup, and pgx is pure Go, so a typical HTTP-plus-Postgres service loses nothing.
- **`-trimpath`** removes local file-system paths from the binary, so stack traces show module paths rather than `/src/...`, and builds from different directories are byte-identical.
- **`-ldflags="-s -w"`** drops the symbol table and DWARF debug information, which shrinks the binary. Stack traces still work; debuggers such as Delve don't.
- **`-X main.version=${VERSION}`** sets a string variable at link time. `.git` is excluded from the build context, so Go's automatic VCS stamping has nothing to read; passing `--build-arg VERSION=$(git describe --tags)` is the explicit route.

### Cross-compiling instead of emulating

`FROM --platform=$BUILDPLATFORM` runs the build stage on my machine's native architecture, and `GOOS`/`GOARCH` from the automatic `TARGETOS`/`TARGETARCH` arguments make Go cross-compile. `docker build --platform linux/amd64 .` on my arm64 Mac produced a working amd64 image in seven seconds, without running the compiler under QEMU emulation. The runtime stage has no `--platform`, so it uses the target platform's distroless image.

## Choosing the final image

| Base | Size of my image | Has | Notes |
| --- | --- | --- | --- |
| `golang:1.27` (naive) | 1.1 GB | Everything | Never ship this |
| `gcr.io/distroless/static-debian13:nonroot` | 13.3 MB | CA certificates, tzdata, `/etc/passwd`, `/tmp` | Runs as uid 65532 by default |
| `scratch` | 11.2 MB | Nothing at all | I add certificates and pick a uid myself |

Distroless `static` is my default. It has no shell or package manager, but it does have the small files a Go program quietly expects: CA certificates for outbound TLS, time zone data for `time.LoadLocation`, and a `nonroot` user. The `:nonroot` tag sets `USER 65532`, so there is no `USER` line to forget.

`scratch` saves two megabytes and costs some care:

```dockerfile
FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /out/api /api
USER 65532:65532
ENTRYPOINT ["/api"]
```

There's no `/etc/passwd`, so `USER` must be numeric. There's no time zone data either; importing `time/tzdata` embeds it in the binary.

## Health checks without a shell

Distroless has no `curl`, `wget` or `sh`, so `HEALTHCHECK CMD curl ...` can't work. Instead the binary checks itself: an illustrative `-healthcheck` flag makes it request `http://127.0.0.1:8080/healthz` and exit 0 or 1. The exec form (a JSON array) is required, because the shell form needs `/bin/sh`. Docker and Compose then report the container as `healthy`. Kubernetes ignores `HEALTHCHECK` and uses its own probes.

## Signals and PID 1

The exec-form `ENTRYPOINT` makes the Go binary PID 1, so `docker stop` delivers `SIGTERM` straight to it. Unlike many runtimes, Go exits on `SIGTERM` by default even as PID 1: a bare `http.ListenAndServe` binary stopped in 0.1 seconds with exit code 143, cutting off anything in flight. Handling the signal with `signal.NotifyContext` and `http.Server.Shutdown` turns that into the bounded drain InferenceFlow's P0 asks to demonstrate: stop accepting connections, finish in-flight requests, then exit 0.

## Keep the build context small

```text
.git
.github
bin/
dist/
.env
compose.yaml
Dockerfile*
```

`.git` can be large and changes on every commit, and `.env` usually holds secrets. Anything in the context can end up in a layer through `COPY . .`.

## Checking the result

```sh
docker build -t api:dev --build-arg VERSION=v0.0.1 .
docker image ls api                                  # about 13 MB
docker inspect --format '{{.Config.User}}' api:dev   # 65532
docker run -d --name api -p 127.0.0.1:8080:8080 api:dev
docker inspect --format '{{.State.Health.Status}}' api   # healthy
docker exec api sh                                   # fails: no shell, as intended
```

## Gotchas

- **A cgo dependency.** With `CGO_ENABLED=0`, packages that need C (for example the mattn SQLite driver) fail to build. If cgo is genuinely needed, the runtime needs a C library: `distroless/base` rather than `static`.
- **Missing CA certificates on `scratch`.** Outbound HTTPS fails with `x509: certificate signed by unknown authority`.
- **Debugging a distroless container.** There's nothing to `exec` into. Docker Desktop's `docker debug`, or temporarily switching to the `:debug-nonroot` tag (which adds a busybox shell), helps; permanently adding a shell to the production image doesn't.
- **Listening on `127.0.0.1`.** Inside a container that blocks published ports. Listen on `:8080`, all interfaces.
- **Mutable base tags.** `golang:1.27` and `:nonroot` move with each patch. For release builds I pin digests and let Dependabot propose updates.

## Check yourself

1. Why are `go.mod` and `go.sum` copied before the rest of the source?
2. What do the two cache mounts hold, and why don't they bloat the image?
3. What does `CGO_ENABLED=0` buy, and when can't I use it?
4. What does distroless `static` include that `scratch` doesn't, and which Go features notice the difference?
5. Why must the `HEALTHCHECK` use exec form here, and how does the binary check itself?

## Further reading

- [Docker: multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
- [Docker: optimise cache usage in builds](https://docs.docker.com/build/cache/optimize/)
- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
- [Docker: build variables, including BUILDPLATFORM and TARGETARCH](https://docs.docker.com/build/building/variables/)
- [Distroless container images](https://github.com/GoogleContainerTools/distroless)
- [Go command documentation: build flags](https://pkg.go.dev/cmd/go)
