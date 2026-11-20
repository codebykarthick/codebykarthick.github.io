---
title: Building and pushing Docker images with GitHub Actions
summary: Build a Go service's image on every pull request and publish multi-platform, tagged images to GitHub Container Registry from main and release tags, with metadata-action, Buildx and the Actions cache.
technologies: [github-actions, docker, go]
topics: [ci-cd, images, deployment]
updated: 2026-11-20
---

The plan for a Go service's image: every pull request proves it still builds and starts, every merge to `main` publishes an image tagged with its commit, and pushing a tag like `v0.1.0` publishes a release. InferenceFlow's P13 asks for a build job and version-pinned images; publishing to **GitHub Container Registry (GHCR)** at `ghcr.io` is my choice, because it authenticates with the workflow's own `GITHUB_TOKEN` and needs no extra secrets. The image is the distroless, cross-compiled one from the Dockerfile note.

## The workflow

```yaml
# .github/workflows/image.yml
name: image

on:
  push:
    branches: [main]
    tags: ["v*.*.*"]
  pull_request:

permissions:
  contents: read

concurrency:
  group: image-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false

      - name: Set up Buildx
        uses: docker/setup-buildx-action@v4

      - name: Log in to GHCR
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Compute tags and labels
        id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha

      - name: Build and push
        id: build
        uses: docker/build-push-action@v7
        with:
          context: .
          target: runtime
          platforms: linux/amd64,linux/arm64
          build-args: |
            VERSION=${{ steps.meta.outputs.version }}
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Record the digest
        env:
          DIGEST: ${{ steps.build.outputs.digest }}
        run: echo "Pushed digest $DIGEST" >> "$GITHUB_STEP_SUMMARY"
```

actionlint is clean on it. I can't run GitHub's runners locally, so the build itself I checked with `docker build` against a scratch module.

## Walking through it

### Permissions

The workflow defaults to `contents: read`, and only this job is raised to `packages: write`, which lets `GITHUB_TOKEN` push to GHCR. Job-level `permissions` *replaces* the workflow block rather than adding to it, so `contents: read` has to be repeated or checkout fails.

On pull requests from forks, `GITHUB_TOKEN` is read-only whatever the workflow asks for. That's one reason login and push are skipped on `pull_request`: the build still proves the Dockerfile works, but nothing is published from untrusted code.

### Buildx

`docker/setup-buildx-action` creates a BuildKit builder with the `docker-container` driver. The default `docker` driver can neither export cache to `gha` nor build multi-platform images unless the engine uses the containerd image store. I hit exactly this locally: a two-platform build failed with "Multi-platform build is not supported for the docker driver".

### Tags from metadata-action

`docker/metadata-action` turns the event into tags plus standard OCI labels:

| Event | Tags produced |
| --- | --- |
| Pull request #12 | `pr-12`, `sha-<short>` (built, not pushed) |
| Push to `main` | `main`, `sha-<short>` |
| Push tag `v0.1.0` | `0.1.0`, `0.1`, `sha-<short>`, `latest` |

`latest` comes from the default `flavor: latest=auto`, which adds it for semver tags, so it means "newest release", not "last merge". The `sha-` tag is unique and maps straight back to a commit. The `version` output (`0.1.0`, `main` or `pr-12`) goes into the Dockerfile's `VERSION` argument and is linked into the binary with `-X main.version`, so a running container can report what it is.

The labels include `org.opencontainers.image.source`, which GHCR uses to link the package to the repository. metadata-action also lowercases the image name, since registry names must be lowercase and `github.repository` keeps the owner's capitalisation.

### Multi-platform without emulation

`platforms: linux/amd64,linux/arm64` produces one image index that runs on Intel servers and on Apple silicon or Arm machines. For most languages that means QEMU emulation and slow builds. Because the Dockerfile's build stage uses `FROM --platform=$BUILDPLATFORM` and sets `GOOS`/`GOARCH` from `TARGETOS`/`TARGETARCH`, Go cross-compiles both binaries natively on the amd64 runner; only the tiny distroless runtime stage is per-platform. No `setup-qemu-action` is needed. Locally, an amd64 image built on my arm64 Mac in seven seconds.

### Cache: layers yes, cache mounts no

- **`cache-from` / `cache-to: type=gha`** store BuildKit's layer cache in the GitHub Actions cache. Runners start with an empty Docker cache, so without this every build starts from nothing.
- **`mode=max`** caches the layers of every stage, including the builder. The default `mode=min` only caches layers in the final image, which for a multi-stage build misses all the expensive work.
- **Cache mounts aren't exported.** Docker's documentation says BuildKit doesn't preserve cache mounts in the GitHub Actions cache by default. The Dockerfile's `/go/pkg/mod` and `/root/.cache/go-build` mounts are therefore empty on every runner. If no source changed, every layer comes from the cache and nothing runs. If code changed, the `go mod download` layer is a cache hit but nearly empty (the modules went into the mount), so `go build` downloads and compiles every dependency again. If that becomes slow, `reproducible-containers/buildkit-cache-dance` copies the mount contents in and out of the Actions cache.

### The digest

`steps.build.outputs.digest` is the immutable content address of what was pushed. Writing it to `$GITHUB_STEP_SUMMARY` puts it on the run page. It goes through `env:`, not straight into the script, out of habit (see the security note).

## Smoke-testing the image

A successful build doesn't prove the binary starts. A second job can build for the runner's platform only, load it into the local Docker and hit the health endpoint:

```yaml
  smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: docker/setup-buildx-action@v4
      - uses: docker/build-push-action@v7
        with:
          context: .
          target: runtime
          load: true
          tags: api:smoke
          cache-from: type=gha
      - name: Start the container and wait for /healthz
        run: |
          docker run -d --name smoke -p 127.0.0.1:8080:8080 api:smoke
          for _ in $(seq 1 20); do
            curl -fsS http://127.0.0.1:8080/healthz && exit 0
            sleep 1
          done
          docker logs smoke
          exit 1
```

`load: true` only works for a single platform, which is why this is a separate build. A real service that refuses to start without a database would need a Postgres service container here too.

## Attestations

build-push-action attaches a provenance attestation by default: `mode=max` for public repositories and `mode=min` for private ones. Setting `provenance: mode=max` and `sbom: true` explicitly records how the image was built and what's in it. For a Go binary, `go version -m` lists the exact module versions linked in. I checked that it still works on the stripped, trimmed binary from the Dockerfile note, and `govulncheck -mode=binary` can scan the same file.

## Using the image

```sh
docker pull ghcr.io/<owner>/<repo>:sha-1a2b3c4
docker pull ghcr.io/<owner>/<repo>@sha256:<digest>   # what I'd deploy
```

A new GHCR package is **private** by default. Pulling it elsewhere needs `docker login ghcr.io` with a token that has `read:packages`, or making the package public.

## Gotchas

- **Forgetting `packages: write`.** The push fails with `denied` or `403 Forbidden` from `ghcr.io`.
- **Job-level permissions without `contents: read`.** Checkout fails, because the job block replaced the workflow default.
- **No Buildx step.** `cache-to: type=gha` and multi-platform builds fail on the default driver.
- **Expecting cache mounts to persist in CI.** They don't, without extra tooling.
- **Deploying `latest` or `main`.** They move. Deploy a `sha-` tag or, better, the digest.
- **`load: true` with several platforms.** The local image store can't hold a multi-platform index without the containerd store; build one platform for tests.

## Check yourself

1. Why is `packages: write` set on the job rather than the workflow, and why does `contents: read` appear twice?
2. Which tags does a push of `v1.2.3` produce, and which would I deploy?
3. How does this build produce an arm64 image without QEMU?
4. What does `mode=max` cache that the default doesn't, and what does neither mode cache?
5. Why does the smoke test build separately with `load: true`?

## Further reading

- [Docker docs: GitHub Actions](https://docs.docker.com/build/ci/github-actions/)
- [Docker docs: cache management with GitHub Actions](https://docs.docker.com/build/ci/github-actions/cache/)
- [Docker docs: manage tags and labels](https://docs.docker.com/build/ci/github-actions/manage-tags-labels/)
- [Docker docs: multi-platform images](https://docs.docker.com/build/building/multi-platform/)
- [docker/metadata-action](https://github.com/docker/metadata-action)
- [GitHub Docs: working with the container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
