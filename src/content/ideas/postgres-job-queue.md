---
title: Job queue on plain PostgreSQL
summary: Background jobs without Redis or a broker, using SELECT ... FOR UPDATE SKIP LOCKED and a small worker loop.
status: raw
technologies: [postgresql, sqlalchemy, python]
---

For small services, a jobs table plus `SKIP LOCKED` might be all the queue I need. Questions to answer: retries and backoff, visibility timeouts, and how it behaves under load compared to a dedicated broker.
