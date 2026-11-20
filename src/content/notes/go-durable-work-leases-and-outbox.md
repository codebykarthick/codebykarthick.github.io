---
title: Durable work in Go with leases, fencing and an outbox
summary: Claiming jobs with FOR UPDATE SKIP LOCKED, leases that expire, fencing tokens that reject stale workers, attempt history, a transactional outbox with a relay, and idempotent consumers.
technologies: [go, postgresql]
topics: [transactions, data-modelling, best-practices]
updated: 2026-11-20
---

In phases P7 and P8 InferenceFlow stops trusting process memory. P7 makes PostgreSQL the work scheduler, so a killed worker leaves recoverable rows rather than lost goroutines; P8 adds a transactional outbox so events reach a broker without a dual-write gap. The README's invariants drive the design: accepted work stays discoverable, completion requires the current lease token, duplicates are possible so effects must tolerate them, and nothing claims exactly-once.

All SQL below is my illustrative design, tested against `postgres:18` with pgx; the repository decides the real schema.

## Schema additions

```sql
ALTER TABLE jobs
    ADD COLUMN next_attempt_at  timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN max_attempts     integer NOT NULL DEFAULT 5,
    ADD COLUMN lease_owner      text,
    ADD COLUMN lease_expires_at timestamptz,
    ADD COLUMN lease_token      bigint NOT NULL DEFAULT 0;

CREATE INDEX jobs_runnable_idx ON jobs (next_attempt_at) WHERE status = 'queued';
CREATE INDEX jobs_lease_expiry_idx ON jobs (lease_expires_at) WHERE status = 'running';
```

A `job_attempts` table holds one row per execution (job, attempt number, worker, token, lease time, start, end, outcome), as listed in the Roadmap's P7 schema. `lease_token` is the "monotonically increasing lease token/version" it describes.

## Claiming with SKIP LOCKED

One statement finds eligible jobs, locks them, bumps the token and records the attempt:

```sql
WITH next AS (
    SELECT id FROM jobs
    WHERE attempt_count < max_attempts
      AND ((status = 'queued'  AND next_attempt_at <= now())
        OR (status = 'running' AND lease_expires_at < now()))
    ORDER BY next_attempt_at
    LIMIT @limit
    FOR UPDATE SKIP LOCKED
), claimed AS (
    UPDATE jobs j
    SET status           = 'running',
        lease_owner      = @worker,
        lease_expires_at = now() + make_interval(secs => @lease_secs),
        lease_token      = j.lease_token + 1,
        attempt_count    = j.attempt_count + 1,
        updated_at       = now()
    FROM next
    WHERE j.id = next.id
    RETURNING j.id, j.tenant_id, j.lease_token, j.attempt_count, j.lease_expires_at
), attempts AS (
    INSERT INTO job_attempts (job_id, attempt_no, worker_id, lease_token, leased_until)
    SELECT id, attempt_count, @worker, lease_token, lease_expires_at FROM claimed
)
SELECT id, tenant_id, lease_token, attempt_count FROM claimed
```

Why it is shaped this way:

- **`SKIP LOCKED`** lets concurrent workers pass over rows another transaction has locked instead of queueing behind it. Two workers each claiming 5 of 10 jobs get disjoint sets in my test.
- **Expired leases are just another eligibility condition**, so recovery after a crash needs no separate code path.
- **`now()` is database time**, so every lease decision uses one clock. pgx `NamedArgs` fill the `@` parameters.
- **Data-modifying CTEs always run**, even unread.
- **It is one statement, so it commits immediately.** The inference call happens afterwards, outside any transaction.

## Leases expire; fencing tokens decide

The Roadmap's key race: worker A stalls (a long GC pause, a frozen VM), its lease expires, worker B claims the job and finishes, and then A wakes up and tries to commit. Lease expiry cannot stop A from running. What stops A from *writing* is the token: every claim increments it, and completion only succeeds for the current one.

```go
func (l *Leases) Complete(ctx context.Context, c Claim, outcome string) error {
	return pgx.BeginFunc(ctx, l.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
            UPDATE jobs
            SET status = @status, lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
            WHERE id = @id AND lease_token = @token AND status = 'running'`,
			pgx.NamedArgs{"id": c.JobID, "token": c.Token, "status": outcome})
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrStaleLease // rolls back: a newer attempt owns the job
		}
		// close the attempt row and append an audit event in the same transaction
		return nil
	})
}
```

Result, attempt outcome and audit event share that transaction, so a stale worker changes nothing. My integration test reproduces the race: A claims (token 1), its lease is forced into the past, B claims (token 2) and succeeds, and A's `Complete` returns `ErrStaleLease`. A unique job ID alone could not catch this.

This is the fencing token from Martin Kleppmann's analysis of distributed locks: the resource checks the token, because a paused holder cannot know it was paused.

## Heartbeats

Long attempts extend their lease from a ticker goroutine (every third of the lease) with the same guard: `UPDATE jobs SET lease_expires_at = now() + ... WHERE id = @id AND lease_token = @token AND status = 'running'`. Zero rows affected means the lease is gone, so the heartbeat cancels the attempt's context. That is a courtesy that saves work; correctness still comes from the token check at completion.

## Retries and poison jobs

A retryable failure hands the job back with a delay, guarded by the token again: `status = 'queued'`, `next_attempt_at = now() + backoff`. Because the claim query requires `attempt_count < max_attempts`, a job that keeps failing stops being claimed; a reconciler (not shown) marks such jobs `failed` with an audit event, and replay is an operator action that keeps the history.

## The transactional outbox

Writing the job to PostgreSQL and then publishing to the broker is a dual write: a crash between them leaves a job with no event, or an event with no job. Instead the event is a row, inserted by `InsertOutboxEvent` in the same transaction as the job and its audit record (the create-or-get transaction in my pgx note), so either all three commit or none do.

The envelope carries the Roadmap's fields (`event_id`, `event_type`, `schema_version`, `occurred_at`, `tenant_id`, `job_id`, `trace_context`) and only opaque references, never document contents.

## The relay

A relay claims pending rows, publishes each with its stable event ID, and marks it published:

```go
func (r *Relay) RunOnce(ctx context.Context) (published int, err error) {
	err = pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		rows, _ := tx.Query(ctx, `
            SELECT id, event_id, event_type, payload, attempts FROM outbox_events
            WHERE published_at IS NULL AND next_attempt_at <= now()
            ORDER BY id LIMIT $1
            FOR UPDATE SKIP LOCKED`, r.batch)
		events, err := pgx.CollectRows(rows, pgx.RowToStructByName[outboxRow])
		if err != nil {
			return err
		}
		for _, e := range events {
			pctx, cancel := context.WithTimeout(ctx, r.publishTimeout)
			perr := r.pub.Publish(pctx, e.EventID.String(), e.EventType, e.Payload)
			cancel()
			if perr != nil {
				// bump attempts and push next_attempt_at back with capped backoff
				continue
			}
			if _, err := tx.Exec(ctx, `UPDATE outbox_events SET published_at = now() WHERE id = $1`, e.ID); err != nil {
				return err
			}
			published++
		}
		return nil
	})
	return published, err
}
```

If the relay dies after the broker confirms but before `COMMIT`, the row is still pending and gets published again. My test simulates exactly that and sees the same event ID published twice. Delivery is at-least-once by construction. This version holds a short transaction across a bounded publish; leasing outbox rows like jobs avoids that at the cost of more state.

## Idempotent consumers

Duplicates are expected, so effects are conditional. Often the job-state guard is enough: claiming an already-succeeded job matches no rows. Otherwise an inbox table records `(consumer, event_id)` in the effect's transaction:

```go
tag, err := tx.Exec(ctx, `
    INSERT INTO inbox (consumer, event_id) VALUES ($1, $2)
    ON CONFLICT DO NOTHING`, consumer, eventID)
if err != nil {
	return err
}
if tag.RowsAffected() == 0 {
	return nil // already processed: skip the effect, still acknowledge
}
return effect(tx)
```

With JetStream at M6, the worker acknowledges only after this transaction commits, never merely because a goroutine started. The result is effectively-once *state transitions*, not exactly-once execution.

## Gotchas

- **`SKIP LOCKED` gives an inconsistent view by design.** Right for work queues, wrong for reports or counts.
- **A lease shorter than a normal attempt** makes healthy work look dead. Size it from attempt budgets, or heartbeat.
- **Reclaim means re-execution.** Results must be keyed by job and stage so a second run cannot create a second conflicting result.
- **Broker redelivery is not a business retry.** Redelivery covers lost acknowledgements; scheduled retries live in `next_attempt_at`.

## Check yourself

1. Why does lease expiry alone fail to protect against a paused worker, and what does the token add?
2. Why does the claim use `now()` instead of a timestamp passed from Go?
3. What exactly happens if the relay crashes after the broker confirms a publish but before it commits?
4. When is the job-state guard enough, and when is an inbox table needed?
5. Why is "effectively-once state transition" an honest claim where "exactly-once processing" is not?

## Further reading

- [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- [PostgreSQL SELECT, the locking clause and SKIP LOCKED](https://www.postgresql.org/docs/current/sql-select.html)
- [PostgreSQL WITH queries, data-modifying statements](https://www.postgresql.org/docs/current/queries-with.html)
- [How to do distributed locking (Martin Kleppmann)](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
- [Transactional outbox pattern](https://microservices.io/patterns/data/transactional-outbox.html)
- [NATS JetStream](https://docs.nats.io/concepts/jetstream)
- [pgx v5 documentation](https://pkg.go.dev/github.com/jackc/pgx/v5)
