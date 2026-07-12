export const TABS = ["config", "context", "preview", "stats", "versions"] as const;
export type SkillEditorTab = (typeof TABS)[number];
