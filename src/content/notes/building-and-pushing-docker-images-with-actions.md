---
title: Building and pushing Docker images with GitHub Actions
summary: Build the image on every pull request and publish tagged images to GitHub Container Registry from main and release tags, using metadata-action, Buildx and the GitHub Actions cache.
technologies: [github-actions, docker]
topics: [ci-cd, images, deployment]
updated: 2026-11-20
---

The goal for the inventory API: every pull request proves the image still builds, every merge to `main` publishes an image tagged with its commit, and pushing a tag like `v0.1.0` publishes a release. The registry is **GitHub Container Registry (GHCR)** at `ghcr.io`, because it authenticates with the workflow's own `GITHUB_TOKEN` and needs no extra secrets.

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
        uses: docker/build-push-action@v7
        with:
          context: .
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

## Walking through it

### Permissions

The workflow defaults to `contents: read`, and only this job is raised to `packages: write`, which is what lets `GITHUB_TOKEN` push to GHCR. Job-level `permissions` *replaces* the workflow-level block rather than adding to it, so `contents: read` has to be repeated or checkout fails.

On pull requests from forks, `GITHUB_TOKEN` is read-only whatever the workflow asks for. That's one reason the login and push are skipped on `pull_request`: the build still runs and proves the Dockerfile works, but nothing is published from untrusted code.

### Buildx

`docker/setup-buildx-action` creates a BuildKit builder using the `docker-container` driver. The default `docker` driver can only export cache to backends like `gha`, or build multi-platform images, when the Docker Engine uses the containerd image store. The `docker-container` driver supports both regardless, so this step makes the rest of the workflow work on any runner.

### Tags from metadata-action

Working out tags by hand in shell is fiddly and error-prone. `docker/metadata-action` turns the event into a list of tags plus standard OCI labels. With the configuration above:

| Event | Tags produced |
| --- | --- |
| Pull request #12 | `pr-12`, `sha-<short>` (built, not pushed) |
| Push to `main` | `main`, `sha-<short>` |
| Push tag `v0.1.0` | `0.1.0`, `0.1`, `sha-<short>`, `latest` |

`latest` comes from the action's default `flavor: latest=auto`, which adds it for semver tags. So `latest` means "the newest release", not "whatever was last merged". If I wanted `latest` to follow `main` instead, I'd add `type=raw,value=latest,enable={{is_default_branch}}`.

The `sha-` tag is the one I'd deploy: it's unique, and maps straight back to a commit. Branch tags like `main` move with every merge.

The labels output includes `org.opencontainers.image.source` pointing at the repository, which GHCR uses to link the package to the repository page. metadata-action also lowercases image names, which matters because registry names must be lowercase and `github.repository` keeps the owner's capitalisation.

### Build, push and cache

`docker/build-push-action` runs `docker buildx build`:

- **`context: .`** builds from the checked-out files. Without it, the action builds from the Git context (a fresh clone of the commit by BuildKit), which ignores anything earlier steps generated.
- **`push`** is an expression, so the same step builds-only on pull requests and pushes everywhere else.
- **`cache-from: type=gha` / `cache-to: type=gha,mode=max`** store BuildKit's layer cache in the GitHub Actions cache. Runners are fresh VMs with an empty Docker cache, so without this every build starts from nothing. `mode=max` caches the layers of *every* stage, including the builder stage where dependencies are installed. The default `mode=min` only caches layers in the final image, which for a multi-stage build misses most of the expensive work.

Combined with a Dockerfile that installs dependencies before copying the source, a code-only change rebuilds in well under a minute.

## Optional extras

**Smoke-test before pushing.** Build once with `load: true` to put the image in the runner's Docker, run a quick check, then push in a second build step. The second build is nearly instant because every layer is cached:

```yaml
      - uses: docker/build-push-action@v7
        with:
          context: .
          load: true
          tags: inventory-api:test
          cache-from: type=gha
      - run: docker run --rm inventory-api:test python -c "import inventory_api"
```

**Multi-platform images.** Adding `platforms: linux/amd64,linux/arm64` (plus `docker/setup-qemu-action@v4`) builds an image that also runs on Apple silicon and Arm servers. Emulated arm64 builds are slow, especially compiling wheels; building each platform on a native runner and merging them is faster, at the cost of a more complex workflow.

**Attestations.** build-push-action attaches a provenance attestation by default: `mode=max` for public repositories and `mode=min` for private ones. Setting `provenance: mode=max` and `sbom: true` explicitly records how the image was built and what's in it.

## Using the image

```sh
docker pull ghcr.io/<owner>/inventory-api:sha-1a2b3c4
```

A newly created GHCR package is **private** by default. To pull it from elsewhere, I either authenticate (`docker login ghcr.io` with a personal access token that has `read:packages`) or make the package public in its settings.

## Gotchas

- **Forgetting `packages: write`.** The push fails with a `denied` or `403 Forbidden` error from `ghcr.io`.
- **Job-level permissions without `contents: read`.** Checkout fails, because the job block replaced the workflow default.
- **No Buildx step.** On a runner without the containerd image store, `cache-to: type=gha` fails with "Cache export is not supported for the docker driver".
- **Expecting the cache to be permanent.** The Actions cache has a per-repository size limit and evicts old entries. A cold build now and then is normal.
- **Deploying `latest` or `main`.** They move. Deploy an immutable `sha-` tag or, better, the image digest from the build step's `digest` output.
- **Uppercase image names when tagging by hand.** `ghcr.io/CodeByKarthick/...` is rejected; metadata-action handles this, a hand-written `tags:` line doesn't.

## Check yourself

1. Why is `packages: write` set on the job rather than the whole workflow, and why does `contents: read` appear twice?
2. Which tags does a push of `v1.2.3` produce, and which of them would I deploy?
3. Why does the workflow build but not push on pull requests?
4. What does `mode=max` cache that the default doesn't, and why does it matter for a multi-stage Dockerfile?
5. Why is Buildx needed for the `gha` cache?

## Further reading

- [Docker docs: GitHub Actions](https://docs.docker.com/build/ci/github-actions/)
- [Docker docs: cache management with GitHub Actions](https://docs.docker.com/build/ci/github-actions/cache/)
- [Docker docs: manage tags and labels](https://docs.docker.com/build/ci/github-actions/manage-tags-labels/)
- [docker/metadata-action](https://github.com/docker/metadata-action)
- [GitHub Docs: working with the container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [GitHub Docs: publishing Docker images](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
