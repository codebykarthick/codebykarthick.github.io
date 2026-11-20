---
title: Go resilience patterns for outbound calls
summary: One reusable HTTP client with deadlines, classified failures, exponential backoff with full jitter, retry budgets, idempotency keys, circuit breakers, load shedding and per-tenant bulkheads.
technologies: [go]
topics: [networking, performance, best-practices]
updated: 2026-11-20
---

Phase P6 puts a proper adapter between InferenceFlow's workers and the inference service. The stub is built to misbehave on demand (delay, 429, 503, timeouts, malformed JSON, dropped connections), and the exit gate asks for bounded outbound concurrency, correct budget exhaustion and no silent success. Every pattern here answers one question: what happens to the rest of the system when this dependency is slow or wrong?

## One client, configured once

`http.Client` and its `Transport` hold the connection pool, so the process builds one and shares it. A new client per request means new TCP and TLS handshakes every time and idle connections nobody reuses.

```go
func NewHTTPClient() *http.Client {
	t := http.DefaultTransport.(*http.Transport).Clone() // keeps proxy, dial and TLS timeouts
	t.MaxIdleConnsPerHost = 32                           // default is 2: too few for a worker pool
	t.ResponseHeaderTimeout = 10 * time.Second
	return &http.Client{Transport: t, Timeout: 60 * time.Second} // backstop only
}
```

`http.DefaultMaxIdleConnsPerHost` is 2, so with 16 workers calling one host, most connections are closed after each request instead of being reused. `Client.Timeout` covers the whole exchange including reading the body; I treat it as a backstop and do the real budgeting with contexts: a per-attempt deadline inside a larger per-job budget, as the Roadmap prescribes.

Two response-handling habits: always `defer resp.Body.Close()`, and decode through `io.LimitReader` so a misbehaving service cannot make me buffer an unbounded body. Closing the body is enough for connection reuse; the docs note it drains the remainder asynchronously up to a conservative limit.

## Classify every failure

Retrying is only correct if I know what kind of failure I have. The Roadmap distinguishes transient, permanent and unknown outcomes:

```go
type Class int

const (
	Retryable Class = iota // safe and useful to try again
	Permanent              // trying again will fail the same way
	Unknown                // request may have reached the server; outcome unknown
)

type CallError struct {
	Class      Class
	Status     int
	RetryAfter time.Duration
	Err        error
}
```

How I map the stub's fault modes in the sketch (the real taxonomy is a project decision):

| Outcome | Class | Why |
|---|---|---|
| 429, 503 | Retryable | the server said "not now"; honour `Retry-After` |
| 502, 504 | Retryable | a proxy could not reach a healthy backend |
| other 4xx | Permanent | the request itself is wrong |
| malformed JSON | Permanent | a broken contract does not fix itself on retry |
| timeout, reset after sending | Unknown | the server may have done the work |
| caller's context cancelled | not retried | nobody is waiting for the answer |

`Unknown` is the dangerous one. Inference here is read-only, so retrying an unknown outcome is safe. For a chargeable or mutating call, the README is clear that retrying needs provider-side idempotency.

## Exponential backoff with full jitter

Retrying immediately, or on a fixed schedule, makes every failed client retry at the same moment and hammer a recovering service. Exponential backoff spreads retries out; full jitter (a random delay between zero and the exponential ceiling) de-synchronises clients:

```go
// FullJitter returns a random delay in [0, min(max, base*2^attempt)).
func FullJitter(attempt int, base, max time.Duration) time.Duration {
	ceiling := max
	if attempt < 30 && base<<attempt < max {
		ceiling = base << attempt
	}
	return rand.N(ceiling) //nolint:gosec // jitter needs no cryptographic randomness
}
```

`rand.N` from `math/rand/v2` works directly on `time.Duration`. The retry loop sleeps on a timer that also watches the context, and respects the server's `Retry-After` when it asks for longer:

```go
for attempt := range c.cfg.MaxAttempts {
	if attempt > 0 {
		if !c.budget.Withdraw() {
			return Response{}, fmt.Errorf("retry budget exhausted: %w", lastErr)
		}
		delay := FullJitter(attempt-1, c.cfg.BaseDelay, c.cfg.MaxDelay)
		if ce, ok := errors.AsType[*CallError](lastErr); ok && ce.RetryAfter > delay {
			delay = min(ce.RetryAfter, c.cfg.MaxDelay)
		}
		if err := sleep(ctx, delay); err != nil {
			return Response{}, err
		}
	}
	resp, err := c.once(ctx, req) // applies the per-attempt deadline
	if err == nil {
		c.budget.Deposit()
		return resp, nil
	}
	if ctx.Err() != nil {
		return Response{}, ctx.Err() // the caller gave up: never retry
	}
	if ce, ok := errors.AsType[*CallError](err); !ok || ce.Class == Permanent {
		return Response{}, err
	}
	lastErr = err
}
```

## Retry budgets

A per-call attempt limit does not stop a storm. If the service is down, every call retries its maximum, and load on the dependency multiplies exactly when it can least cope. A retry budget caps retries as a fraction of successful traffic:

```go
// RetryBudget allows roughly ratio retries per success, plus a small reserve.
func (b *RetryBudget) Deposit() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.tokens = min(b.limit, b.tokens+b.ratio)
}

func (b *RetryBudget) Withdraw() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
```

With a ratio of 0.1, steady state allows about one retry per ten successes; when everything fails, the reserve drains and calls fail fast. Retries also multiply across layers (client, job, broker redelivery), so retry each failure type at one layer only.

## Idempotency keys make retries safe

InferenceFlow's inbound API requires an `Idempotency-Key`, so a client retrying after a lost response gets the same job back. Outbound, a retried mutating call is only safe if the provider deduplicates on a key I send; otherwise a timeout leaves an unknown outcome to record, not to retry blindly.

## Circuit breakers

A breaker counts recent failures and, past a threshold, fails calls immediately ("open") for a cool-down, then lets probes through ("half-open") before closing again. The Roadmap marks it optional: adopt one only after measurements show retries and timeouts are not enough, and use a maintained library such as `sony/gobreaker` or a small experiment rather than inventing a production breaker.

## Load shedding and admission control

An unbounded queue is a hidden outage: latency grows until everything times out. Rejecting excess work early is kinder. A semaphore's `TryAcquire` turns a capacity limit into an explicit 503:

```go
func shed(max int64) middleware {
	sem := semaphore.NewWeighted(max)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !sem.TryAcquire(1) {
				w.Header().Set("Retry-After", "1")
				writeError(w, r, http.StatusServiceUnavailable, "overloaded", "Server is at capacity; retry later.")
				return
			}
			defer sem.Release(1)
			next.ServeHTTP(w, r)
		})
	}
}
```

## Bulkheads per tenant

A bulkhead partitions capacity so one consumer cannot take it all. Per-tenant semaphores keep a noisy tenant from starving the others; separate limits for inference and database work keep one slow dependency from occupying every worker:

```go
func (b *TenantBulkhead) TryAcquire(tenant string) (release func(), ok bool) {
	b.mu.Lock()
	sem, found := b.sems[tenant]
	if !found {
		sem = semaphore.NewWeighted(b.perTenant)
		b.sems[tenant] = sem
	}
	b.mu.Unlock()
	if !sem.TryAcquire(1) {
		return nil, false
	}
	return func() { sem.Release(1) }, true
}
```

This is in-flight isolation, not fairness; P10 asks me to state the fairness I actually implement and verify it under noisy-neighbour load.

## Testing faults deterministically

`httptest.NewTestServer` (Go 1.27) serves over an in-memory network, so a fake inference service runs inside a `testing/synctest` bubble with a fake clock. A test returning 503, then 429 with `Retry-After: 3`, then success verifies three calls and three seconds of fake time, instantly. Injecting `srv.Client()` is dependency injection paying off.

## Gotchas

- **Retrying after the caller's context ends** wastes capacity on answers nobody will read. Check `ctx.Err()` first.
- **`Client.Timeout` keeps running while the body is read.** A large response read slowly can time out after `Do` returned successfully.
- **A request body is consumed by the first attempt.** Build a fresh request per attempt (or rely on `GetBody`, which `NewRequestWithContext` sets for `bytes.Reader` bodies).
- **Fallbacks must not invent answers.** The Roadmap allows a fallback such as `manual_review` only where the product contract permits it; never turn an unknown model result into "safe".

## Check yourself

1. Why is `MaxIdleConnsPerHost` worth raising for a worker pool calling one service?
2. Which failures are retryable, which are permanent, and why does "unknown" need its own class?
3. What problem does full jitter solve that plain exponential backoff does not?
4. How does a retry budget behave when the dependency is completely down?
5. What is the difference between load shedding, a bulkhead and a circuit breaker?

## Further reading

- [Package net/http, Client](https://pkg.go.dev/net/http#Client) and [Transport](https://pkg.go.dev/net/http#Transport)
- [Go concurrency patterns, context](https://go.dev/blog/context)
- [Timeouts, retries and backoff with jitter (Amazon Builders' Library)](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)
- [Handling overload (Google SRE book)](https://sre.google/sre-book/handling-overload/)
- [Package semaphore](https://pkg.go.dev/golang.org/x/sync/semaphore)
- [sony/gobreaker](https://github.com/sony/gobreaker)
