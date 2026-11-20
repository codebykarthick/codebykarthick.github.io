---
title: PostgreSQL transactions, isolation and locking
summary: MVCC, the three isolation levels Postgres really has, lost updates, claiming jobs with FOR UPDATE SKIP LOCKED and fencing tokens, and retrying serialisation failures from Go with pgx.
technologies: [postgresql, go]
topics: [transactions, best-practices, performance]
updated: 2026-11-20
---

In a job-processing system like [InferenceFlow](/projects/inferenceflow), several workers poll the same jobs table. If two pick up the same queued job, both run it and both try to record a result. These notes cover how Postgres prevents that, using the essentials note's sketch: `jobs` with a `status`, lease columns and a `lease_token`, plus `job_attempts`.

## MVCC in one paragraph

Postgres uses multi-version concurrency control. An `UPDATE` does not overwrite a row in place: it writes a new version and marks the old one dead from that transaction onwards. Each statement (or transaction, depending on isolation level) reads from a **snapshot** of committed versions. So **readers never block writers and writers never block readers**, though writers block other writers on the same row. The cost is dead row versions, which `VACUUM` cleans up.

## Isolation levels

| Level | Snapshot taken | What can still go wrong |
| --- | --- | --- |
| READ COMMITTED (default) | per statement | statements see different data; lost updates in read-modify-write code |
| REPEATABLE READ | at the transaction's first statement | updating a row changed since the snapshot fails with a serialisation failure; write skew is possible |
| SERIALIZABLE | as above, plus dependency tracking | nothing, but any transaction may fail with a serialisation failure and must be retried |

`READ UNCOMMITTED` behaves like `READ COMMITTED`: Postgres never shows uncommitted data. Oracle's `SERIALIZABLE` is snapshot isolation, which is Postgres's `REPEATABLE READ`; Postgres's `SERIALIZABLE` also catches write skew.

## The lost update: a double claim

Two workers each run this in their own transaction, interleaved:

```sql
BEGIN;
SELECT id FROM jobs WHERE status = 'queued' ORDER BY next_attempt_at LIMIT 1;
-- both workers see the same job
UPDATE jobs SET status = 'running', lease_owner = 'worker-a',
                lease_expires_at = now() + interval '30 seconds'
WHERE id = '...';
COMMIT;
```

The second `UPDATE` waits for the first to commit, then overwrites it. Both workers believe they own the job. The same bug with counters: ten goroutines each incrementing `attempt_count` ten times by reading it, adding one in Go and writing it back ended at 10, not 100.

**Fix 1: a conditional, atomic `UPDATE`.** Put the expected state in the `WHERE` clause, making it a compare-and-swap:

```sql
UPDATE jobs SET status = 'running', lease_owner = 'worker-b',
                lease_expires_at = now() + interval '30 seconds'
WHERE id = '...' AND status = 'queued';
```

Under `READ COMMITTED`, a blocked writer re-checks its `WHERE` clause against the newly committed version, finds `status = 'running'` and updates zero rows. `SET attempt_count = attempt_count + 1` is correct for the same reason. Every state transition should be written this way.

**Fix 2: lock before reading.** `SELECT ... FOR UPDATE` takes a row lock, so the second worker blocks until the first commits and then reads the fresh row. Use it when Go logic must sit between the read and the write.

**Fix 3: `REPEATABLE READ` and retry.** The second worker gets `ERROR: could not serialize access due to concurrent update`, SQLSTATE `40001`, and the whole transaction must be retried.

## Claiming jobs with SKIP LOCKED

`FOR UPDATE` alone would make all workers queue behind whoever holds the oldest job. `FOR UPDATE SKIP LOCKED` skips locked rows instead, so each worker gets a different job. The claim also extends a lease and increments the fencing token in one statement:

```sql
WITH next AS (
    SELECT id FROM jobs
    WHERE status = 'queued' AND next_attempt_at <= now()
    ORDER BY next_attempt_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
UPDATE jobs j
SET status = 'running', lease_owner = $1,
    lease_expires_at = now() + $2::interval,
    lease_token = j.lease_token + 1,
    attempt_count = j.attempt_count + 1,
    updated_at = now()
FROM next
WHERE j.id = next.id
RETURNING j.id::text, j.lease_token, j.attempt_count;
```

In Go, the claim and its attempt record share one short transaction through `pgx.BeginFunc`, which commits if the function returns nil and rolls back otherwise:

```go
func ClaimNext(ctx context.Context, db *pgxpool.Pool, workerID string, lease time.Duration) (Claim, error) {
	var c Claim
	err := pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, claimSQL, workerID, lease).
			Scan(&c.JobID, &c.LeaseToken, &c.AttemptNo); err != nil {
			return err // pgx.ErrNoRows: nothing runnable
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO job_attempts (job_id, attempt_no, worker_id, lease_token, leased_until)
			VALUES ($1, $2, $3, $4, now() + $5::interval)`,
			c.JobID, c.AttemptNo, workerID, c.LeaseToken, lease)
		return err
	})
	return c, err
}
```

pgx encodes a `time.Duration` as an `interval`. The transaction commits *before* the inference call; holding it across network work would keep row locks and block vacuum. Four goroutine workers draining 200 jobs this way produced 200 attempts for 200 distinct jobs.

A lease does not stop a stalled worker from waking up later. When a lease expires, a reaper re-queues the job, another worker claims it and the token increments. Completion therefore checks the token:

```sql
UPDATE jobs
SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
WHERE id = $1 AND status = 'running' AND lease_token = $2;
```

If `tag.RowsAffected()` is zero, the Go code returns `ErrLeaseLost` and writes nothing. In my test, worker A claimed with token 2, its lease expired, worker B reclaimed with token 3 and completed, and A's completion was rejected. Expiry uses the database's `now()`, not each worker's clock.

## Retrying serialisation failures

Under `REPEATABLE READ` or `SERIALIZABLE`, retries are part of the contract. The retry must re-run the whole transaction, because the failure can come at `COMMIT`:

```go
func withRetry(ctx context.Context, db *pgxpool.Pool, opts pgx.TxOptions, fn func(pgx.Tx) error) error {
	const maxAttempts = 5
	for attempt := 1; ; attempt++ {
		err := pgx.BeginTxFunc(ctx, db, opts, fn)
		var pgErr *pgconn.PgError
		retryable := errors.As(err, &pgErr) &&
			(pgErr.Code == "40001" || pgErr.Code == "40P01") // serialization_failure, deadlock_detected
		if !retryable || attempt == maxAttempts {
			return err
		}
		backoff := time.Duration(attempt*attempt) * 5 * time.Millisecond
		select {
		case <-time.After(backoff + rand.N(backoff)): // jitter so retries do not collide again
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}
```

It is called with `pgx.TxOptions{IsoLevel: pgx.RepeatableRead}`. With ten goroutines hammering one row the count came out right after 22 retries. For a single hot row, fixes 1 and 2 are cheaper; retries suit low contention.

## Advisory locks

An advisory lock is a lock on a number the application chooses, with no table involved. `pg_try_advisory_xact_lock(hashtextextended('inferenceflow:reaper', 0))` returns true for exactly one caller and releases at commit, which suits "only one reaper or relay instance at a time". The session-level variants survive commit, so with a pool they must be unlocked on the same connection; I prefer the `_xact_` forms.

## Deadlocks, vacuum and idle transactions

If A locks job 1 then wants job 2 while B holds job 2 and wants job 1, Postgres aborts one with `40P01` after `deadlock_timeout` (1 second). Locking rows in a consistent order, for example by `id`, prevents it.

Vacuum cannot remove dead row versions that an older open transaction might still see, and a jobs table updated on every claim produces many. A long or **idle-in-transaction** session therefore causes bloat. `pg_stat_activity` shows the culprits:

```sql
SELECT pid, state, now() - xact_start AS xact_age, query
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY xact_age DESC NULLS LAST;

SELECT pg_cancel_backend(12345);     -- cancel the running query
SELECT pg_terminate_backend(12345);  -- close the connection

ALTER ROLE inferenceflow_app SET idle_in_transaction_session_timeout = '30s';
```

## Gotchas

- **After an error, the transaction is aborted.** Every later statement fails until `ROLLBACK`, so catching `23505` and carrying on in the same transaction does not work.
- **`now()` is the transaction's start time**, constant inside it. Use `clock_timestamp()` if wall time during a long transaction matters.
- **`BeginFunc` only rolls back if the function returns an error.** Swallowing an error inside it commits a half-finished change.
- **`FOR UPDATE` in a join locks rows in every joined table** unless written `FOR UPDATE OF jobs`.
- **Postgres cannot make the inference call exactly-once.** It guarantees the state transition; a reclaimed job may run twice.

## Check yourself

1. Why does a read-then-update claim lose under `READ COMMITTED`, while `UPDATE ... WHERE status = 'queued'` does not?
2. Which Postgres level matches Oracle's `SERIALIZABLE`, and what does Postgres's `SERIALIZABLE` add?
3. Why does the claim use `SKIP LOCKED` rather than plain `FOR UPDATE` or `NOWAIT`?
4. A worker's lease expired while it was paused. What stops its late completion from overwriting the newer attempt?
5. Which SQLSTATE codes does the retry helper catch, and why must it retry the whole transaction?

## Further reading

- [Concurrency control (MVCC)](https://www.postgresql.org/docs/current/mvcc.html)
- [Transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- [Explicit locking, including advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html)
- [SELECT, the locking clause](https://www.postgresql.org/docs/current/sql-select.html)
- [Routine vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html)
- [pgx v5 package documentation](https://pkg.go.dev/github.com/jackc/pgx/v5)
