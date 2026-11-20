/**
 * Every allowed filter value on the site, with its display label.
 * Content schemas build their enums from these arrays, so an unknown value fails the build.
 * To add a value: add it to the array AND its label to the matching map (the type checker
 * enforces both). Languages are not here: they are technology entries with kind "language".
 */

export const STATUSES = ["learning", "using", "comfortable"] as const;
export const STATUS_LABELS: Record<Status, string> = {
  learning: "Learning",
  using: "Using",
  comfortable: "Comfortable",
};

export const LIFECYCLES = ["design", "build", "test", "deploy", "operate"] as const;
export const LIFECYCLE_LABELS: Record<Lifecycle, string> = {
  design: "Design",
  build: "Build",
  test: "Test",
  deploy: "Deploy",
  operate: "Operate",
};

export const DOMAINS = ["frontend", "backend", "data", "ml", "devops"] as const;
export const DOMAIN_LABELS: Record<Domain, string> = {
  frontend: "Frontend",
  backend: "Backend",
  data: "Data",
  ml: "ML",
  devops: "DevOps",
};

export const KINDS = ["language", "framework", "library", "tool", "platform"] as const;
export const KIND_LABELS: Record<Kind, string> = {
  language: "Language",
  framework: "Framework",
  library: "Library",
  tool: "Tool",
  platform: "Platform",
};

/** Note topics. */
export const TOPICS = [
  "fundamentals",
  "setup",
  "containers",
  "images",
  "networking",
  "data-modelling",
  "querying",
  "transactions",
  "migrations",
  "performance",
  "testing",
  "ci-cd",
  "security",
  "deployment",
  "debugging",
  "best-practices",
] as const;
export const TOPIC_LABELS: Record<Topic, string> = {
  fundamentals: "Fundamentals",
  setup: "Setup",
  containers: "Containers",
  images: "Images",
  networking: "Networking",
  "data-modelling": "Data modelling",
  querying: "Querying",
  transactions: "Transactions",
  migrations: "Migrations",
  performance: "Performance",
  testing: "Testing",
  "ci-cd": "CI/CD",
  security: "Security",
  deployment: "Deployment",
  debugging: "Debugging",
  "best-practices": "Best practices",
};

export const PROJECT_STATUSES = ["planned", "building", "shipped", "archived"] as const;
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planned: "Planned",
  building: "Building",
  shipped: "Shipped",
  archived: "Archived",
};

export const IDEA_STATUSES = ["raw", "exploring", "became-project", "parked"] as const;
export const IDEA_STATUS_LABELS: Record<IdeaStatus, string> = {
  raw: "Raw",
  exploring: "Exploring",
  "became-project": "Became a project",
  parked: "Parked",
};

export const RESOURCE_KINDS = ["docs", "tutorial", "course", "book", "video", "article", "tool"] as const;
export const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = {
  docs: "Docs",
  tutorial: "Tutorial",
  course: "Course",
  book: "Book",
  video: "Video",
  article: "Article",
  tool: "Tool",
};

export type Status = (typeof STATUSES)[number];
export type Lifecycle = (typeof LIFECYCLES)[number];
export type Domain = (typeof DOMAINS)[number];
export type Kind = (typeof KINDS)[number];
export type Topic = (typeof TOPICS)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
