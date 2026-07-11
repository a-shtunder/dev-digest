/* Presentational constants for SmartDiffViewer. Severity color/icon is NOT
   duplicated here — that single source of truth is `SEV` from `@devdigest/ui`.
   This only maps a SmartDiffRole to its dot color + i18n label/description keys. */
import type { SmartDiffRole } from "@devdigest/shared";

export const ROLE_META: Record<
  SmartDiffRole,
  { dotColor: string; labelKey: string; descriptionKey: string }
> = {
  core: {
    dotColor: "var(--crit)",
    labelKey: "smartDiff.role.core.label",
    descriptionKey: "smartDiff.role.core.description",
  },
  wiring: {
    dotColor: "var(--warn)",
    labelKey: "smartDiff.role.wiring.label",
    descriptionKey: "smartDiff.role.wiring.description",
  },
  boilerplate: {
    dotColor: "var(--text-muted)",
    labelKey: "smartDiff.role.boilerplate.label",
    descriptionKey: "smartDiff.role.boilerplate.description",
  },
};
