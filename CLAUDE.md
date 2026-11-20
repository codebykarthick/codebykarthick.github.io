# codebykarthick.github.io

Sri's public reference for the tech stack they're learning: technologies are the hub, and notes, projects and ideas link to them. Astro static site on GitHub Pages, with procedural three.js megacity scenes behind the content.

## Commands

- `npm run dev`: dev server at http://localhost:4321. Pagefind search does not work here.
- `npm run build`: `astro check` (strict TS) → `vitest run` → `astro build` → `pagefind --site dist`. CI runs exactly this.
- `npm test`: Vitest unit tests (`src/lib/*.test.ts`).
- `npm run preview`: serve `dist/`. Use this to test search and the real scene loading.
- `npm run check`: type check only.
- Debug scenes: append `?tier=low|medium|high` to force a quality tier (not persisted) and `?debug-scenes` to expose the engine as `window.__scene` (`__scene.info()` gives draw calls and GPU memory).

## Folder map

```
src/
  pages/            routes (index, stack, knowledge, projects, ideas, about, 404)
  layouts/          Base (head, nav, scene, footer) → Landing (full scene) / Reading (ambient scene, solid panel)
  components/       Nav, SceneHost, PauseToggle, PageIntro, Filterable, TechCard, Roadmap, EntryList, TagList, Badge
  styles/tokens.css ALL design tokens (colours, fonts, spacing, scene fallback gradients)
  styles/global.css reset, type, .panel, .btn, .glitch, .prose, focus, reduced motion
  data/profile.ts   name, role, links, section list (nav order)
  data/taxonomy.ts  ALL filter values and labels
  content.config.ts collection schemas (zod, enums from taxonomy.ts)
  content/          technologies, notes, projects, ideas, experience, education (Markdown)
  lib/content.ts    loadSite() (sorted collections + integrity check), filters, aggregation, roadmap paths
  lib/filters.ts    pure filter state/URL logic (unit-tested); lib/filter-ui.ts binds it to the DOM
  lib/tones.ts      status → badge colour
  scenes/           engine.ts, boot.ts, registry.ts, prefs.ts, types.ts, one module per scene
  scenes/kit/       shared scene building blocks extracted from the PoC
reference/poc-index.html   original three.js r128 proof of concept, not built; keep for reference
.claude/skills/            cyberpunk-scenes (new page scenes), add-content (content and tags)
```

## Rules

### Content and taxonomy
- Every allowed filter value (lifecycle, domain, kind, topics, statuses) lives in `src/data/taxonomy.ts` with its display label. Schemas build their enums from it, so an unknown tag fails the build. To add a value, edit that one file only.
- Languages are not taxonomy values. A language is a technology entry with kind `language`; other technologies reference it in `language`.
- Cross-links use `reference()` in frontmatter, never hand-written URLs.
- Proficiency is the `status` field only. No skill bars, percentages or star ratings anywhere.
- `example: true` shows an "Example" badge; About placeholders use `placeholder: true`.
- Technologies can carry an ordered `roadmap` (stages with goal, learn, practice, doneWhen, notes). Notes in a stage get roadmap position and previous/next links automatically.
- Quote YAML values containing `: `.
- Load technologies, notes, projects and ideas through `loadSite()` in `src/lib/content.ts`, not `getCollection` directly, so the integrity check runs. (Experience and education have no references and are read directly on /about.)
- Use the `add-content` skill when adding content or tags.
- Only add the content Sri asks for. Don't invent projects, ideas, technologies or capstones. Sri's capstone is InferenceFlow (Go, https://github.com/codebykarthick/system-in-go); the Go roadmap is a companion to it and each stage's `apply` names the InferenceFlow phase. Never invent InferenceFlow details beyond its README and Roadmap.md.

### Design
- Colours, fonts and spacing come from `src/styles/tokens.css` custom properties. Don't hard-code hex values in components.
- Sentence case for all UI text. No all-caps labels and no "→" appended to links. (In-world scene signage is art, not UI, and is exempt.)
- Reading pages put text on `.panel--solid`. Body text must meet WCAG AA against it whatever the scene is doing.
- At most one `.glitch` element per page (the page's h1).
- Accessibility: keep the skip link, visible `:focus-visible`, semantic heading order, `aria-hidden` on scene layers, keyboard-operable controls.

### Scenes
- Use the `cyberpunk-scenes` skill to add or change a scene. Summary:
- three.js loads only via dynamic import after first paint (`SceneHost` → `boot.ts`). Never import `three` from page or component scripts. `scenes/prefs.ts` is the three-free module for UI code.
- Every scene has a CSS fallback gradient (`--scene-<id>` in tokens.css) shown before load and without WebGL.
- Originality: no landmarks, logos, brands or names from existing games or films.
- Colour management is off (`ColorManagement.enabled = false`): colours are authored as display values, as in the PoC.

### Navigation
- No `<ClientRouter />`. Pages use native cross-document view transitions (`@view-transition` in global.css). Every navigation is a full page load, and scenes dispose on `pagehide`.

## Deployment
- `.github/workflows/deploy.yml` runs `withastro/action@v6` + `actions/deploy-pages@v5` on push to `main`.
- Repo setting: Settings → Pages → Build and deployment → Source: GitHub Actions.
- `site` is `https://codebykarthick.github.io` with no `base`. Commit `package-lock.json`.
- The CV is `public/cv.pdf`. Never commit a CV with a phone number or home address: git history is permanent.

## Search
- Pagefind indexes only note pages (`data-pagefind-body` in `knowledge/[slug].astro`). `/knowledge` calls the Pagefind JS API and intersects results with the chip filters; in `astro dev` it falls back to title/summary matching.

## Status
- Phases 1–4 done: scaffold, engine and kit, all six scenes, content model, /stack, /knowledge with search, projects, ideas, about, 404.
- Phase 5 next: performance (Lighthouse mobile), accessibility and cross-browser pass.
