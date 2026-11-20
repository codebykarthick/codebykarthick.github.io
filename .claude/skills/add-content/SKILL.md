---
name: add-content
description: Add or edit site content (a technology, note, project, idea, or About page experience/education entry) with valid frontmatter and cross-references, or add a new filter value, topic or language. Use whenever creating files under src/content/ or editing src/data/taxonomy.ts.
---

# Adding content

Schemas live in `src/content.config.ts`; allowed values in `src/data/taxonomy.ts`. `src/lib/content.ts` runs an integrity check during the build (broken references, `language` pointing at a non-language, duplicate names) and fails it with a list of every problem.

Technologies are the hub. Notes, projects and ideas reference technologies, and each technology page (`/stack/<slug>`) automatically lists everything that references it. You never maintain those lists by hand.

The slug (entry id) is the filename without `.md`, for example `src/content/technologies/go.md` → `go`. References use slugs.

## Technology: `src/content/technologies/<slug>.md`

```md
---
name: NATS JetStream
summary: Durable messaging for InferenceFlow's asynchronous phase.  # one line
status: learning         # learning | using | comfortable
started: 2026-12-01
links:
  docs: https://docs.nats.io/nats-concepts/jetstream
  repo: https://github.com/nats-io/nats-server
language: [go]           # technologies with kind "language" it's used WITH; [] when kind includes language
lifecycle: [build, operate]  # design | build | test | deploy | operate
domain: [backend, devops]  # frontend | backend | data | ml | devops
kind: [platform]         # language | framework | library | tool | platform
prerequisites: [go]      # optional: technologies to learn first
roadmap:                 # optional: ordered learning stages
  - title: Streams and consumers
    goal: One sentence on what I can do after this stage.
    apply: "InferenceFlow P8: outbox, events, and reliable asynchronous messaging"  # optional
    learn: [Concept one, Concept two]
    practice: [An exercise]
    doneWhen: ["A checkable outcome: quoted because it contains a colon"]
    notes: [nats-streams-and-consumers]   # note slugs, in reading order; each note in at most one stage
resources:               # optional
  - title: JetStream docs
    url: https://docs.nats.io/nats-concepts/jetstream
    kind: docs           # docs | tutorial | course | book | video | article | tool
---
Body in Markdown: why I'm learning it, how it fits with the rest of the stack, how to use the roadmap.
```

Roadmap stage notes get a "Part of the X roadmap, stage N" banner and previous/next links on the note page. Other notes that reference the technology appear under "More notes".

**YAML:** quote any value that contains `: ` (colon space) or starts with a special character (`[`, `{`, `*`, `&`, `!`, `#`, `|`, `>`, `@`, backtick). Unquoted, it breaks the build with "Nested mappings are not allowed in compact mappings".

## Note: `src/content/notes/<slug>.md`

```md
---
title: Bounded fan-out with errgroup
summary: Running at most N calls at once, and cancelling the rest when one fails.
technologies: [go]                # at least one
topics: [performance]             # values from taxonomy.ts topics
updated: 2026-11-20
---
Body in Markdown. This is what Pagefind indexes.
```

A note's lifecycle, domain, kind and language filter values come from its technologies. Don't add them to the note.

## Project: `src/content/projects/<slug>.md`

```md
---
title: Rate limiter service
summary: Per-tenant quotas enforced by a small Go service.
status: shipped                   # planned | building | shipped | archived
stack: [go, postgresql, docker]
repo: https://github.com/codebykarthick/…
demo: https://…                   # optional
started: 2025-01-10
ended: 2025-08-30                 # optional
---
```

## Idea: `src/content/ideas/<slug>.md`

```md
---
title: Per-tenant quota experiments
summary: Try token buckets versus leaky buckets for tenant admission control.
status: became-project            # raw | exploring | became-project | parked
technologies: [go]
project: rate-limiter-service     # required if and only if status is became-project
---
```

## About page: `src/content/experience/<slug>.md` and `src/content/education/<slug>.md`

```md
---
org: Company or university
role: Job title                   # experience; use `degree:` for education
start: 2020-08-01
end: 2024-08-01                   # omit for current
location: City, Country           # optional
order: 1                          # display order, lowest first
highlights:
  - One achievement per line, with a result where you have one.
---
```

To fill these from a CV: one file per role or degree, with highlights rewritten as short outcome-first lines. Delete the `placeholder: true` entries once real ones exist. Never put a phone number or home address in content or in `public/cv.pdf`.

## Adding a filter value or topic

Edit **only** `src/data/taxonomy.ts`: add the value to the right `as const` array and its display label to the labels map (sentence case, for example `ml: "ML"`, `devops: "DevOps"`). Schemas build their enums from this file, so:
- an unknown value anywhere fails the build with a zod error naming the file and field
- removing a value fails the build until every entry using it is updated

## Adding a language

Languages are technologies, not taxonomy values. Create `src/content/technologies/<lang>.md` with `kind: [language]` and `language: []`, then reference its slug from other technologies' `language` arrays. The build checks that every `language` reference points to a technology of kind `language`.

## Example flag

`example: true` on any technology, note, project or idea shows an "Example" badge. Use it for illustrative drafts; the starting curriculum (Go as an InferenceFlow companion, Docker, PostgreSQL, SQLAlchemy, GitHub Actions) is real content and isn't flagged. Sri's capstone is InferenceFlow (https://github.com/codebykarthick/system-in-go, Go); don't invent other projects or ideas unless asked.

## About page

Experience and education entries are collections (above). The short "Who I am" introduction is in `src/pages/about.astro`. The CV download appears automatically when `public/cv.pdf` exists.

## Check your work

`npm run build`. Zod and reference errors name the file. Then `npm run preview` and open `/stack/<slug>` to confirm your entry appears in the right lists.
