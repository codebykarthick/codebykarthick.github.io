---
title: Go HTTP servers, timeouts and graceful shutdown
summary: A net/http server with explicit timeouts, ServeMux patterns, ordered middleware, chi where it helps, request contexts, signal-driven shutdown with a deadline, and health versus readiness.
technologies: [go]
topics: [fundamentals, networking, deployment, best-practices]
updated: 2026-11-20
---

InferenceFlow's first milestone (M0, phase P0) is a standard-library executable with `/healthz`, server timeouts and a SIGTERM shutdown that finishes within a documented budget. Phase P3 adds the job routes and middleware, first on `net/http` and then on chi. These notes cover both halves, because the shutdown and timeout decisions made at P0 shape everything that follows.

## Never use the zero-value server

`http.ListenAndServe(addr, handler)` builds a server with no timeouts at all. A client that sends headers one byte a minute holds a connection and a goroutine forever. I always construct the server:

```go
srv := &http.Server{
	Handler:           httpapi.NewHandler(svc, health, logger).Routes(),
	ReadHeaderTimeout: 5 * time.Second,  // slow headers (slowloris)
	ReadTimeout:       10 * time.Second, // headers plus the whole body
	WriteTimeout:      15 * time.Second, // from end of headers to end of response
	IdleTimeout:       60 * time.Second, // keep-alive connections between requests
	ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
}
```

The values are illustrative. The Roadmap's point is that they should be derived from budgets: the maximum body size at the slowest client I accept sets `ReadTimeout`, and `WriteTimeout` must be longer than the longest handler deadline, or the connection is cut while the handler is still working and the client sees a reset instead of a response.

## Routing with ServeMux patterns

Since Go 1.22 the standard multiplexer understands methods and wildcards, which covers the whole planned API:

```go
api := http.NewServeMux()
api.HandleFunc("POST /v1/jobs", h.submit)
api.HandleFunc("GET /v1/jobs/{job_id}", h.get)

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	j, err := h.svc.Get(r.Context(), tenantFrom(r.Context()), r.PathValue("job_id"))
	// ...
}
```

The most specific pattern wins, a path that matches with the wrong method gets an automatic 405 with an `Allow` header, and `r.Pattern` holds the matched pattern, which is exactly the bounded route label metrics need.

## Middleware and its order

Middleware is just `func(http.Handler) http.Handler`. A small helper applies a list so that the first one listed is outermost:

```go
type middleware func(http.Handler) http.Handler

func chain(h http.Handler, mws ...middleware) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

return chain(mux, requestID, recoverer(h.log)) // request ID exists before a panic is logged
```

Order is a design decision: request IDs before logging, recovery around everything that might panic, authentication before anything that reads tenant data, and per-request deadlines inside authentication. The panic recoverer must re-panic `http.ErrAbortHandler`, which handlers use deliberately to abort a response:

```go
defer func() {
	if v := recover(); v != nil {
		if err, ok := v.(error); ok && errors.Is(err, http.ErrAbortHandler) {
			panic(v)
		}
		log.ErrorContext(r.Context(), "panic", "value", v, "stack", string(debug.Stack()))
		writeError(w, r, http.StatusInternalServerError, "internal", "Internal error.")
	}
}()
```

## Handlers translate, nothing more

The submit handler checks transport concerns and hands a validated command to the application:

```go
if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "application/json" {
	writeError(w, r, http.StatusUnsupportedMediaType, "unsupported_media_type", "Content-Type must be application/json.")
	return
}
var req submitRequest
dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
dec.DisallowUnknownFields() // a contract decision, not a default
if err := dec.Decode(&req); err != nil {
	if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
		writeError(w, r, http.StatusRequestEntityTooLarge, "body_too_large", "Request body is too large.")
		return
	}
	writeError(w, r, http.StatusBadRequest, "malformed_json", "Request body is not valid JSON.")
	return
}
```

The tenant comes from the authenticated context, never from the body, and one `fail` function maps domain errors (`ErrNotFound` to 404, `ErrIdempotencyConflict` to 409, anything unknown to a logged, sanitised 500) into the `{code, message, request_id}` envelope. Whether unknown fields are rejected is one of the things the repository says to settle in OpenAPI; I reject them in the sketch so tests can show both choices.

## When chi earns its place

chi keeps the standard `http.Handler` and middleware signatures, so the handlers move over unchanged. In chi v5.5.0 it also fills `r.PathValue`, which I confirmed with the same handler tests:

```go
r := chi.NewRouter()
r.Use(requestID, chimw.CleanPath, recoverer(h.log))
r.Route("/v1/jobs", func(r chi.Router) {
	r.Use(devAuth, withDeadline(5*time.Second))
	r.Post("/", h.submit)
	r.Get("/{job_id}", h.get)
})
```

What it adds is route groups with their own middleware stacks and a library of middleware. What it does not add is validation, binding or architecture. Note the import alias: chi's package is named `middleware`, which collides with a local `middleware` type.

## Request context and accepted work

`r.Context()` is cancelled when the client disconnects or the handler returns. That is right for synchronous work (stop the database query nobody is waiting for) and wrong for anything that must outlive the request. An accepted InferenceFlow job is durable state; workers pick it up with their own context. Starting `go process(r.Context(), job)` from a handler loses the work the moment the client hangs up.

## Signal-driven shutdown

```go
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	context.AfterFunc(ctx, stop) // a second Ctrl-C kills the process immediately

	if err := run(ctx, os.Getenv, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "api:", err)
		os.Exit(1)
	}
}
```

Inside `run`, after starting `srv.Serve` in a goroutine:

```go
select {
case err := <-serveErr:
	return err // Serve failed before any signal
case <-ctx.Done():
}

health.SetReady(false)
shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cfg.ShutdownTimeout)
defer cancel()
if err := srv.Shutdown(shutdownCtx); err != nil {
	return fmt.Errorf("shutdown: %w", err)
}
if err := <-serveErr; !errors.Is(err, http.ErrServerClosed) {
	return err
}
return nil
```

`Shutdown` closes listeners, closes idle connections and waits for active ones; if the deadline passes it returns the context error. `context.WithoutCancel` keeps the parent's values but drops its (already fired) cancellation, so the drain gets its full budget. Workers and relays need their own drain on the same signal; `Shutdown` only knows about HTTP.

Because `run` takes a context, `getenv` and a writer, a test can start it on `127.0.0.1:0`, cancel the context and assert it returns within the budget, which is the scripted SIGTERM proof P0 asks for.

## Health versus readiness

`/healthz` answers "is the process alive?" and checks nothing downstream; if it probed PostgreSQL, a database blip would get every replica restarted. `/readyz` answers "should traffic come here?": it fails while starting, fails first during shutdown so the load balancer stops sending new requests, and may run bounded checks of dependencies this process needs.

## Gotchas

- **`ListenAndServe` returns `ErrServerClosed` as soon as `Shutdown` starts.** If `main` returns then, in-flight requests are cut. Wait for `Shutdown` to return.
- **`Shutdown` does not wait for hijacked connections** such as WebSockets; use `RegisterOnShutdown` for those.
- **chi's `middleware.RealIP` is deprecated** in v5.5.0 because it trusts spoofable forwarding headers. Derive client IPs only from proxies you control.
- **`WriteTimeout` does not stop the handler.** It keeps running, its writes start failing, and the client sees a dropped connection. Keep handler deadlines shorter so the handler can still send a proper error.
- **Do not register on `http.DefaultServeMux`.** Any imported package can add routes to it (`net/http/pprof` does).

## Check yourself

1. Which `http.Server` timeout protects against slow headers, and why must `WriteTimeout` exceed handler deadlines?
2. Why should `/healthz` avoid checking the database?
3. What happens to an accepted job if processing starts with `r.Context()` and the client disconnects?
4. In what order should request ID, recovery and authentication middleware run, and why?
5. Why does the shutdown context use `context.WithoutCancel(ctx)` rather than `ctx` itself?

## Further reading

- [Package net/http](https://pkg.go.dev/net/http), especially `Server` and `Server.Shutdown`
- [Routing enhancements for Go 1.22](https://go.dev/blog/routing-enhancements)
- [Package os/signal](https://pkg.go.dev/os/signal)
- [Package context](https://pkg.go.dev/context)
- [chi router](https://github.com/go-chi/chi)
- [Kubernetes liveness, readiness and startup probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/)
