---
title: InferenceFlow
summary: An end-to-end Go systems project. A reliable, observable, multi-tenant platform for orchestrating document processing and ML inference, built one working increment at a time.
status: planned
stack: [go, postgresql, docker, github-actions]
repo: https://github.com/codebykarthick/system-in-go
started: 2026-11-15
---

## What it is

Customers submit document references. InferenceFlow validates submissions, schedules work, calls an inference service, evaluates versioned policy rules, and exposes job status and results. The interesting part isn't the happy path but keeping that workflow correct when requests repeat, dependencies slow down, workers crash and tenants compete for capacity.

The build plan lives in the repository: the [README](https://github.com/codebykarthick/system-in-go#readme) describes the system, and [Roadmap.md](https://github.com/codebykarthick/system-in-go/blob/main/Roadmap.md) sets out phases P0 to P15, milestones, exercises and a pattern atlas. The [Go roadmap](/stack/go) on this site is the companion: each stage teaches the patterns and practices one of those phases needs.

## Status

Documentation only so far. The next increment is M0: a standard-library HTTP executable with a health check, timeouts and bounded shutdown.

## Milestones

| Milestone | Deliverable |
|---|---|
| M0 | Go module, `cmd/api`, `/healthz`, signal handling |
| M1 | Job state machine, rules, application service, in-memory repository |
| M2 | Submit, poll, cancel and result routes, with OpenAPI |
| M3 | PostgreSQL, migrations, typed queries, transactions |
| M4 | Bounded workers, inference stub and adapter |
| M5 | Leases, fencing, attempt history, scheduled retries |
| M6 | Transactional outbox, relay, JetStream, a separate worker |
| M7 | Telemetry, runbook, authenticated tenancy, quotas |
| M8 | Compatibility checks and a measured performance improvement |
| M9 | Compose, CI, deployment and a fault campaign |
| M10 | Optional focused technology comparisons |

## What done looks like

These are learning targets, not demonstrated results:

- A batch of 1,000 small jobs runs without unbounded queue or goroutine growth.
- Replaying the same tenant, key and request returns one logical job, and conflicting reuse is rejected.
- A killed worker leaves its work recoverable through lease expiry and retries.
- A resumed stale worker can't overwrite a newer attempt's result.
- Transient inference failures recover, or reach a documented terminal state within retry budgets.
- One tenant can't read, cancel or fetch another tenant's jobs.
- Someone else can start the system, inject a fault, diagnose it and recover using only the repository docs.
