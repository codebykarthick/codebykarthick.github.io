---
name: Go
summary: The language for my InferenceFlow systems capstone, learnt through the patterns that keep a concurrent, durable service correct.
status: learning
started: 2026-11-15
links:
  docs: https://go.dev/doc/
  repo: https://github.com/golang/go
language: []
lifecycle: [design, build, test, operate]
domain: [backend, devops]
kind: [language]
prerequisites: []
roadmap:
  - title: Toolchain, project layout and code hygiene
    goal: Set up a Go module whose layout, formatting, linting, race checks and vulnerability scans run the same way on my laptop and in CI.
    apply: "InferenceFlow P0: establish the Go toolchain and a thin executable"
    learn:
      - Modules versus packages, the go directive, and how toolchain selection works
      - Why executables live under cmd/ and what internal/ actually enforces
      - go vet, gofmt, go test -race and go mod tidy as everyday commands
      - Tool dependencies with go get -tool and go tool (govulncheck, goose)
      - A golangci-lint v2 configuration with a small set of linters I can justify
    practice:
      - Create the module with cmd/api and one internal package, and no empty placeholder packages
      - Add Makefile targets for fmt, vet, lint, test-race and vuln, and make the check target pass
      - Stamp a version into the binary and log it at start-up
    doneWhen:
      - I can explain module versus package and what internal/ prevents
      - make check runs vet, lint, race tests and govulncheck with zero findings
    notes: [go-project-layout-and-tooling]
  - title: Domain modelling, errors and invariants
    goal: Model jobs so that invalid submissions and forbidden transitions are rejected by types and constructors rather than by scattered if statements.
    apply: "InferenceFlow P1: model the domain; learn Go through invariants"
    learn:
      - Errors as values, wrapping with %w, errors.Is, errors.As and errors.AsType
      - Sentinel errors versus typed errors, and when each is the right contract
      - Unexported fields and validating constructors to protect invariants
      - Explicit state machines with a transition matrix and typed transition errors
      - Value versus pointer receivers, zero values, and the typed nil interface trap
      - Injecting time instead of calling time.Now inside the domain
    practice:
      - Implement the job status matrix and a Transition method that returns a typed error
      - Write an errors.Is and errors.AsType test matrix for every forbidden transition
      - Fuzz random command sequences and assert terminal states are never left
    doneWhen:
      - Every forbidden transition has a test and a typed error with both states
      - No code outside the domain package can set a job's status directly
    notes: [go-errors-and-domain-invariants]
  - title: Boundaries, interfaces, dependency injection and testing
    goal: Build a use case that does not know whether its store is in memory or PostgreSQL, wired by hand in main and tested with fakes.
    apply: "InferenceFlow P2: boundaries, testing, and dependency injection"
    learn:
      - Accept interfaces, return structs, and why Go interfaces belong to the consumer
      - Explicit constructors, a composition root, and no hidden goroutines or globals
      - Config structs versus functional options
      - Table-driven tests, subtests, t.Helper, t.Cleanup and t.Context
      - Fakes over mocks, httptest, golden files and fuzzing
      - testing/synctest for time-dependent and concurrent code
    practice:
      - Write a failing fake store that returns conflict, timeout and transient errors, and show the service tests stay unchanged
      - Wire service, store, logger and clock in cmd/api/main.go only
      - Write an ADR on why manual dependency injection fits this project
    doneWhen:
      - I can explain dependency injection, a port, an adapter and a mock, and when no interface is needed
      - The application package imports neither net/http nor a database driver
    notes: [go-interfaces-and-dependency-injection, go-testing-practices]
  - title: HTTP services, timeouts and graceful shutdown
    goal: Serve the job API with net/http (then chi) using explicit timeouts, ordered middleware and a bounded, signal-driven shutdown.
    apply: "InferenceFlow P0 and P3: establish the Go toolchain and a thin executable; HTTP APIs, middleware and framework selection"
    learn:
      - http.Server timeouts and why the zero values are unsafe
      - ServeMux method and wildcard patterns, r.PathValue and r.Pattern
      - Middleware as func(http.Handler) http.Handler and why order matters
      - Body limits, content-type checks and one place that maps errors to the public envelope
      - signal.NotifyContext, Server.Shutdown with a deadline, and health versus readiness
      - What chi adds over ServeMux, and what it does not
    practice:
      - Implement submit and poll handlers with httptest coverage for malformed, oversized and conflicting requests
      - Prove SIGTERM stops the server within the documented drain budget with a test of run(ctx)
      - Port the routes to chi without changing a single handler
    doneWhen:
      - Handlers only translate HTTP into application calls
      - A test shows shutdown completes within its budget and readiness fails first
    notes: [go-http-servers-timeouts-and-graceful-shutdown, writing-a-dockerfile-for-go]
  - title: SQL-first persistence with pgx, sqlc and goose
    goal: Replace the in-memory store with PostgreSQL using reviewed migrations, generated typed queries and short explicit transactions.
    apply: "InferenceFlow P4: PostgreSQL, SQL-first persistence and transactions"
    learn:
      - goose migration files and running migrations as a deliberate step
      - sqlc configuration for pgx/v5, named parameters and type overrides
      - pgxpool sizing and why one pool belongs to the process
      - A transaction helper that always rolls back on error
      - Atomic create-or-get with INSERT ... ON CONFLICT DO NOTHING
      - Mapping pgconn.PgError codes into domain errors
    practice:
      - Run 20 concurrent duplicate submissions and prove they converge on one job
      - Inject a failure between the job insert and the audit insert and prove both roll back
      - Run the integration tests against postgres:18 locally and in CI
    doneWhen:
      - The concurrent duplicate-submit test passes against a real database
      - Constraint violations surface as domain errors, never as raw driver errors
    notes: [postgresql-essentials-for-app-developers, docker-compose-go-and-postgres, go-postgres-with-pgx-sqlc-and-goose, postgresql-indexes-and-explain, go-ci-with-postgres-service-containers]
  - title: Concurrency patterns
    goal: Process queued jobs with bounded workers, explicit backpressure and cancellation, and no goroutine that outlives its owner.
    apply: "InferenceFlow P5: goroutines, bounded pipelines and cancellation"
    learn:
      - Goroutine and channel ownership, and who closes what
      - Bounded worker pools versus semaphores, and what a full queue should do
      - errgroup with SetLimit for scoped, cancellable subtasks
      - Fan-out and fan-in pipelines that stop on cancellation
      - Job-owned contexts so accepted work survives a client disconnect
      - Finding leaks with synctest and the Go 1.27 goroutineleak profile
    practice:
      - Build the worker pool with a bounded queue and test the concurrency cap under 10x offered load
      - Implement the semaphore alternative and compare capacity, fairness and error propagation
      - Stop the process mid-batch and record drain time and leaked goroutines
    doneWhen:
      - go test -race passes and the peak concurrency never exceeds the configured limit
      - A normal stop drains within a fixed budget
    notes: [go-concurrency-patterns]
  - title: Resilience for outbound calls
    goal: Call the inference service through one reusable client with deadlines, classified failures, jittered retries and a retry budget.
    apply: "InferenceFlow P6: outbound integrations and resilience engineering"
    learn:
      - http.Client and Transport reuse, connection pool limits and timeouts
      - Retryable, permanent and unknown outcomes, and why the third matters
      - Exponential backoff with full jitter, Retry-After and retry budgets
      - Idempotency keys as the precondition for safe retries
      - Circuit breakers, load shedding and per-tenant bulkheads
    practice:
      - Map each stub fault mode (429, 503, timeout, malformed JSON, connection close) to a class and test it
      - Show that a retry budget stops a retry storm against a failing stub
      - Add admission control that returns 503 with Retry-After instead of queueing forever
    doneWhen:
      - Fault tests show bounded outbound concurrency and correct budget exhaustion
      - The retry policy is written down and linked to operation semantics
    notes: [go-resilience-patterns]
  - title: Durable work with leases, fencing and an outbox
    goal: Survive crashes by claiming work in PostgreSQL with leases and fencing tokens, then publish events through a transactional outbox.
    apply: "InferenceFlow P7 and P8: durable job state, leases, and consistency; outbox, events, and reliable asynchronous messaging"
    learn:
      - FOR UPDATE SKIP LOCKED for concurrent claiming
      - Time-based leases, heartbeats, and why fencing tokens decide who may write
      - Retry scheduling, attempt history and poison jobs
      - The transactional outbox, a relay, and at-least-once delivery
      - Idempotent consumers with an inbox table or state guards
    practice:
      - Let two workers claim concurrently and prove the sets are disjoint
      - Expire worker A's lease, let worker B finish, and prove A's late completion is rejected
      - Crash the relay after publishing and before marking, and prove the consumer applies the effect once
    doneWhen:
      - Killing the process with jobs in flight leaves every job recoverable or terminal
      - No stale completion can overwrite a newer attempt
    notes: [postgresql-transactions-and-isolation, go-durable-work-leases-and-outbox]
  - title: Observability with slog and OpenTelemetry
    goal: Answer why a tenant's job is stuck from logs, traces and metrics alone.
    apply: "InferenceFlow P9: observability and operational ownership"
    learn:
      - Structured JSON logs with log/slog and request-scoped attributes
      - Keeping secrets, document text and raw tenant IDs out of telemetry
      - OpenTelemetry tracer setup, otelhttp, and propagating context through an outbox
      - Span links for asynchronous work
      - RED metrics with bounded labels and a Prometheus-compatible endpoint
    practice:
      - Add a metric labelled with job_id, watch its series multiply, then replace it with bounded labels
      - Slow the inference stub and find the bottleneck from one trace
      - Write the stuck-job section of the runbook using only telemetry
    doneWhen:
      - Every log line in a request carries request and trace IDs
      - Another engineer can diagnose a seeded fault with the runbook and telemetry
    notes: [go-observability-with-slog-and-opentelemetry]
resources:
  - title: Effective Go
    url: https://go.dev/doc/effective_go
    kind: docs
  - title: How to write Go code
    url: https://go.dev/doc/code
    kind: tutorial
  - title: Go code review comments
    url: https://go.dev/wiki/CodeReviewComments
    kind: article
  - title: Go standard library
    url: https://pkg.go.dev/std
    kind: docs
  - title: Go concurrency patterns, pipelines and cancellation
    url: https://go.dev/blog/pipelines
    kind: article
  - title: Go 1.27 release notes
    url: https://go.dev/doc/go1.27
    kind: docs
---

## Why I'm learning it

Most of my work so far has been machine learning, with an earlier stretch of Java and Spring on the backend. Training models is one job; building the reliable systems around them is another, and that's the part I want to get good at. Go fits that systems layer well: one static binary, a standard library that covers HTTP, JSON, contexts and testing, cheap goroutines, and a toolchain (formatter, vet, race detector, fuzzer, vulnerability checker) that comes with the language.

The harder part is unlearning habits. Spring taught me DI containers, annotations, an interface for every class and exceptions for control flow. Idiomatic Go goes the other way: explicit constructors, errors as values, small interfaces declared by the code that uses them, and concurrency with clear ownership. This roadmap is about those patterns rather than syntax.

## How it relates to InferenceFlow

InferenceFlow is my end-to-end Go capstone: a multi-tenant service that accepts document jobs, schedules them, calls an inference service, evaluates versioned rules and exposes status and results. Its build plan lives in the [system-in-go repository](https://github.com/codebykarthick/system-in-go), whose Roadmap.md defines phases P0 to P15, milestones and exit gates.

This page is the companion to that plan, not a copy of it. Each stage teaches the Go patterns and practices one or more phases need, and its "Where I apply it" line names the phase. The repository decides *what* to build and when; the notes here explain *how* to build it idiomatically and which traps to avoid, such as Java-style factories, one interface per type, hidden goroutines in constructors, channels used as durable queues and claims of exactly-once processing.

Code in the notes is illustrative. I compile and test every sketch against Go 1.27 before writing it up, but the names, schema and configuration in the real repository are decided there, phase by phase.

## How to use this roadmap

Work through the stages in order, alongside the matching phase:

1. **Toolchain and hygiene** before writing any domain code, so every later change is checked the same way.
2. **Domain and errors**, then **boundaries and testing**: together they make up milestone M1, and they set the style for everything else.
3. **HTTP** next. The shutdown half belongs to P0, so read that note early and come back for the routing and middleware half at P3.
4. **Persistence**, **concurrency** and **resilience** in that order, because worker pools assume durable state and retries assume classified failures.
5. **Durable work** spans P7 and P8. Get leases and fencing right in PostgreSQL before adding a broker.
6. **Observability** last as a stage, but start structured logging from the first executable.

Each stage's "done when" items are deliberately checkable. If I cannot demonstrate one with a test or a transcript, the stage is not done, however familiar the material feels.
