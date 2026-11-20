import type { SceneId } from "../scenes/types";

export const profile = {
  name: "Sri",
  role: "ML engineer",
  siteTitle: "Sri, ML engineer",
  description: "The tech stack I'm learning and using, with notes, projects and ideas linked to each technology.",
  links: {
    github: "https://github.com/codebykarthick",
    linkedin: "https://www.linkedin.com/in/sriharikarthick",
    source: "https://github.com/codebykarthick/codebykarthick.github.io",
  },
} as const;

export interface Section {
  href: string;
  label: string;
  blurb: string;
  scene: SceneId;
}

/** Top-level sections, in nav order. */
export const SECTIONS: readonly Section[] = [
  { href: "/stack", label: "Tech stack", blurb: "Every technology I'm learning or using, filterable by language, domain and kind.", scene: "metro" },
  { href: "/knowledge", label: "Knowledge base", blurb: "Notes I've written while learning, searchable in full.", scene: "archive" },
  { href: "/projects", label: "Projects", blurb: "Things I've built, and the stack behind each one.", scene: "construction" },
  { href: "/ideas", label: "Ideas", blurb: "Things I might build next, and where they stand.", scene: "rooftop" },
  { href: "/about", label: "About me", blurb: "Education, work history and my CV.", scene: "desert" },
];
