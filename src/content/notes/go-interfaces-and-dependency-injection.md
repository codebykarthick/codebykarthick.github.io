---
title: Go interfaces and dependency injection
summary: Accept interfaces and return structs, small consumer-owned interfaces, explicit constructors, a composition root in main, config structs versus functional options, and why no DI framework yet.
technologies: [go]
topics: [fundamentals, best-practices, testing]
updated: 2026-11-20
---

In Spring, I annotated classes and let the container find and wire them. In Go there is no container by default, and InferenceFlow's Roadmap asks me not to add one: phase P2 is about building a use case that does not know whether jobs live in memory or in PostgreSQL, wired by hand. These notes cover the handful of patterns that make that work without ceremony.

Dependency injection here just means the caller supplies a value's collaborators. The application service does not reach for a global database handle, build its own HTTP client or call `time.Now()` directly. That is the whole idea; the rest is where to put the interfaces and the wiring.

## Accept interfaces, return structs

Go interfaces are satisfied implicitly: any type with the right methods implements the interface, without declaring it. That changes who should own the interface. In Java, the provider publishes `JobRepository` next to `JobRepositoryImpl`. In Go, the **consumer** declares the smallest interface it needs, and the provider just has methods.

```go
// package application: the consumer owns the port
type JobStore interface {
	CreateOrGet(ctx context.Context, tenantID, key, requestHash string, j job.Job) (job.Job, bool, error)
	Get(ctx context.Context, tenantID, jobID string) (job.Job, error)
}

type Service struct {
	store JobStore
	now   func() time.Time
	newID func() string
	log   *slog.Logger
}

func NewService(store JobStore, now func() time.Time, newID func() string, log *slog.Logger) *Service {
	return &Service{store: store, now: now, newID: newID, log: log}
}
```

`NewService` accepts an interface (so any store works) and returns a concrete `*Service` (so callers get every method and the package can add methods without breaking anyone). This is the shape of the Roadmap's illustrative repository contract.

The HTTP package does the same thing one level up. It does not import `*application.Service` as a dependency type; it declares what it calls:

```go
// package httpapi
type jobService interface {
	Submit(ctx context.Context, tenantID string, sub job.Submission) (job.Job, bool, error)
	Get(ctx context.Context, tenantID, jobID string) (job.Job, error)
}
```

The interface is unexported because nobody outside `httpapi` needs it. A handler test can pass a fake that implements two methods, without building a service and a store.

An adapter can still assert, at compile time, that it fits the port:

```go
var _ application.JobStore = (*memstore.Store)(nil)
```

## What not to bring from Java

The Roadmap's list of Go pattern traps is a good mirror for my habits:

```go
// Anti-pattern: provider-side interface, one per struct, mirroring every method.
type IJobRepository interface {
	Create(...) error
	Update(...) error
	Delete(...) error
	FindByID(...) (*Job, error)
	FindAll(...) ([]*Job, error)
	// ...twelve more
}
type JobRepositoryImpl struct{ db *pgxpool.Pool }
```

An interface earns its place at a real boundary where I want a second implementation (a fake in tests, Postgres instead of memory, a different inference transport). A function that only ever talks to one concrete type can take that type. Abstract factories, service locators and `utils` packages full of interfaces are solving problems Go does not have.

## Constructors do no hidden work

A constructor builds a value and returns it. It does not open network connections it has not been given, start goroutines, or read environment variables:

```go
pool := scheduling.NewPool(handle, scheduling.WithWorkers(8)) // builds only
go pool.Run(ctx)                                               // lifecycle is explicit
```

Hidden goroutines in constructors are hard to stop and leak in tests. If something needs a lifecycle, give it `Run(ctx)` or `Start`/`Close` and let the owner call them.

Small dependencies do not need interfaces at all. A clock is `func() time.Time`, an ID generator is `func() string`. In production they are `time.Now` and a closure over `uuid.NewV7` (the standard library gained a `uuid` package in Go 1.27); in tests they are fixed values.

## The composition root

All of the real construction happens in one place, `cmd/api/main.go`, in a `run` function that returns an error instead of calling `log.Fatal` so it can be tested:

```go
func run(ctx context.Context, getenv func(string) string, stdout io.Writer) error {
	cfg, err := loadConfig(getenv)
	if err != nil {
		return err
	}
	logger := slog.New(slog.NewJSONHandler(stdout, nil)).With("version", version)

	svc := application.NewService(memstore.New(), time.Now,
		func() string { return uuid.NewV7().String() }, logger)
	health := &httpapi.Health{}
	srv := &http.Server{Handler: httpapi.NewHandler(svc, health, logger).Routes() /* timeouts... */}
	// listen, serve, wait for ctx, shut down
}
```

At P4, `memstore.New()` becomes `postgres.NewJobStore(pool)` and nothing else changes: not the service, not the handlers, not their tests. That is the exit gate for P2, and the test of whether the boundaries are right.

`context.Context` is not a dependency container. It carries deadlines, cancellation and request-scoped values such as a request ID or the authenticated principal. A database pool or logger smuggled through `ctx.Value` is a global with extra steps.

## Config structs or functional options

For components configured by the application, a plain struct with a `Validate` method is clearest. It is easy to fill from environment variables, easy to print, and errors are reported before anything starts:

```go
type Config struct {
	BaseURL        string
	AttemptTimeout time.Duration
	MaxAttempts    int
	BaseDelay      time.Duration
	MaxDelay       time.Duration
}

func (c Config) Validate() error {
	var errs []error
	if c.BaseURL == "" {
		errs = append(errs, errors.New("BaseURL is required"))
	}
	if c.AttemptTimeout <= 0 || c.MaxAttempts < 1 || c.BaseDelay <= 0 || c.MaxDelay < c.BaseDelay {
		errs = append(errs, errors.New("timeouts, attempts and delays must be positive and MaxDelay >= BaseDelay"))
	}
	return errors.Join(errs...) // nil when errs is empty
}

client, err := inference.NewClient(httpClient, cfg, budget) // calls Validate first
```

Functional options suit a reusable component with sensible defaults and several optional knobs, where most callers change nothing:

```go
type Option func(*Pool)

func WithWorkers(n int) Option       { return func(p *Pool) { p.workers = n } }
func WithQueueCapacity(n int) Option { return func(p *Pool) { p.tasks = make(chan Task, n) } }

pool := scheduling.NewPool(handle, scheduling.WithWorkers(8), scheduling.WithQueueCapacity(64))
```

The pattern atlas puts it well: better than a twelve-argument constructor for a library, often worse than a config struct inside one application. Options also hide validation; a config struct makes "is this combination valid?" one function.

## Why no DI framework yet

Manual wiring is compile-checked, greppable and debuggable with a stack trace. The Roadmap's notes on the alternatives: Google's Wire repository was archived in August 2025, so it is history rather than a new dependency, and Uber Fx is a phase P15 comparison lab, to be adopted only if the dependency graph becomes measurably painful to wire by hand. Fx adds lifecycle hooks and runtime graph resolution at the cost of indirection; I want to feel the pain it solves before paying that cost.

## Gotchas

- **A nil pointer in an interface is not a nil interface.** Returning `(*Store)(nil)` as a `JobStore` gives callers a non-nil interface whose methods panic. Return a literal `nil` or an error.
- **Interfaces with one implementation and no test double** are usually noise. Delete them and use the concrete type until a second implementation exists.
- **Package-level variables and `init()` side effects** (a global pool, a default logger set during import) defeat the composition root. Keep `init` for registering things like drivers, if at all.
- **Storing a `context.Context` in a struct** ties a long-lived value to one request's lifetime. Pass `ctx` as the first parameter instead.
- **Import cycles are a design signal.** If `postgres` needs `httpapi`, a boundary is in the wrong place.

## Check yourself

1. Why does the interface for the job store live in the application package rather than the Postgres package?
2. What does "return structs" protect when a package adds a method later?
3. Where may the code that reads `DATABASE_URL` and opens the pool live, and why only there?
4. When would I choose functional options over a config struct in InferenceFlow?
5. What would have to be true before Fx is worth adding?

## Further reading

- [Effective Go, interfaces](https://go.dev/doc/effective_go#interfaces)
- [Go code review comments, interfaces](https://go.dev/wiki/CodeReviewComments#interfaces)
- [Go code review comments, contexts](https://go.dev/wiki/CodeReviewComments#contexts)
- [Package context](https://pkg.go.dev/context)
- [Google Wire repository and archive notice](https://github.com/google/wire)
- [Uber Fx documentation](https://pkg.go.dev/go.uber.org/fx)
