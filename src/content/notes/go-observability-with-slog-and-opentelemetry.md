---
title: Go observability with slog and OpenTelemetry
summary: Structured logs with log/slog and request-scoped attributes, OpenTelemetry traces propagated through an outbox, RED metrics with bounded labels, and what belongs in logs, metrics or traces.
technologies: [go]
topics: [debugging, best-practices, performance]
updated: 2026-11-20
---

Phase P9's goal is a question: *why is tenant X's job stuck?*, answered from evidence rather than guesswork. Its exit gate is that another engineer can diagnose three seeded faults using only the telemetry and the runbook. That shapes what I instrument: not dashboards for decoration, but the signals that separate API latency, queue wait, inference time and end-to-end job latency.

I tested the code below with OpenTelemetry Go v1.47.0, otelhttp v0.72.0 and Prometheus client_golang v1.25.0.

## What goes where

| Signal | Answers | InferenceFlow contents |
|---|---|---|
| Logs | what happened to *this* request or job? | request, trace and job IDs, stage, attempt, error class, tenant pseudonym |
| Metrics | how much, how fast, how often, across everything? | rates, errors, durations, backlog, oldest queued age, retries |
| Traces | where did the time go across components? | ingress, transaction, outbox, delivery, inference, result commit |
| Audit events | what changed durably, and who did it? | state transitions and operator actions, in PostgreSQL |

The README's rule for the boundary: job and request IDs belong in logs and traces, never in metric labels.

## Structured logging with slog

`log/slog` is the standard library's structured logger. One JSON handler, built in `main` and passed to components like any other dependency:

```go
func NewLogger(w io.Writer, level slog.Leveler) *slog.Logger {
	h := slog.NewJSONHandler(w, &slog.HandlerOptions{Level: level})
	return slog.New(ContextHandler{h})
}

logger.InfoContext(ctx, "job submitted", "job_id", j.ID(), "created", created)
```

Passing a `*slog.Logger` explicitly keeps tests quiet (`slog.New(slog.DiscardHandler)`) and avoids a hidden global. Always use the `...Context` methods, because the handler can only enrich a record with what the context carries.

## Request-scoped attributes and trace IDs

I want every log line during a request to carry its request ID and trace ID without every function threading them through. A small handler wrapper reads them from the context:

```go
type ContextHandler struct{ slog.Handler }

func (h ContextHandler) Handle(ctx context.Context, r slog.Record) error {
	if attrs, ok := ctx.Value(attrsKey{}).([]slog.Attr); ok {
		r.AddAttrs(attrs...)
	}
	if sc := trace.SpanContextFromContext(ctx); sc.IsValid() {
		r.AddAttrs(slog.String("trace_id", sc.TraceID().String()),
			slog.String("span_id", sc.SpanID().String()))
	}
	return h.Handler.Handle(ctx, r)
}

// Without these two, logger.With(...) would return the inner handler and drop the wrapper.
func (h ContextHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return ContextHandler{h.Handler.WithAttrs(attrs)}
}
func (h ContextHandler) WithGroup(name string) slog.Handler {
	return ContextHandler{h.Handler.WithGroup(name)}
}

func WithLogAttrs(ctx context.Context, attrs ...slog.Attr) context.Context {
	existing, _ := ctx.Value(attrsKey{}).([]slog.Attr)
	merged := append(existing[:len(existing):len(existing)], attrs...) // never share the backing array
	return context.WithValue(ctx, attrsKey{}, merged)
}
```

Middleware calls `WithLogAttrs(r.Context(), slog.String("request_id", id))` once, and a worker does the same with `job_id` and `attempt` when it claims a job.

## Keeping secrets and tenants out

Logs must never contain document text, tokens or credentials, and the README asks for a *tenant pseudonym* rather than the raw tenant ID. `slog.LogValuer` lets a type decide how it is logged, wherever it is logged:

```go
type Tenant struct {
	ID  string
	Key []byte // secret, from configuration
}

func (t Tenant) LogValue() slog.Value {
	m := hmac.New(sha256.New, t.Key)
	m.Write([]byte(t.ID))
	return slog.StringValue(hex.EncodeToString(m.Sum(nil))[:16])
}
```

A keyed HMAC rather than a plain hash, because tenant IDs are guessable and a plain hash of a guessable value is reversible by trying them all. The pseudonym is still stable, so all of one tenant's lines can be correlated.

## Tracing with OpenTelemetry

Setup happens once in `main`; the exporter reads `OTEL_EXPORTER_OTLP_ENDPOINT` (one of the README's proposed settings) from the environment:

```go
func SetupTracing(ctx context.Context, service, version string) (func(context.Context) error, error) {
	exp, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, fmt.Errorf("otlp exporter: %w", err)
	}
	res, err := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceName(service), semconv.ServiceVersion(version)),
		resource.WithFromEnv(), resource.WithTelemetrySDK())
	if err != nil {
		return nil, err
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exp), sdktrace.WithResource(res))
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{}, propagation.Baggage{}))
	return tp.Shutdown, nil // call during graceful shutdown, or buffered spans are lost
}
```

`otelhttp.NewHandler(mux, "api")` gives every inbound request a server span, and `otelhttp.NewTransport(base)` on the inference client propagates the W3C `traceparent` header outbound. Manual spans go around the operations the runbook cares about, with errors recorded on the span:

```go
func Traced(ctx context.Context, name string, fn func(context.Context) error) error {
	ctx, span := tracer.Start(ctx, name)
	defer span.End()
	if err := fn(ctx); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "failed")
		return err
	}
	return nil
}

err := Traced(ctx, "inference.infer", func(ctx context.Context) error {
	resp, err = client.Infer(ctx, req)
	return err
})
```

## Traces across the outbox

An HTTP request ends long before its job runs, so the trace context must travel inside the event envelope (the Roadmap's `trace_context` field). For delayed work, the Roadmap suggests a span link instead of a parent: the processing span starts a new trace and points back at the submit span, rather than stretching one trace over minutes or hours.

```go
func InjectTraceContext(ctx context.Context) map[string]string {
	carrier := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier)
	return carrier // stored in the envelope's trace_context
}

func StartFromEvent(ctx context.Context, traceContext map[string]string, jobID string) (context.Context, trace.Span) {
	enqueued := otel.GetTextMapPropagator().Extract(context.Background(), propagation.MapCarrier(traceContext))
	return tracer.Start(ctx, "job.process",
		trace.WithNewRoot(),
		trace.WithLinks(trace.LinkFromContext(enqueued)),
		trace.WithSpanKind(trace.SpanKindConsumer),
		trace.WithAttributes(attribute.String("inferenceflow.job_id", jobID)))
}
```

An in-memory span recorder test confirms the processing span has no parent and exactly one link, to the submit span's trace.

## RED metrics with bounded labels

Rate, errors and duration per route. The label must be the route *pattern*, not the path, or every job ID becomes a new time series. Go 1.22+ `ServeMux` records the matched pattern in `r.Pattern`:

```go
func (m *HTTPMetrics) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, code: http.StatusOK}
		next.ServeHTTP(rec, r)
		route := r.Pattern // "GET /v1/jobs/{job_id}", never the raw path
		if route == "" {
			route = "unmatched"
		}
		m.requests.WithLabelValues(route, strconv.Itoa(rec.code)).Inc()
		m.duration.WithLabelValues(route).Observe(time.Since(start).Seconds())
	})
}
```

`promhttp.HandlerFor(reg, promhttp.HandlerOpts{})` serves the Prometheus text format on `/metrics`. Three requests for different job IDs produce one series: `http_requests_total{code="404",route="GET /v1/jobs/{job_id}"} 3`. The Roadmap's mandatory anti-pattern exercise is the opposite: label a metric with `job_id`, watch the series count grow with every job, then replace it with bounded labels such as stage, outcome and retryable.

For workers, the useful signals are saturation and age rather than request rates: queue depth, oldest queued job age, active leases, retries by error class, inference duration histograms, pool wait time and outbox backlog.

## Gotchas

- **`r.Pattern` is set on the request the mux receives.** If middleware between the metrics wrapper and the mux calls `r.WithContext`, the wrapper's `r` never sees the pattern (I confirmed this gives "unmatched"). Put the metrics middleware directly around the mux.
- **Wrapping a slog handler means overriding `WithAttrs` and `WithGroup`**, or `logger.With` silently bypasses the wrapper.
- **`resource.Merge` fails on conflicting schema URLs**, a common error when merging `resource.Default()` with attributes from a different semconv version. `resource.New` with explicit options avoids it.
- **Spans are batched.** Without calling the provider's `Shutdown` during graceful shutdown, the last spans before exit are dropped.
- **OpenTelemetry's logging components have a different maturity from traces and metrics**, as the Roadmap notes. Check the current status before adopting a log bridge; slog plus trace IDs works today.

## Check yourself

1. Why must job IDs stay out of metric labels, and where do they go instead?
2. What breaks if a custom slog handler embeds the inner handler but does not override `WithAttrs`?
3. Why use a span link rather than a parent span for work picked up from the outbox?
4. Why a keyed HMAC for the tenant pseudonym rather than SHA-256 of the ID?
5. Which four latencies does the Roadmap want reported separately, and which signal measures each?

## Further reading

- [Package log/slog](https://pkg.go.dev/log/slog) and [Structured logging with slog](https://go.dev/blog/slog)
- [OpenTelemetry Go documentation](https://opentelemetry.io/docs/languages/go/)
- [otelhttp instrumentation](https://pkg.go.dev/go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [Prometheus instrumentation practices](https://prometheus.io/docs/practices/instrumentation/)
- [Prometheus Go client](https://pkg.go.dev/github.com/prometheus/client_golang/prometheus)
- [Go diagnostics](https://go.dev/doc/diagnostics)
