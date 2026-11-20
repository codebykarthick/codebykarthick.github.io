---
title: Inventory API
summary: Capstone for my backend learning path. A containerised Python service on PostgreSQL via SQLAlchemy, tested and shipped by GitHub Actions.
status: planned
stack: [python, sqlalchemy, postgresql, docker, github-actions]
started: 2026-11-20
---

## What it is

A small HTTP API for tracking stock across warehouses: warehouses hold items, and items have a SKU, a quantity and a price. The domain is deliberately boring so the interesting parts are the engineering around it: schema design, migrations, transactions, containers and CI.

It's the project the Docker, PostgreSQL, SQLAlchemy and GitHub Actions roadmaps build towards. Each milestone below lines up with a roadmap stage, so I can build it alongside the learning instead of after it.

## Milestones

1. **Project skeleton.** `uv` project with `pyproject.toml`, ruff, pytest and a health-check endpoint. *(Python roadmap: project setup)*
2. **Database in a container.** PostgreSQL 18 in Docker Compose with a named volume and a health check; the app reads `DATABASE_URL` from the environment. *(Docker: Compose; PostgreSQL: running Postgres)*
3. **Schema and models.** `Warehouse` and `Item` as SQLAlchemy 2.x typed models with constraints: unique SKU per warehouse, non-negative quantity, `numeric` price, `timestamptz` timestamps. *(SQLAlchemy: ORM models; PostgreSQL: schema design)*
4. **Migrations.** Alembic set up from day one; every schema change is a reviewed migration, including one data migration. *(SQLAlchemy: migrations)*
5. **Queries that scale.** List endpoints with filtering and pagination, eager loading to avoid N+1, and an index justified with `EXPLAIN ANALYZE`. *(SQLAlchemy: querying; PostgreSQL: indexes)*
6. **Stock transfers done right.** Move stock between warehouses in one transaction with row locks, and a test that proves two concurrent transfers can't oversell. *(PostgreSQL: transactions and isolation)*
7. **Tests against real Postgres.** pytest with a transaction-per-test rollback fixture. *(SQLAlchemy: testing)*
8. **CI.** GitHub Actions running ruff and pytest against a Postgres service container on every push and pull request. *(GitHub Actions: CI for Python, service containers)*
9. **Production image.** Multi-stage Dockerfile, non-root user, small image, published to GitHub Container Registry from `main`. *(Docker: production images; GitHub Actions: publishing images)*
10. **Hardening.** Least-privilege workflow permissions, actions pinned by SHA, dependency updates automated. *(GitHub Actions: security)*

## Done when

- `docker compose up` gives a working API and database from a clean checkout.
- Every pull request runs the full test suite against PostgreSQL and blocks on failure.
- A merge to `main` publishes a versioned image I could deploy anywhere.
