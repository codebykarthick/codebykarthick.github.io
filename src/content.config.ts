import { defineCollection, reference } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import {
  DOMAINS,
  IDEA_STATUSES,
  KINDS,
  LIFECYCLES,
  PROJECT_STATUSES,
  RESOURCE_KINDS,
  STATUSES,
  TOPICS,
} from "./data/taxonomy";

const md = (dir: string) => glob({ pattern: "**/*.md", base: `./src/content/${dir}` });

/** One stage of a technology's learning roadmap. */
const stage = z.object({
  title: z.string(),
  goal: z.string(),
  /** Where this stage gets put into practice, e.g. a project phase. */
  apply: z.string().optional(),
  learn: z.array(z.string()).default([]),
  practice: z.array(z.string()).default([]),
  doneWhen: z.array(z.string()).default([]),
  notes: z.array(reference("notes")).default([]),
});

const resource = z.object({
  title: z.string(),
  url: z.url(),
  kind: z.enum(RESOURCE_KINDS),
});

const technologies = defineCollection({
  loader: md("technologies"),
  schema: z
    .object({
      name: z.string(),
      summary: z.string().max(160),
      status: z.enum(STATUSES),
      started: z.coerce.date(),
      links: z.object({ docs: z.url().optional(), repo: z.url().optional() }).default({}),
      language: z.array(reference("technologies")).default([]),
      lifecycle: z.array(z.enum(LIFECYCLES)).min(1),
      domain: z.array(z.enum(DOMAINS)).min(1),
      kind: z.array(z.enum(KINDS)).min(1),
      prerequisites: z.array(reference("technologies")).default([]),
      roadmap: z.array(stage).default([]),
      resources: z.array(resource).default([]),
      example: z.boolean().default(false),
    })
    .refine((d) => !(d.kind.includes("language") && d.language.length > 0), {
      message: "language must be empty when kind is language",
      path: ["language"],
    }),
});

const notes = defineCollection({
  loader: md("notes"),
  schema: z.object({
    title: z.string(),
    summary: z.string().max(200),
    technologies: z.array(reference("technologies")).min(1),
    topics: z.array(z.enum(TOPICS)).default([]),
    updated: z.coerce.date(),
    example: z.boolean().default(false),
  }),
});

const projects = defineCollection({
  loader: md("projects"),
  schema: z.object({
    title: z.string(),
    summary: z.string().max(200),
    status: z.enum(PROJECT_STATUSES),
    stack: z.array(reference("technologies")).min(1),
    repo: z.url().optional(),
    demo: z.url().optional(),
    started: z.coerce.date(),
    ended: z.coerce.date().optional(),
    example: z.boolean().default(false),
  }),
});

const ideas = defineCollection({
  loader: md("ideas"),
  schema: z
    .object({
      title: z.string(),
      summary: z.string().max(200),
      status: z.enum(IDEA_STATUSES),
      technologies: z.array(reference("technologies")).default([]),
      project: reference("projects").optional(),
      example: z.boolean().default(false),
    })
    .refine((d) => (d.status === "became-project") === (d.project !== undefined), {
      message: "became-project requires project, and project requires status became-project",
      path: ["project"],
    }),
});

const timeline = {
  org: z.string(),
  start: z.coerce.date(),
  end: z.coerce.date().optional(),
  location: z.string().optional(),
  order: z.number().int(),
  highlights: z.array(z.string()).default([]),
  placeholder: z.boolean().default(false),
};

const experience = defineCollection({
  loader: md("experience"),
  schema: z.object({ ...timeline, role: z.string() }),
});

const education = defineCollection({
  loader: md("education"),
  schema: z.object({ ...timeline, degree: z.string() }),
});

export const collections = { technologies, notes, projects, ideas, experience, education };
