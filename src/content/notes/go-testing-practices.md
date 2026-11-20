---
title: Go testing practices
summary: Table-driven tests, t.Helper and t.Cleanup, fakes over mocks, httptest and golden files, the race detector, fuzzing, testing/synctest for time, and integration tests against a real Postgres.
technologies: [go]
topics: [testing, best-practices]
updated: 2026-11-20
---

Every InferenceFlow phase ends with "a failing-then-passing test showing the problem solved". The standard `testing` package covers almost everything that needs, so I learn it properly before reaching for assertion libraries. These are the techniques I use from P1 onwards, roughly in the order the project needs them.

## Table-driven tests and subtests

A slice of cases plus `t.Run` gives one readable list of boundaries, and each case reports and reruns independently (`go test -run 'TestTransition/succeeded_is_terminal'`):

```go
func TestTransition(t *testing.T) {
	tests := []struct {
		name    string
		path    []Status // how to reach the starting state
		to      Status
		wantErr bool
	}{
		{"received to queued", nil, StatusQueued, false},
		{"received cannot run", nil, StatusRunning, true},
		{"succeeded is terminal", []Status{StatusQueued, StatusRunning, StatusSucceeded}, StatusFailed, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			j := jobIn(t, tt.path...)
			_, err := j.Transition(tt.to, t0)
			if got := errors.Is(err, ErrInvalidTransition); got != tt.wantErr {
				t.Fatalf("Transition(%s): err = %v, wantErr %v", tt.to, err, tt.wantErr)
			}
		})
	}
}
```

Since Go 1.22 each loop iteration has its own `tt`, so the old `tt := tt` line before `t.Parallel()` is unnecessary. Failure messages follow the Code Review Comments style: what was called, what came back, what was wanted.

## Helpers, cleanup and context

```go
func jobIn(t *testing.T, path ...Status) Job {
	t.Helper() // failures point at the caller's line, not this one
	j := New("job-1", "tenant-a", mustSubmission(t), t0)
	for _, s := range path {
		var err error
		if j, err = j.Transition(s, t0); err != nil {
			t.Fatalf("setup transition to %s: %v", s, err)
		}
	}
	return j
}
```

`t.Cleanup(fn)` registers teardown that runs even when the test fails, in reverse order, which beats `defer` inside helpers. `t.Context()` (Go 1.24) returns a context cancelled just before cleanups run, so code under test gets a context that ends with the test.

## Fakes over mocks

For the application layer I write small hand-made fakes that hold state or return a configured error, then assert on outcomes rather than on which methods were called:

```go
type failingStore struct{ err error }

func (f failingStore) CreateOrGet(context.Context, string, string, string, job.Job) (job.Job, bool, error) {
	return job.Job{}, false, f.err
}
func (f failingStore) Get(context.Context, string, string) (job.Job, error) {
	return job.Job{}, f.err
}

func TestSubmitWrapsStoreFailures(t *testing.T) {
	svc := newService(t, failingStore{err: context.DeadlineExceeded})
	_, _, err := svc.Submit(t.Context(), "tenant-a", submission(t, "documents/a.pdf"))
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want it to wrap DeadlineExceeded", err)
	}
}
```

The in-memory store doubles as a realistic fake for idempotency and tenant-scoping tests. Mock frameworks that verify call sequences tie tests to implementation details; the P2 exercise of swapping the store without touching business tests only works if the tests check behaviour.

## HTTP handlers with httptest

`httptest.NewRecorder` exercises a handler without a listener. Testing through the full `Routes()` handler means middleware (request IDs, auth, panic recovery) participates too:

```go
req := httptest.NewRequest(http.MethodPost, "/v1/jobs", strings.NewReader(body))
req.Header.Set("Content-Type", "application/json")
req.Header.Set("Idempotency-Key", "document-demo-001")
rec := httptest.NewRecorder()
handler.ServeHTTP(rec, req)
if rec.Code != http.StatusCreated {
	t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
}
```

A table of malformed JSON, unknown fields, oversized bodies, missing keys and conflicts covers most of the P3 contract matrix.

## Golden files

For response bodies, comparing against a file in `testdata/` keeps expected output reviewable in diffs. A flag regenerates it deliberately:

```go
var update = flag.Bool("update", false, "rewrite golden files")

func assertGolden(t *testing.T, name string, got []byte) {
	t.Helper()
	path := filepath.Join("testdata", name)
	if *update {
		if err := os.WriteFile(path, got, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read golden (run with -update to create): %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Errorf("mismatch with %s\n got: %s\nwant: %s", path, got, want)
	}
}
```

`go test ./internal/httpapi -run TestSubmitCreated -update` rewrites it; the diff then shows exactly what changed in the contract. The `go` tool ignores `testdata` directories when building.

## Fuzzing

A fuzz target receives generated inputs and asserts properties. `go test -fuzz=FuzzTransitions -fuzztime=30s` runs it; any failing input is saved under `testdata/fuzz/` and becomes a permanent regression case on every normal `go test`. The Roadmap wants fuzzing on the rule parser, JSON normalisation and IDs as well as the state machine.

## The race detector

`go test -race ./...` reports unsynchronised concurrent access on the paths the tests execute. It is mandatory from P5, but it only finds races that tests provoke, so concurrent tests need real concurrency (several goroutines hitting the same store) to be worth running under it.

## Time and concurrency with testing/synctest

Retry backoff, lease heartbeats and drain budgets all involve waiting. `testing/synctest` runs a test in a "bubble" with a fake clock that only advances when every goroutine in the bubble is blocked, so a test of a 3-second `Retry-After` finishes instantly and deterministically:

```go
func TestRetriesTransientFailures(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		srv, calls := stub(t, http.StatusServiceUnavailable, http.StatusTooManyRequests)
		c := newClient(t, srv, inference.NewRetryBudget(10, 0.1))
		start := time.Now()
		if _, err := c.Infer(t.Context(), inference.Request{DocumentRef: "documents/a.pdf"}); err != nil {
			t.Fatal(err)
		}
		if calls.Load() != 3 || time.Since(start) < 3*time.Second {
			t.Errorf("calls=%d elapsed=%v", calls.Load(), time.Since(start))
		}
	})
}
```

Here `stub` uses `httptest.NewTestServer`, new in Go 1.27, which serves over an in-memory network so HTTP works inside a bubble. Go 1.27 also added `synctest.Sleep`, which sleeps and then waits for the other goroutines to settle. A bonus I did not expect: if goroutines are still blocked when the bubble's main function returns, the test fails with "deadlock: main bubble goroutine has exited but blocked goroutines remain", which catches leaks.

## Integration tests against real Postgres

Fakes cannot prove that `ON CONFLICT`, `SKIP LOCKED` or a rollback behave as I think. Those tests run against the real engine, once per package, from `TestMain`:

```go
func runTests(m *testing.M) int {
	flag.Parse() // needed before testing.Short in TestMain
	if testing.Short() {
		return 0 // go test -short skips the integration suite
	}
	ctx := context.Background()
	dsn := os.Getenv("DATABASE_URL") // a Compose or CI service container
	if dsn == "" {
		ctr, err := tcpostgres.Run(ctx, "postgres:18",
			tcpostgres.WithDatabase("inferenceflow"),
			tcpostgres.WithUsername("app"),
			tcpostgres.WithPassword("app"),
			tcpostgres.BasicWaitStrategies(),
		)
		defer func() { _ = testcontainers.TerminateContainer(ctr) }()
		if err != nil {
			log.Print(err)
			return 1
		}
		if dsn, err = ctr.ConnectionString(ctx, "sslmode=disable"); err != nil {
			log.Print(err)
			return 1
		}
	}
	// open a pgxpool, run goose migrations, then:
	return m.Run()
}
```

The same suite runs against a Compose service locally, a GitHub Actions service container in CI (both via `DATABASE_URL`), or a throwaway testcontainers-go v0.45.0 container when neither is set. Tests share one database, so each truncates its tables first and none use `t.Parallel()`.

## Gotchas

- **`t.Fatal` only works on the test's own goroutine.** From a goroutine the test started, use `t.Error` and return.
- **`time.Sleep` in tests is a flakiness generator.** Use `synctest`, or synchronise on a channel or condition.
- **synctest bubbles must stay self-contained**: no real network, no external processes. Integration tests do not belong in a bubble.
- **A test that passes alone and fails in the suite** usually shares state: a package-level variable, a golden file, or database rows.
- **Golden files are code.** Review `-update` diffs as carefully as source changes.

## Check yourself

1. Why should application tests use fakes and assert outcomes rather than verify calls with a mock?
2. What does `t.Helper()` change, and what does `t.Context()` give me that `context.Background()` does not?
3. How does a synctest bubble decide when to advance its clock?
4. Which InferenceFlow guarantees need a real Postgres in the test, and why can no fake prove them?
5. Where does a failing fuzz input end up, and what happens to it afterwards?

## Further reading

- [Package testing](https://pkg.go.dev/testing)
- [Package testing/synctest](https://pkg.go.dev/testing/synctest) and [Testing concurrent code with testing/synctest](https://go.dev/blog/synctest)
- [Package net/http/httptest](https://pkg.go.dev/net/http/httptest)
- [Go fuzzing](https://go.dev/doc/security/fuzz/)
- [Data race detector](https://go.dev/doc/articles/race_detector)
- [Go code review comments, useful test failures](https://go.dev/wiki/CodeReviewComments#useful-test-failures)
- [Testcontainers for Go, Postgres module](https://golang.testcontainers.org/modules/postgres/)
