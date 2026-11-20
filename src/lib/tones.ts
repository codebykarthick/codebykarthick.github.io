import type { IdeaStatus, ProjectStatus, Status } from "../data/taxonomy";

export type Tone = "cyan" | "pink" | "amber" | "dim";

export const STATUS_TONE: Record<Status, Tone> = { learning: "amber", using: "cyan", comfortable: "pink" };
export const PROJECT_TONE: Record<ProjectStatus, Tone> = { planned: "dim", building: "cyan", shipped: "pink", archived: "dim" };
export const IDEA_TONE: Record<IdeaStatus, Tone> = { raw: "dim", exploring: "amber", "became-project": "cyan", parked: "dim" };
