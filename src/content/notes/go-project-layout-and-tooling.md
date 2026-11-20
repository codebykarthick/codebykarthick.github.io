---
title: Go project layout and tooling
summary: Modules, cmd/ and internal/, tool directives in go.mod, a golangci-lint v2 config, govulncheck and the race detector, set up once so every later phase is checked the same way.
technologies: [go]
topics: [setup, best-practices, ci-cd]
updated: 2026-11-20
---

InferenceFlow's first phase (P0) is deliberately small: a module, one executable and a health endpoint. The point is not the endpoint; it is getting the toolchain and checks in place before there is anything to break. These notes are what I set up and why.

## Modules and packages

A **module** is the unit of versioning: one `go.mod`, one module path, one set of dependency requirements. A **package** is one directory of `.go` files compiled together. Imports name packages by module path plus directory, so `example.com/inferenceflow/internal/job` is the `job` package inside that module. (The real module path is an M0 decision in the repository; I use `example.com/inferenceflow` in sketches.)

```text
go.mod
go.sum
Makefile
.golangci.yml
cmd/
  api/main.go          # package main: the composition root
internal/
  httpapi/             # grows one cohesive package at a time
```

Two rules carry most of the weight:

- **Executables go under `cmd/<name>`.** Each directory is a `package main` with a tiny `main` that wires dependencies and calls `run`. A second binary (the worker or relay at M6) is a new directory, not a flag.
- **`internal/` is enforced by the compiler.** A package under `internal/` can only be imported by code rooted at the parent of that `internal` directory. It is not about exported identifiers; it is about who may import the package at all.

What I am avoiding, following the Roadmap: `pkg/`, `utils/`, `common/`, directories of interfaces, and empty packages created in advance to match a diagram. Packages appear when a cohesive responsibility does.

## The go directive and toolchains

```text
module example.com/inferenceflow

go 1.27.4

tool golang.org/x/vuln/cmd/govulncheck
```

The `go` line is a minimum: it sets the language version for the module and the oldest toolchain allowed to build it. With the default `GOTOOLCHAIN=auto`, an older local `go` command downloads a newer toolchain if `go.mod` asks for one. Pinning the patch release makes CI and laptops agree without a separate version file.

## Everyday commands

```sh
go build ./...          # compile everything
go vet ./...            # suspicious constructs the compiler accepts
gofmt -l .              # list unformatted files (CI fails if non-empty)
go test ./...           # tests, plus a subset of vet checks
go test -race ./...     # tests with the race detector
go mod tidy             # add missing and remove unused requirements
go doc net/http.Server  # read API docs offline
```

`go test` runs a small set of vet checks automatically; in Go 1.27 that includes `stdversion`, which reports standard library symbols newer than the module's `go` line. `go fix` was rebuilt in Go 1.26 around "modernizers" that rewrite code to current idioms, which is worth running after bumping the `go` line.

## Tool dependencies in go.mod

Since Go 1.24, tools can be tracked in `go.mod` with `tool` directives instead of a `tools.go` file with blank imports:

```sh
go get -tool golang.org/x/vuln/cmd/govulncheck@v1.10.0
go get -tool github.com/pressly/goose/v3/cmd/goose@v3.30.1

go tool govulncheck ./...
go tool goose -dir db/migrations status
```

The versions are pinned by `go.mod` and `go.sum` like any other dependency, so everyone runs the same build. The cost is that a tool's own dependencies join the module graph.

Two exceptions. **golangci-lint**'s documentation explicitly discourages `go install` and `go tool` installs and recommends its prebuilt binaries, so I pin a binary version in CI instead. **sqlc** I run from its pinned container image (`sqlc/sqlc:1.31.1`) or a pinned binary.

## Linting with golangci-lint v2

Version 2 changed the configuration format: a `version: "2"` key, a `linters.default` set, and formatters configured separately. I keep the list short and only enable linters whose findings I would act on:

```yaml
version: "2"

linters:
  default: standard      # errcheck, govet, ineffassign, staticcheck, unused
  enable:
    - bodyclose          # http.Response bodies that are never closed
    - errorlint          # == or type assertions on errors that may be wrapped
    - gosec              # common security mistakes
    - noctx              # HTTP requests, SQL and listeners without a context
    - nilerr             # returning nil right after checking err != nil
  exclusions:
    generated: strict    # skip sqlc output
    presets: [std-error-handling]
    rules:
      - path: _test\.go
        linters: [gosec, noctx]

formatters:
  enable: [gofmt, goimports]
```

Each one maps to a failure InferenceFlow cares about: `bodyclose` and `noctx` to the inference client, `errorlint` to wrapped domain errors. Running this config (v2.15.0) against my practice code found a real issue: chi's `middleware.RealIP` is now deprecated because it trusts spoofable headers. When a finding is a false positive, I suppress it on the line with a reason (`//nolint:gosec // jitter needs no cryptographic randomness`) rather than disabling the linter. `golangci-lint config verify` checks the file against the schema.

## Vulnerabilities and races

`govulncheck` reports known vulnerabilities only where my code can actually reach the vulnerable symbol, so its output is short enough to act on. It belongs in CI and in the P10 security review.

The race detector instruments memory accesses at run time and reports concurrent unsynchronised access. It only sees paths the tests execute, so a clean `-race` run is evidence, not proof. From P5 onwards, `go test -race ./...` is a required check.

## A Makefile as the single entry point

The Roadmap asks for `fmt`, `test`, `vet` and `run` targets. I add the rest so CI and I run identical commands:

```make
.PHONY: fmt vet lint test test-race vuln check run

fmt:
	gofmt -l -w .
vet:
	go vet ./...
lint:
	golangci-lint run
test:
	go test ./...
test-race:
	go test -race ./...
vuln:
	go tool govulncheck ./...
check: vet lint test-race vuln
run:
	go run ./cmd/api
```

## Version metadata

P0 asks to log build metadata. A package-level variable set by the linker is the simplest route:

```go
var version = "dev" // go build -ldflags "-X main.version=$(git describe --tags)"
```

`go build` in a Git checkout also stamps the commit into the binary, readable at run time through `runtime/debug.ReadBuildInfo` (the `vcs.revision` setting), which is useful when no tag exists.

## Gotchas

- **`internal/` is not encapsulation of identifiers.** Exported names inside `internal/foo` are still exported to every allowed importer.
- **`go mod tidy` removes requirements nothing imports yet.** Adding a dependency "for later" does not survive tidy, which is the Roadmap's advice anyway.
- **`gofmt -l` prints names; it does not fail.** CI needs `test -z "$(gofmt -l .)"`.
- **The race detector needs a supported platform** and slows tests noticeably. Run it on every CI build, not only before releases.
- **Generated code needs its own check.** Lint skips it, so CI should regenerate (or run `sqlc diff`) and fail on drift.

## Check yourself

1. What is the difference between a module and a package, and which one does `internal/` restrict?
2. Why does InferenceFlow put each executable in its own `cmd/` directory instead of one binary with a mode flag?
3. What does the `tool` directive buy over installing tools with `go install`, and why is golangci-lint the exception?
4. Why can a clean `go test -race` run still hide a data race?
5. Which linter in the config above would catch an unclosed response body from the inference client?

## Further reading

- [How to write Go code](https://go.dev/doc/code)
- [Go module layout guide](https://go.dev/doc/modules/layout)
- [Go modules reference](https://go.dev/ref/mod) and [Go toolchains](https://go.dev/doc/toolchain)
- [Managing dependencies, including tools](https://go.dev/doc/modules/managing-dependencies)
- [golangci-lint configuration file](https://golangci-lint.run/docs/configuration/file/) and [local installation](https://golangci-lint.run/docs/welcome/install/local/)
- [Tutorial: find and fix vulnerable dependencies with govulncheck](https://go.dev/doc/tutorial/govulncheck)
- [Data race detector](https://go.dev/doc/articles/race_detector)
