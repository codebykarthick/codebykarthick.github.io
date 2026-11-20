---
title: Go errors and domain invariants
summary: Wrapping with %w, errors.Is, errors.As and errors.AsType, sentinel versus typed errors, validating constructors and an explicit job state machine that refuses forbidden transitions.
technologies: [go]
topics: [fundamentals, data-modelling, best-practices]
updated: 2026-11-20
---

Phase P1 of InferenceFlow builds the job domain with no HTTP and no database: jobs, submissions and a lifecycle of `received → queued → running → succeeded | failed | cancelled`. It is the phase where Go's error handling and type system do the most work, because the Roadmap's invariants (no conflicting terminal outcomes, no silent transitions) should be impossible to break by accident rather than merely tested for.

Coming from Java, the shift is that errors are ordinary return values rather than exceptions. There is no stack unwinding to rely on, so every function decides explicitly whether to handle, wrap or return an error.

## Three shapes of error

**Sentinel errors** are package-level values that callers compare against. They suit conditions where the caller only needs to know *which* thing went wrong.

```go
var (
	ErrNotFound            = errors.New("job not found")
	ErrIdempotencyConflict = errors.New("idempotency key reused with different request")
	ErrInvalidTransition   = errors.New("invalid transition")
)
```

**Typed errors** carry data. A forbidden transition should say which states were involved, and it can still match the sentinel by unwrapping to it:

```go
type TransitionError struct {
	From, To Status
}

func (e *TransitionError) Error() string {
	return fmt.Sprintf("job: cannot move from %s to %s", e.From, e.To)
}

func (e *TransitionError) Unwrap() error { return ErrInvalidTransition }
```

**Wrapped errors** add context on the way up without changing the identity of the cause:

```go
j, err := s.store.Get(ctx, tenantID, jobID)
if err != nil {
	return job.Job{}, fmt.Errorf("get job %s: %w", jobID, err)
}
```

## Inspecting errors

`%w` builds a chain; `errors.Is` walks it comparing values, and `errors.As` (or the generic `errors.AsType`, added in Go 1.26) walks it looking for a type:

```go
if errors.Is(err, job.ErrNotFound) {
	// 404
}
if te, ok := errors.AsType[*job.TransitionError](err); ok {
	log.Warn("rejected transition", "from", te.From, "to", te.To)
}
```

`errors.AsType` returns the typed value directly, so there is no `var te *TransitionError` declared beforehand and no risk of passing a non-pointer target.

The anti-patterns, all of which I have written in other languages' style:

```go
if err == job.ErrNotFound { ... }                   // breaks as soon as anyone wraps it
if strings.Contains(err.Error(), "not found") { ... } // couples to message text
return fmt.Errorf("get job: %v", err)               // %v flattens the chain; Is/As stop working
```

The `errorlint` linter catches the first and third.

**Choosing between them**: a sentinel is part of a package's API, so export one only when callers genuinely branch on it. A typed error is for when they need the details. Everything else can be wrapped context. Per the Go Code Review Comments, error strings are lower case with no trailing punctuation, because they get concatenated.

## Handle once

An error should be either handled or returned, not both. Logging at every layer and returning produces the same failure five times in the logs with no extra information. In InferenceFlow the HTTP layer is the one place that logs unexpected errors and maps them to the public error envelope; everything below wraps and returns.

## Constructors that validate

If a value can only be built through a constructor that checks it, every function receiving that value can trust it. Unexported fields make the constructor the only door:

```go
type Submission struct {
	key            string
	documentRef    string
	ruleSetVersion string
}

func NewSubmission(key, documentRef, ruleSetVersion string) (Submission, error) {
	var problems []string
	if key == "" || len(key) > 255 {
		problems = append(problems, "idempotency key must be 1-255 bytes")
	}
	if documentRef == "" {
		problems = append(problems, "document reference is required")
	}
	if ruleSetVersion == "" {
		problems = append(problems, "rule set version is required")
	}
	if len(problems) > 0 {
		return Submission{}, &ValidationError{Problems: problems}
	}
	return Submission{key: key, documentRef: documentRef, ruleSetVersion: ruleSetVersion}, nil
}
```

Reporting every problem at once makes for a better 400 response than failing on the first. `errors.Join` is the alternative when the individual problems are themselves errors.

## An explicit state machine

The job status is a named string type with constants, and the allowed transitions are data:

```go
var allowed = map[Status][]Status{
	StatusReceived: {StatusQueued, StatusCancelled},
	StatusQueued:   {StatusRunning, StatusCancelled},
	StatusRunning:  {StatusSucceeded, StatusFailed, StatusCancelled, StatusQueued}, // queued = retry
}

func (j Job) Transition(to Status, now time.Time) (Job, error) {
	for _, next := range allowed[j.status] {
		if next == to {
			j.status = to
			j.updatedAt = now
			return j, nil
		}
	}
	return j, &TransitionError{From: j.status, To: to}
}
```

This matrix is my illustrative version; the repository leaves the complete transition and cancellation matrix to its own `docs/correctness.md`. Terminal states simply have no entry, so nothing leaves them.

Two design points:

- **Value receiver, new value returned.** The caller's `Job` is never half-updated if a transition fails. The Roadmap's design question (methods on `Job` versus a pure `Transition(job, command)` function) is worth trying both ways; this is the method version.
- **Time is a parameter.** The domain never calls `time.Now()`. The application service passes its injected clock's value, so tests are deterministic.

Because `Job`'s fields are unexported, the only ways to change status are `Transition` and a `Restore` constructor that the storage adapter uses to rebuild a job, which rejects unknown status strings coming back from the database.

## Testing the invariants

A table test covers each allowed and forbidden edge and checks both `errors.Is` and the typed details. A fuzz test then throws random sequences at the machine and asserts the invariant rather than specific cases:

```go
f.Fuzz(func(t *testing.T, cmds []byte) {
	j := New("job-1", "tenant-a", mustSubmission(t), t0)
	for _, c := range cmds {
		next, err := j.Transition(statuses[int(c)%len(statuses)], t0)
		if j.Status().Terminal() && err == nil {
			t.Fatalf("left terminal state %s", j.Status())
		}
		j = next
	}
})
```

## Gotchas

- **The typed nil interface.** A nil `*TransitionError` stored in an `error` is not a nil `error`:

  ```go
  func check() error {
  	var e *TransitionError
  	return e // err != nil is true for the caller
  }
  ```

  Return a literal `nil` on success, never a typed nil pointer.
- **The zero value bypasses constructors.** Another package can still write `job.Submission{}`. Unexported fields stop it from setting bad values, not from using the zero value, so code that receives a value from outside should treat the zero value as invalid.
- **Named string types do not restrict values.** `job.Status("paused")` compiles. Validate at the boundaries where strings enter (JSON, SQL), as `Restore` does.
- **Do not panic for expected failures.** Panics are for programmer errors and broken invariants that cannot be handled, not for a missing job.
- **Wrapping is an API decision.** Once I wrap a driver error with `%w`, callers can `errors.As` it and start depending on pgx types. The storage adapter should map driver errors to domain errors first and wrap only those.

## Check yourself

1. When would I export a sentinel error, and when a typed error?
2. What breaks if a layer wraps with `%v` instead of `%w`?
3. Why does `Transition` use a value receiver and return a new `Job`?
4. How can a function return a non-nil `error` that holds a nil pointer, and how do I avoid it?
5. Which invariant does the fuzz test check, and why is that stronger than adding more table rows?

## Further reading

- [Working with errors in Go 1.13](https://go.dev/blog/go1.13-errors)
- [Errors are values](https://go.dev/blog/errors-are-values)
- [Package errors](https://pkg.go.dev/errors)
- [Effective Go, errors](https://go.dev/doc/effective_go#errors)
- [Go code review comments, error strings](https://go.dev/wiki/CodeReviewComments#error-strings)
- [Go fuzzing](https://go.dev/doc/security/fuzz/)
