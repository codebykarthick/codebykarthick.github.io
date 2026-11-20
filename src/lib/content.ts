import { getCollection, type CollectionEntry } from "astro:content";
import {
  DOMAIN_LABELS,
  KIND_LABELS,
  LIFECYCLE_LABELS,
  STATUS_LABELS,
  type ProjectStatus,
  TOPIC_LABELS,
} from "../data/taxonomy";

export type Tech = CollectionEntry<"technologies">;
export type Note = CollectionEntry<"notes">;
export type Project = CollectionEntry<"projects">;
export type Idea = CollectionEntry<"ideas">;

export interface Site {
  techs: Tech[];
  notes: Note[];
  projects: Project[];
  ideas: Idea[];
  tech: Map<string, Tech>;
  note: Map<string, Note>;
  project: Map<string, Project>;
}

/** Display order: work in progress first. */
const PROJECT_ORDER: readonly ProjectStatus[] = ["building", "planned", "shipped", "archived"];

let cached: Promise<Site> | undefined;

/** All content, sorted, with references checked. Throws (failing the build) on any broken reference. */
export function loadSite(): Promise<Site> {
  cached ??= (async () => {
    const [techs, notes, projects, ideas] = await Promise.all([
      getCollection("technologies"),
      getCollection("notes"),
      getCollection("projects"),
      getCollection("ideas"),
    ]);
    const site: Site = {
      techs: techs.sort((a, b) => a.data.name.localeCompare(b.data.name)),
      notes: notes.sort((a, b) => b.data.updated.getTime() - a.data.updated.getTime() || a.data.title.localeCompare(b.data.title)),
      projects: projects.sort(
        (a, b) =>
          PROJECT_ORDER.indexOf(a.data.status) - PROJECT_ORDER.indexOf(b.data.status) ||
          b.data.started.getTime() - a.data.started.getTime(),
      ),
      ideas: ideas.sort((a, b) => a.data.title.localeCompare(b.data.title)),
      tech: new Map(techs.map((t) => [t.id, t])),
      note: new Map(notes.map((n) => [n.id, n])),
      project: new Map(projects.map((p) => [p.id, p])),
    };
    assertIntegrity(site);
    return site;
  })();
  return cached;
}

function assertIntegrity(site: Site): void {
  const errors: string[] = [];
  const check = (file: string, field: string, collection: "technologies" | "notes" | "projects", id: string) => {
    const map = collection === "technologies" ? site.tech : collection === "notes" ? site.note : site.project;
    if (!map.has(id)) errors.push(`${file}: ${field} → "${id}" does not exist in ${collection}`);
  };

  const names = new Map<string, string>();
  for (const t of site.techs) {
    const file = `technologies/${t.id}.md`;
    const key = t.data.name.toLowerCase();
    if (names.has(key)) errors.push(`${file}: name "${t.data.name}" duplicates technologies/${names.get(key)}.md`);
    names.set(key, t.id);
    for (const ref of t.data.language) {
      check(file, "language", "technologies", ref.id);
      const target = site.tech.get(ref.id);
      if (target && !target.data.kind.includes("language")) errors.push(`${file}: language → "${ref.id}" is not a language (its kind is ${target.data.kind.join(", ")})`);
    }
    for (const ref of t.data.prerequisites) check(file, "prerequisites", "technologies", ref.id);
    t.data.roadmap.forEach((stage, i) => {
      for (const ref of stage.notes) check(file, `roadmap[${i}].notes`, "notes", ref.id);
    });
  }
  for (const n of site.notes) for (const ref of n.data.technologies) check(`notes/${n.id}.md`, "technologies", "technologies", ref.id);
  for (const p of site.projects) for (const ref of p.data.stack) check(`projects/${p.id}.md`, "stack", "technologies", ref.id);
  for (const i of site.ideas) {
    for (const ref of i.data.technologies) check(`ideas/${i.id}.md`, "technologies", "technologies", ref.id);
    if (i.data.project) check(`ideas/${i.id}.md`, "project", "projects", i.data.project.id);
  }
  if (errors.length) throw new Error(`Content integrity check failed:\n  ${errors.join("\n  ")}`);
}

const ids = (refs: ReadonlyArray<{ id: string }>) => refs.map((r) => r.id);

/** Filter values for a technology, keyed by filter group. */
export function techFilters(t: Tech): Record<string, string[]> {
  return {
    language: ids(t.data.language),
    lifecycle: t.data.lifecycle,
    domain: t.data.domain,
    kind: t.data.kind,
    status: [t.data.status],
  };
}

/** A note's filter values: its technologies and topics, plus the union of its technologies' groups. */
export function noteFilters(n: Note, site: Site): Record<string, string[]> {
  const techs = n.data.technologies.map((r) => site.tech.get(r.id)).filter((t): t is Tech => !!t);
  const union = (pick: (t: Tech) => readonly string[]) => [...new Set(techs.flatMap(pick))];
  return {
    technology: ids(n.data.technologies),
    topic: n.data.topics,
    domain: union((t) => t.data.domain),
    lifecycle: union((t) => t.data.lifecycle),
    kind: union((t) => t.data.kind),
  };
}

export interface FilterOption {
  value: string;
  label: string;
  count: number;
}

export interface FilterGroup {
  key: string;
  label: string;
  options: FilterOption[];
}

/** Builds chip groups from the values items actually use, so no chip leads to an empty result. */
export function buildGroups(
  items: ReadonlyArray<Record<string, string[]>>,
  spec: ReadonlyArray<{ key: string; label: string; labels: Record<string, string>; order?: readonly string[] }>,
): FilterGroup[] {
  return spec
    .map(({ key, label, labels, order }) => {
      const counts = new Map<string, number>();
      for (const item of items) for (const v of item[key] ?? []) counts.set(v, (counts.get(v) ?? 0) + 1);
      const values = order ? order.filter((v) => counts.has(v)) : [...counts.keys()].sort((a, b) => (labels[a] ?? a).localeCompare(labels[b] ?? b));
      return { key, label, options: values.map((v) => ({ value: v, label: labels[v] ?? v, count: counts.get(v)! })) };
    })
    .filter((g) => g.options.length > 0);
}

export function techNameLabels(site: Site): Record<string, string> {
  return Object.fromEntries(site.techs.map((t) => [t.id, t.data.name]));
}

export const LABELS = {
  status: STATUS_LABELS as Record<string, string>,
  lifecycle: LIFECYCLE_LABELS as Record<string, string>,
  domain: DOMAIN_LABELS as Record<string, string>,
  kind: KIND_LABELS as Record<string, string>,
  topic: TOPIC_LABELS as Record<string, string>,
};

export interface PathStep {
  tech: Tech;
  stageIndex: number;
  stageTitle: string;
  prev?: Note;
  next?: Note;
}

/** Where a note sits in each technology's roadmap, with the previous and next note in that path. */
export function notePath(n: Note, site: Site): PathStep[] {
  const steps: PathStep[] = [];
  for (const tech of site.techs) {
    const flat: Array<{ id: string; stage: number }> = [];
    tech.data.roadmap.forEach((s, i) => s.notes.forEach((r) => flat.push({ id: r.id, stage: i })));
    const at = flat.findIndex((f) => f.id === n.id);
    if (at === -1) continue;
    const stageIndex = flat[at]!.stage;
    steps.push({
      tech,
      stageIndex,
      stageTitle: tech.data.roadmap[stageIndex]!.title,
      prev: at > 0 ? site.note.get(flat[at - 1]!.id) : undefined,
      next: at < flat.length - 1 ? site.note.get(flat[at + 1]!.id) : undefined,
    });
  }
  return steps;
}

export interface TechAggregate {
  otherNotes: Note[];
  projects: Project[];
  ideas: Idea[];
  usedWith: Tech[];
  prerequisiteFor: Tech[];
}

/** Everything that references a technology, collected automatically. */
export function techAggregate(t: Tech, site: Site): TechAggregate {
  const inRoadmap = new Set(t.data.roadmap.flatMap((s) => ids(s.notes)));
  const refs = (list: ReadonlyArray<{ id: string }>) => list.some((r) => r.id === t.id);
  return {
    otherNotes: site.notes.filter((n) => refs(n.data.technologies) && !inRoadmap.has(n.id)),
    projects: site.projects.filter((p) => refs(p.data.stack)),
    ideas: site.ideas.filter((i) => refs(i.data.technologies)),
    usedWith: site.techs.filter((o) => refs(o.data.language)),
    prerequisiteFor: site.techs.filter((o) => refs(o.data.prerequisites)),
  };
}

export function formatDate(d: Date, style: "month" | "day" = "month"): string {
  return d.toLocaleDateString("en-GB", style === "month" ? { month: "short", year: "numeric" } : { day: "numeric", month: "short", year: "numeric" });
}
