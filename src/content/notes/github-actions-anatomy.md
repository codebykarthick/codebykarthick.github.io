---
title: Anatomy of a GitHub Actions workflow
summary: Workflows, events, jobs, steps, runners and actions - how they nest, what runs where, how data moves between steps and jobs, and the defaults that surprise people.
technologies: [github-actions]
topics: [fundamentals, ci-cd]
updated: 2026-11-20
---

Before writing real CI I want to be able to read any workflow file and say when it runs, on what machine, in what order, and what each step can see. Coming from Java, the closest analogy is a build pipeline definition, but the execution model has its own rules.

## The nesting

```text
repository
└── .github/workflows/ci.yml        a workflow (one YAML file)
    ├── on: ...                     events that trigger it
    └── jobs:
        ├── lint                    a job: runs on its own fresh runner
        │   └── steps: [...]        steps run in order, sharing one machine
        └── test
            └── steps: [...]
```

- A **workflow** is one YAML file in `.github/workflows/`. A repository can have many.
- An **event** (`push`, `pull_request`, `workflow_dispatch`, `schedule`, ...) starts a workflow run.
- A **job** is a set of steps that runs on one **runner**, a fresh virtual machine such as `ubuntu-latest`. Jobs run **in parallel** by default.
- A **step** is either a shell command (`run:`) or an **action** (`uses:`), which is a reusable unit of code from a repository, such as `actions/checkout`.

## A first workflow

```yaml
name: hello

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    outputs:
      short-sha: ${{ steps.meta.outputs.short-sha }}
    steps:
      - uses: actions/checkout@v7

      - name: Show context
        run: |
          echo "Event: ${{ github.event_name }}"
          echo "Ref:   ${{ github.ref }}"
          ls -la

      - name: Compute short SHA
        id: meta
        run: echo "short-sha=${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"

  report:
    needs: build
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - run: echo "Built ${{ needs.build.outputs.short-sha }}"
```

Reading it top to bottom:

- **`on:`** runs it on pushes to `main`, on every pull request, and manually from the Actions tab (`workflow_dispatch`). For `pull_request`, the run checks out a temporary *merge* commit of the PR into its base branch, so CI tests what the result of merging would be.
- **`permissions:`** limits what the automatic `GITHUB_TOKEN` can do. Read-only is the right default (more in the security note).
- **`concurrency:`** groups runs by workflow and branch, and cancels an in-progress run when a newer one starts. Pushing three commits quickly then costs one run, not three.
- **`timeout-minutes`**: the default is 360 minutes. A hung test should fail in minutes, not burn six hours.
- **`actions/checkout`**: the runner starts empty. Nothing from the repository is there until this step runs.
- **`needs: build`** makes `report` wait for `build` and run only if it succeeded. Without `needs`, the two jobs would start at the same time.

## Expressions and contexts

`${{ ... }}` is an **expression**, evaluated by GitHub *before* the step runs, and substituted into the text. Expressions read from **contexts**:

| Context | Holds |
| --- | --- |
| `github` | Event name, ref, SHA, repository, actor, the full event payload |
| `env` | Variables set with `env:` at workflow, job or step level |
| `vars` / `secrets` | Repository or organisation configuration variables and secrets |
| `matrix` | The current matrix combination |
| `steps` / `needs` | Outputs of earlier steps in this job, or of jobs this one needs |
| `runner` | OS, architecture, temp directory |

`if:` conditions are expressions too, and the `${{ }}` can be left off there. Useful status functions are `success()` (the implicit default), `failure()`, `always()` and `cancelled()`, for example `if: failure()` on a step that uploads logs.

## Moving data around

This is the part that took me longest to get right:

- **Between steps in the same job**: they share a filesystem and working directory, so files just work. Environment variables don't carry over automatically. To set one for later steps, append to `$GITHUB_ENV`: `echo "APP_ENV=ci" >> "$GITHUB_ENV"`.
- **Step outputs**: append `name=value` to `$GITHUB_OUTPUT` in a step with an `id`, then read `steps.<id>.outputs.<name>`.
- **Between jobs**: each job is a new machine. Small values go through job `outputs:` and `needs.<job>.outputs`. Files go through **artifacts** (`actions/upload-artifact@v7` and `actions/download-artifact`).
- **Between runs**: the **cache** (`actions/cache@v6`, or a setup action's built-in cache) stores things like downloaded packages, keyed by a hash of the lockfile. A cache is an optimisation that may miss; an artifact is a deliverable you can rely on.

## Runners

GitHub-hosted runners (`ubuntu-latest`, `windows-latest`, `macos-latest`, plus arm64 variants such as `ubuntu-24.04-arm`) are fresh VMs for every job, with Docker, Python and common tools preinstalled. `ubuntu-latest` moves to a newer Ubuntu every so often; pin `ubuntu-24.04` (or whichever release is current) if the exact OS matters. Self-hosted runners exist, but they aren't something I need yet.

## Debugging

- **actionlint** catches syntax errors, bad expressions and unknown inputs before I push: `actionlint` from the repository root.
- **Re-run with debug logging** from the UI, or set the repository variable `ACTIONS_STEP_DEBUG` to `true`, to get verbose step logs.
- `echo '${{ toJSON(github) }}'` in a scratch workflow dumps the whole context, which is handy for finding the right field. Don't leave it in real workflows: event payloads can contain attacker-controlled text.

## Gotchas

- **No `pipefail` by default.** A `run:` step with no `shell:` uses `bash -e {0}`, so `pytest | tee log.txt` succeeds even when pytest fails. Setting `shell: bash` explicitly, or `defaults: run: shell: bash` at the top, gives `bash --noprofile --norc -eo pipefail {0}`.
- **Expressions are text substitution.** `run: echo "${{ github.event.pull_request.title }}"` pastes the title into a shell script, which is a script-injection hole. Pass untrusted values through `env:` instead.
- **Jobs don't share anything.** Installing dependencies in a `setup` job doesn't help a `test` job.
- **Path and branch filters on required checks.** If a workflow is skipped by a `paths:` filter, a required status check can sit at "pending" forever.
- **Scheduled workflows** run only on the default branch, and GitHub disables them in public repositories after 60 days without activity.

## Check yourself

1. Two jobs in one workflow have no `needs`. When do they run, and can the second read a file the first wrote?
2. How do I pass a value from one step to a later step, and from one job to another?
3. What does `concurrency` with `cancel-in-progress: true` do on a busy pull request?
4. Why can `pytest | tee out.txt` pass even though tests failed, and how do I fix it?
5. Why is `${{ github.event.pull_request.title }}` inside `run:` dangerous?

## Further reading

- [GitHub Actions: understanding GitHub Actions](https://docs.github.com/en/actions/get-started/understand-github-actions)
- [Workflow syntax reference](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [Contexts reference](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)
- [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [Workflow commands (GITHUB_OUTPUT, GITHUB_ENV)](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)
- [actionlint](https://github.com/rhysd/actionlint)
