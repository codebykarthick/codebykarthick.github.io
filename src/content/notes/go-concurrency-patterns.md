---
title: Go concurrency patterns
summary: Goroutine ownership, cancellation, a bounded worker pool with backpressure, semaphores, errgroup with SetLimit, pipelines, finding goroutine leaks, and why a channel is not a durable queue.
technologies: [go]
topics: [fundamentals, performance, best-practices]
updated: 2026-11-20
---

Phase P5 runs InferenceFlow's queued jobs through in-process workers that call a deliberately slow inference stub. The exit gate is about bounds, not speed: concurrency and queue length stay bounded under 10x offered load, a normal stop drains within a fixed budget, cancelled work releases its resources, and the race detector is clean. Goroutines make concurrency cheap to start, which is exactly why it needs rules.

## Ownership rules

Three questions for every goroutine I write:

1. **Who starts it, and who waits for it?** The owner that starts goroutines waits for them (`sync.WaitGroup`, `errgroup`) before returning.
2. **How does it stop?** Every blocking operation sits in a `select` with `<-ctx.Done()`, or reads from a channel that is guaranteed to close.
3. **Who closes the channel?** The sender, and only one of them. Receivers never close; closing twice or sending on a closed channel panics.

Go 1.25 added `sync.WaitGroup.Go`, which does the `Add(1)`/`defer Done()` dance for me, so I use it everywhere below.

## A bounded worker pool

A fixed number of workers reads from a buffered channel of fixed capacity. When the buffer is full, submission fails fast instead of spawning another goroutine:

```go
var ErrQueueFull = errors.New("scheduling: queue full")

func (p *Pool) TrySubmit(t Task) error {
	select {
	case p.tasks <- t:
		return nil
	default:
		return ErrQueueFull // the caller decides: reject, retry later, or leave it in the database
	}
}

// Run blocks until ctx is cancelled and every in-flight task has returned.
func (p *Pool) Run(ctx context.Context) {
	var wg sync.WaitGroup
	for range p.workers {
		wg.Go(func() { p.work(ctx) })
	}
	wg.Wait()
}

func (p *Pool) work(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case t := <-p.tasks:
			if ctx.Err() != nil {
				return // select picks randomly; do not start new work after stop
			}
			// In-flight work survives the stop signal but not its own budget,
			// so draining is bounded by attemptTimeout.
			tctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), p.attemptTimeout)
			if err := p.handle(tctx, t); err != nil {
				p.log.ErrorContext(tctx, "task failed", "job_id", t.JobID, "err", err)
			}
			cancel()
		}
	}
}
```

Cancelling `ctx` stops workers taking new tasks. A task already running keeps going on a context detached from the stop signal but capped at `attemptTimeout`, so the worst-case drain is known. Tasks still in the buffer are dropped, which is acceptable only because the job is durable in PostgreSQL and will be picked up again. In a synctest test with 3 workers and capacity 5, 20 rapid submissions accept 8, reject 12, and peak concurrency never exceeds 3.

The anti-pattern this replaces is `go handle(job)` per submission: no limit, no backpressure, and no way to wait for it during shutdown.

## Work that must outlive the request

The Roadmap's cancellation exercise has two halves. A client abandoning a *synchronous* request should cancel the work, so that path uses `r.Context()`. An *accepted asynchronous* job must not depend on the submit request at all; its processing context belongs to the worker's lifecycle. `context.WithoutCancel` is the tool when I need a parent's values (trace IDs) without its cancellation.

## errgroup for scoped subtasks

For a batch of related work with a shared fate, `errgroup` gives structured concurrency: a concurrency limit, the first error cancels the rest, and `Wait` returns that error.

```go
func ProcessBatch(ctx context.Context, ids []string, limit int, fn func(context.Context, string) error) error {
	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(limit)
	for _, id := range ids {
		if ctx.Err() != nil {
			break // stop launching once something failed
		}
		g.Go(func() error { return fn(ctx, id) }) // blocks while limit goroutines run
	}
	return g.Wait()
}
```

Because `g.Go` blocks at the limit, the loop itself is backpressured. `g.TryGo` is the non-blocking variant.

## Semaphores as a decorator

A worker pool limits workers; sometimes I need to limit one *dependency* regardless of how many callers there are. The Roadmap's example is a hard cap on inference calls independent of worker count. A weighted semaphore wrapped around the client does that without touching callers:

```go
type LimitedInferer struct {
	sem  *semaphore.Weighted
	next Inferer
}

func (l *LimitedInferer) Infer(ctx context.Context, req InferRequest) (InferResponse, error) {
	if err := l.sem.Acquire(ctx, 1); err != nil {
		return InferResponse{}, err // ctx ended while waiting for a slot
	}
	defer l.sem.Release(1)
	return l.next.Infer(ctx, req)
}
```

Fifty concurrent callers through a limit of 2 peak at exactly 2 in-flight calls. The `defer` matters: a permit leaked on an error path shrinks capacity permanently.

| | Worker pool | Semaphore |
|---|---|---|
| Goroutines | fixed N, long-lived | one per caller, short-lived |
| Waiting work | in a bounded channel | blocked callers |
| Full behaviour | explicit (`ErrQueueFull`) | callers wait until ctx ends |
| Good for | owning a stream of tasks | capping one dependency |

## Pipelines: fan-out and fan-in

A stage reads from an input channel with several workers and merges into one output it owns and closes:

```go
func Normalise(ctx context.Context, in <-chan string, workers int) <-chan string {
	out := make(chan string)
	var wg sync.WaitGroup
	for range workers {
		wg.Go(func() {
			for doc := range in {
				select {
				case out <- strings.TrimSpace(doc):
				case <-ctx.Done():
					return
				}
			}
		})
	}
	go func() { wg.Wait(); close(out) }()
	return out
}
```

The pattern atlas warns that pipelines only pay off for genuinely independent stages; one sequential task per job does not need one.

## Finding goroutine leaks

The classic leak: a goroutine sends on an unbuffered channel that nobody will read after a timeout.

```go
func FirstResult(ctx context.Context, call func() string) (string, error) {
	ch := make(chan string, 1) // unbuffered here would leak the sender on timeout
	go func() { ch <- call() }()
	select {
	case r := <-ch:
		return r, nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}
```

Two tools caught the unbuffered version for me. Inside a `synctest.Test` bubble, the test fails with "deadlock: main bubble goroutine has exited but blocked goroutines remain". At run time, Go 1.27's new `goroutineleak` profile (via `runtime/pprof` or `/debug/pprof/goroutineleak`) reported the blocked sender and its line, using garbage-collector reachability to decide that nothing can ever unblock it.

## Mutex or channel?

Channels hand off ownership of data; mutexes protect shared state. The in-memory job store is a map behind a `sync.Mutex`, and that is the simpler, correct choice. Forcing it through a channel-owning goroutine adds a lifecycle without adding safety.

## Channels are not durable queues

A buffered channel lives in one process's memory. A crash, deploy or `kill -9` loses everything in it. InferenceFlow treats the channel as a short in-memory hand-off in front of durable state: accepted jobs are rows in PostgreSQL first, and P7 replaces in-memory dispatch with database leases precisely so nothing depends on the channel surviving.

## Gotchas

- **A panic in any goroutine crashes the process**, and `WaitGroup.Go` documents that `f` must not panic. Recover per task if one bad job must not take the worker down.
- **`select` chooses randomly among ready cases**, so after cancellation a worker may still receive a task. Check `ctx.Err()` before starting it.
- **Unbounded fan-out hides in loops**: `for _, d := range docs { go process(d) }` with 10,000 documents is 10,000 goroutines and 10,000 concurrent calls.
- **Closing a channel while senders may still send panics.** Close after `wg.Wait()` of every sender, as `Normalise` does.
- **The race detector only sees executed paths.** Tests need real concurrent access to the same data to find anything.

## Check yourself

1. Who should close `out` in a fan-in stage, and what must happen first?
2. What does `TrySubmit` do when the queue is full, and why is that better than blocking or spawning a goroutine?
3. Why do in-flight tasks use `context.WithoutCancel` plus a timeout instead of the pool's context directly?
4. When is a semaphore a better fit than a worker pool?
5. Why is it safe for the pool to drop buffered tasks on shutdown in InferenceFlow, and when would it not be?

## Further reading

- [Go concurrency patterns, pipelines and cancellation](https://go.dev/blog/pipelines)
- [Go concurrency patterns, context](https://go.dev/blog/context)
- [Package errgroup](https://pkg.go.dev/golang.org/x/sync/errgroup) and [package semaphore](https://pkg.go.dev/golang.org/x/sync/semaphore)
- [The Go memory model](https://go.dev/ref/mem)
- [Go code review comments, goroutine lifetimes](https://go.dev/wiki/CodeReviewComments#goroutine-lifetimes)
- [Package runtime/pprof](https://pkg.go.dev/runtime/pprof)
- [Data race detector](https://go.dev/doc/articles/race_detector)
