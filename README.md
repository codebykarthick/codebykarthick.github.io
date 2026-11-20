# codebykarthick.github.io

My public reference for the tech stack I'm learning, live at **https://codebykarthick.github.io**.

Built with Astro and three.js, deployed to GitHub Pages on every push to `main`.

This README is my own how-to guide: how to add things to the site without having to remember how it's wired together.

---

## Contents

1. [What's built so far](#whats-built-so-far)
2. [Running it locally](#running-it-locally)
3. [How the site fits together](#how-the-site-fits-together)
4. [Recipes](#recipes)
   - [Add a technology to the tech stack](#add-a-technology-to-the-tech-stack)
   - [Add a programming language](#add-a-programming-language)
   - [Write a note in the knowledge base](#write-a-note-in-the-knowledge-base)
   - [Add a project](#add-a-project)
   - [Add an idea, or turn one into a project](#add-an-idea-or-turn-one-into-a-project)
   - [Update the About page and CV](#update-the-about-page-and-cv)
   - [Add a new tag, topic or filter value](#add-a-new-tag-topic-or-filter-value)
   - [Replace the example content](#replace-the-example-content)
   - [Change my name, role or links](#change-my-name-role-or-links)
   - [Add a new top-level page](#add-a-new-top-level-page)
   - [Change colours or fonts](#change-colours-or-fonts)
   - [Add or change a background scene](#add-or-change-a-background-scene)
5. [Publishing](#publishing)
6. [When the build fails](#when-the-build-fails)
7. [Troubleshooting](#troubleshooting)
8. [Doing it with Claude Code](#doing-it-with-claude-code)
9. [House rules](#house-rules)

---

## What's built so far

The site is being built in phases. Recipes marked with a phase only work once that phase has landed.

| Phase | What it adds | Status |
|---|---|---|
| 1 | Astro scaffold, deploy workflow, nav, design tokens, scene engine, home page | Live |
| 2 | Content collections, tag list (`taxonomy.ts`), `/stack` with filters, technology pages, metro scene | Next |
| 3 | Knowledge base with full-text search, archive scene | Planned |
| 4 | Projects, ideas, About page with CV, 404, remaining scenes | Planned |
| 5 | Performance, accessibility and cross-browser polish | Planned |

---

## Running it locally

You need Node 24 (the version CI uses) and npm.

```sh
npm install          # first time, or after pulling dependency changes
npm run dev          # http://localhost:4321, reloads as you edit
```

| Command | What it does | When to use it |
|---|---|---|
| `npm run dev` | Dev server with hot reload | Writing content, tweaking styles |
| `npm run build` | Type check, build to `dist/`, then build the search index | Before pushing, to catch errors CI would catch |
| `npm run preview` | Serves the built `dist/` | Testing search and the real scene loading |
| `npm run check` | Type check only | Quick sanity check |

Two things only work after `npm run build` + `npm run preview`, not in `npm run dev`:
- **Search** on the knowledge base: the Pagefind index is generated after the build.
- **Realistic scene loading**: dev mode serves unbundled modules, so load timing is different.

---

## How the site fits together

**Technologies are the hub.** Everything else points at them:

```
                 ┌──────────────┐
   notes ───────▶│              │◀─────── projects
  (technologies) │  technology  │         (stack)
                 │              │
   ideas ───────▶│  /stack/x    │◀─────── other technologies
  (technologies) └──────────────┘         (language, if x is a language)
     │
     └── project ──▶ a project (when the idea became one)
```

You only ever write the arrows, as references in a file's frontmatter. The site works out the reverse direction itself. When a note says `technologies: [pytorch]`, the PyTorch page lists that note automatically. You never edit the technology page to add it.

### Where things live

```
src/content/technologies/   one Markdown file per technology    → /stack and /stack/<slug>
src/content/notes/          one file per note                   → /knowledge and /knowledge/<slug>
src/content/projects/       one file per project                → /projects and /projects/<slug>
src/content/ideas/          one file per idea                   → /ideas
src/content/experience/     one file per job                    → /about
src/content/education/      one file per degree                 → /about
src/data/taxonomy.ts        every allowed tag value and its label
src/data/profile.ts         my name, role, links, the nav sections
public/cv.pdf               the CV download
```

### Slugs

A file's **slug** is its filename without `.md`. It's used in the URL and in references:

- `src/content/technologies/pytorch.md` → slug `pytorch` → page `/stack/pytorch`
- `src/content/notes/mixed-precision.md` → slug `mixed-precision` → page `/knowledge/mixed-precision`

Use lowercase and hyphens: `scikit-learn.md`, not `Scikit Learn.md`. Renaming a file changes its slug, so update anything that references the old one. The build will tell you if you miss any.

### Frontmatter

Every content file starts with a frontmatter block between `---` lines, followed by an optional Markdown body:

```md
---
name: PyTorch
status: using
---
Anything here is the body, written in normal Markdown.
```

The frontmatter is **validated at build time**. A missing field, a typo in a tag, or a reference to a slug that doesn't exist all stop the build with a message naming the file. That's deliberate: a broken page can never reach the live site.

Formats to remember:
- Dates: `2026-11-20` (YYYY-MM-DD)
- Lists: `[a, b, c]` on one line, or one `- item` per line
- Text containing a colon: wrap it in quotes, for example `summary: "Kafka: the good parts"`

---

## Recipes

### Add a technology to the tech stack

*(Phase 2)*

1. Create `src/content/technologies/<slug>.md`, for example `fastapi.md`.
2. Fill in the frontmatter:

```md
---
name: FastAPI
summary: Python web framework I use to put models behind HTTP APIs.
status: learning
started: 2026-11-01
links:
  docs: https://fastapi.tiangolo.com/
  repo: https://github.com/fastapi/fastapi
language: [python]
lifecycle: [build, deploy]
domain: [backend, ml]
kind: [framework]
---
Optional: a few paragraphs on why I'm learning it, what clicked, what didn't.
This appears on /stack/fastapi above the auto-collected lists.
```

3. Run `npm run dev` and open `/stack/fastapi`.

**Fields:**

| Field | Required | What to put |
|---|---|---|
| `name` | yes | Display name, cased as the project writes it (`PyTorch`, `scikit-learn`) |
| `summary` | yes | One line, shown on the card in the grid |
| `status` | yes | `learning` (actively picking it up), `using` (in real work or projects), `comfortable` (could teach it). This is the only proficiency signal on the site. |
| `started` | yes | Roughly when I started with it |
| `links.docs` / `links.repo` | no | Official docs and source repo |
| `language` | yes, can be `[]` | Slugs of the **language technologies** it's used with. FastAPI → `[python]`, React → `[typescript, javascript]`. Must be `[]` if this technology is itself a language. |
| `lifecycle` | yes | Where it fits: `design`, `build`, `test`, `deploy`, `operate`. Pick all that apply. |
| `domain` | yes | `frontend`, `backend`, `data`, `ml`, `devops` |
| `kind` | yes | `language`, `framework`, `library`, `tool`, `platform` |

**What happens automatically:**
- A card appears on `/stack`, and the filter chips pick up its tags.
- `/stack/fastapi` gets built, listing every note, project and idea that references `fastapi`.
- If it's a language, its page also lists every technology used with it.

If a tag you want isn't allowed yet, see [Add a new tag](#add-a-new-tag-topic-or-filter-value).

### Add a programming language

*(Phase 2)*

Languages are technologies too, not tags. So Python gets its own page and lists everything I use with it.

1. Create `src/content/technologies/python.md` with `kind: [language]` and `language: []`:

```md
---
name: Python
summary: My main language for ML, data work and tooling.
status: comfortable
started: 2019-06-01
links:
  docs: https://docs.python.org/3/
language: []
lifecycle: [build, test]
domain: [ml, data, backend]
kind: [language]
---
```

2. Reference it from other technologies: `language: [python]`.

The build checks that anything listed under `language` really is a language. If you write `language: [pytorch]`, the build fails.

### Write a note in the knowledge base

*(Phase 3. The files can be written from phase 2.)*

Notes are my write-ups and discussions: what I learned, how something works, gotchas, comparisons. They're the knowledge base, and they're full-text searchable.

1. Create `src/content/notes/<slug>.md`:

````md
---
title: Mixed precision training in PyTorch
summary: What autocast and GradScaler actually do, and when they bite.
technologies: [pytorch, python]
topics: [performance, training]
updated: 2026-11-20
---

## Why bother

Normal Markdown from here: headings, lists, links, tables, images and code blocks.

```python
with torch.autocast("cuda", dtype=torch.float16):
    loss = model(x)
```
````

2. Open `/knowledge/<slug>` in dev to read it back.

| Field | What to put |
|---|---|
| `title` | The note's headline, in sentence case |
| `summary` | One line, shown in the list and in search results |
| `technologies` | At least one technology slug. This is what puts the note on those technology pages. |
| `topics` | Topic tags from `taxonomy.ts` (for example `performance`, `debugging`, `architecture`) |
| `updated` | Bump this whenever you meaningfully revise the note |

**Writing tips:**
- Start body headings at `##`. The page already uses the title as its `#` heading.
- Don't add lifecycle, domain or kind tags to a note: it inherits them from its technologies, so filtering `/knowledge` by "ML" finds notes about ML technologies.
- Images: put them in `src/assets/notes/<slug>/` and reference them with a relative path, `![Loss curve](../../assets/notes/mixed-precision/loss.png)`. Astro optimises them at build time.
- Search covers the whole body. A note doesn't need keyword stuffing to be findable.

### Add a project

*(Phase 4. The files can be written from phase 2.)*

1. Create `src/content/projects/<slug>.md`:

```md
---
title: Image classifier service
summary: A small model behind an HTTP API, packaged as a container.
status: building
stack: [pytorch, fastapi, docker, python]
repo: https://github.com/codebykarthick/image-classifier-service
demo: https://example.com
started: 2026-10-01
---

What it does, why I built it, how it's put together, what I'd do differently.
```

| Field | What to put |
|---|---|
| `status` | `planned`, `building`, `shipped`, `archived` |
| `stack` | Technology slugs. Each technology page lists this project. |
| `repo` / `demo` | Optional links |
| `started` / `ended` | `ended` is optional; leave it out while it's ongoing |

### Add an idea, or turn one into a project

*(Phase 4. The files can be written from phase 2.)*

Ideas are things I might build. They're short; a summary is often enough.

```md
---
title: Edge model benchmarking kit
summary: Compare quantised models on real phones, not just on paper.
status: exploring
technologies: [pytorch]
---
```

Statuses:
- `raw`: just written down
- `exploring`: reading up or prototyping
- `parked`: not now
- `became-project`: it turned into a project

**When an idea becomes a project:**
1. Create the project file (see [Add a project](#add-a-project)).
2. In the idea, set `status: became-project` and add `project: <project-slug>`.

The `/ideas` page then links the idea to its project. The build enforces the pairing: `became-project` without a `project`, or a `project` with any other status, fails.

### Update the About page and CV

*(Phase 4)*

The About page is built from two collections, so jobs and degrees are data, not one big blob of text.

**A job:** `src/content/experience/<slug>.md`

```md
---
org: Company name
role: Job title
start: 2020-08-01
end: 2024-08-01
location: City, Country
order: 2
highlights:
  - Led the move from on-prem servers to Kubernetes, cutting release time from days to hours.
  - Built the notification service handling time-sensitive alerts for millions of users.
---
Optional extra paragraph about the role.
```

**A degree:** `src/content/education/<slug>.md`, the same shape with `degree:` instead of `role:`.

- Leave out `end` for a current role.
- `order` sets display order, lowest first. Put the most recent at `1`.
- **Highlights:** one achievement per line, outcome first, with a number where you have one. These are what someone skimming the page will read.
- Delete the `placeholder: true` entries once real ones exist.

**The CV download:**
1. Export the CV as PDF.
2. **Strip personal details first:** phone number, home address, date of birth. Also check the PDF's metadata (in Preview: Tools → Show Inspector), because the author field can carry your full name or account name.
3. Save it as `public/cv.pdf`.
4. Build, and the About page switches from "CV coming soon" to a download button.

> Git history is permanent and this repo is public. Once a file is pushed, assume someone has it. Removing it later needs a history rewrite and a force push, as was done for the old CV.

To update the CV, overwrite `public/cv.pdf` and push. Same filename, same link.

### Add a new tag, topic or filter value

*(Phase 2)*

All allowed tag values live in **one file**: `src/data/taxonomy.ts`. The schemas read from it, so a value that isn't there fails the build. That's how typos get caught.

To add, for example, a `security` domain:

1. Open `src/data/taxonomy.ts`.
2. Add the value to the array and its label to the matching map:

```ts
export const DOMAINS = ["frontend", "backend", "data", "ml", "devops", "security"] as const;

export const DOMAIN_LABELS = {
  frontend: "Frontend",
  backend: "Backend",
  data: "Data",
  ml: "ML",
  devops: "DevOps",
  security: "Security",
};
```

3. Use it in any content file: `domain: [security]`.

That's the only file to touch. The filter chip appears on `/stack` automatically.

- **Values** are lowercase slugs (`devops`); **labels** are what visitors see, in sentence case or the usual casing for acronyms (`DevOps`, `ML`).
- **Renaming or removing** a value makes the build fail on every file still using the old one. Fix those files and it passes again.
- **Topics** for notes work the same way, in the topics list.
- **Languages are not here.** See [Add a programming language](#add-a-programming-language).

### Replace the example content

*(Phase 2)*

The site ships with example entries (4 technologies, 3 notes, 1 project, 2 ideas) so the cross-linking can be seen working. Each one has `example: true` and shows an "example" badge.

For each one, either:
- **edit it** into a real entry and delete the `example: true` line, or
- **delete the file.** If something else references it, the build says which file and field; fix or delete that too.

### Change my name, role or links

*(Works now)*

Edit `src/data/profile.ts`:

```ts
export const profile = {
  name: "Sri",
  role: "ML engineer",
  siteTitle: "Sri, ML engineer",     // browser tab and search results
  description: "…",                  // default meta description
  links: { github: "…", linkedin: "…", source: "…" },
};
```

The section blurbs on the home page (`SECTIONS`) live in the same file.

### Add a new top-level page

*(Works now)*

For a page that isn't one of the content collections, for example `/uses` for my hardware and tools:

1. Create `src/pages/uses.astro`:

```astro
---
import Reading from "../layouts/Reading.astro";
---

<Reading title="Uses" description="The hardware and software I work with." scene="home">
  <h1>Uses</h1>
  <div class="prose">
    <p>…</p>
  </div>
</Reading>
```

2. Pick a layout:
   - `Reading`: text-heavy pages. The scene is dimmed and frozen, and text sits on a solid panel.
   - `Landing`: section front pages. Full animated scene, glass panels.
3. Pick a `scene`: `home`, `metro`, `archive`, `construction`, `rooftop` or `desert`. Until a scene is built, its colour gradient shows instead.
4. To add it to the nav and the home page list, add an entry to `SECTIONS` in `src/data/profile.ts`.

Prefer Markdown? `src/pages/uses.md` also works, but `.astro` gets the site layout with less fuss.

### Change colours or fonts

*(Works now)*

Everything visual comes from `src/styles/tokens.css`: palette, panel opacity, font stacks, type scale, spacing, and each scene's fallback gradient. Change a value there and it applies everywhere. Don't hard-code hex colours in components.

Fonts are set up in `astro.config.mjs` (`fonts:`). They're downloaded from Google Fonts at build time and served from this site, so visitors never hit Google.

### Add or change a background scene

*(Works now; more scenes arrive in phases 2–4)*

Scenes live in `src/scenes/`. The full guide, with the engine contract, kit API, performance budget and test checklist, is in `.claude/skills/cyberpunk-scenes/SKILL.md`. The short version:

1. Create `src/scenes/<id>.ts` exporting `meta` and `create(ctx)`, built from the kit in `src/scenes/kit/`.
2. Register it in `src/scenes/registry.ts`.
3. Add its sky and fog to `kit/atmosphere.ts` and its `--scene-<id>` gradient to `tokens.css`.
4. Test with `?tier=low`, `?tier=high` and reduced motion, as described in the checklist.

Rule: scenes are original. No real landmarks, logos, or names from games or films.

---

## Publishing

```sh
npm run build                 # optional but catches problems before CI does
git add -A
git commit -m "Add FastAPI to the stack"
git push
```

Pushing to `main` triggers **Deploy to GitHub Pages** (`.github/workflows/deploy.yml`):
1. installs dependencies from `package-lock.json`
2. runs `npm run build` (type check, build, search index)
3. deploys `dist/` to Pages

It takes a couple of minutes. Watch it in the repo's **Actions** tab. If the build fails, nothing deploys and the live site stays as it was.

The repo setting that makes this work, already done: Settings → Pages → Source: **GitHub Actions**.

---

## When the build fails

The build is strict on purpose. Typical messages and what they mean:

| Message mentions | Cause | Fix |
|---|---|---|
| `Invalid enum value. Expected 'frontend' \| 'backend' …, received 'ML'` | Tag not in `taxonomy.ts`, or wrong case | Use the exact lowercase value, or add it to `taxonomy.ts` |
| `technologies → "pytorhc" does not exist` | Reference to a slug with no file | Fix the typo, or create that technology |
| `Required` on a field | A required frontmatter field is missing | Add it (see the recipe's field table) |
| `Expected date` | Date in the wrong format | Use `YYYY-MM-DD` |
| `language must be empty when kind is language` | A language listing languages | Set `language: []` |
| `… is not a language` | `language:` points at a non-language technology | Only reference technologies with `kind: [language]` |
| `became-project requires project` | Idea status and `project` field disagree | Add `project:` or change the status |
| An error in a `.ts` / `.astro` file | A type error from `astro check` | Read the file and line in the message |

The message always names the file. Fix it, run `npm run build` again, then push.

---

## Troubleshooting

**Search returns nothing in `npm run dev`.** Expected: the index only exists after a build. Use `npm run build && npm run preview`.

**The background is just a gradient.** That's the fallback. It shows when:
- the page's scene hasn't been built yet
- WebGL is unavailable
- the scene hasn't loaded yet; it fades in shortly after the page

**The background doesn't move.** Possible reasons:
- "Pause scenes" in the footer is switched on
- your OS has reduced motion turned on, so you get a still frame on purpose
- it's a reading page, where the scene freezes after a few seconds on purpose
- you've scrolled past the hero

**The scene looks low quality on a fast machine.** The engine drops quality when frame rate stays low, and remembers that choice. To reset it:
- DevTools → Application → Local Storage → delete `scenes:tier`, or
- add `?tier=high` to the URL for one visit

**Scene debugging:** add `?debug-scenes` to the URL, then in the console run `__scene.info()` to see draw calls, GPU memory and the current tier.

**`npm install` warns about install scripts.** npm 12 blocks dependency install scripts by default. The only one affected (`fsevents`) isn't needed, so the warning is harmless.

---

## Doing it with Claude Code

The repo includes `CLAUDE.md` (project rules) and two skills that Claude Code uses automatically:

- **add-content**: adding technologies, notes, projects, ideas, About entries and tags with valid frontmatter
- **cyberpunk-scenes**: building or changing background scenes

Example requests:
- "Add FastAPI to the stack. I'm learning it, it's a Python backend framework I use for ML APIs."
- "Write up a knowledge base note from these bullet points about PyTorch DataLoader workers: …"
- "Here's my CV, fill in the About page experience and education from it."
- "Mark the edge benchmarking idea as became-project and create the project page for it."
- "Add a `security` domain tag."

---

## House rules

- **Sentence case** for all titles, headings and labels. No all-caps, and no "→" tacked onto links.
- **No skill bars or percentages.** Proficiency is the `status` field, nothing else.
- **No personal details** (phone, address, date of birth) anywhere in the repo, including inside PDFs.
- **One tag list:** new tag values go in `src/data/taxonomy.ts` and nowhere else.
- **References, not links:** connect content with slugs in frontmatter so the site keeps the cross-links up to date.
