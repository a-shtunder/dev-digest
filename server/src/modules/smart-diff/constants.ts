import type { SmartDiffRole } from '@devdigest/shared';

/**
 * All thresholds/patterns for Smart Diff classification live here (not inlined
 * in classifier.ts) so tuning the heuristics never requires touching logic.
 */

// core sits on top, boilerplate at the bottom.
export const ROLE_ORDER: SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

export const BOILERPLATE_PATTERNS: RegExp[] = [
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/, // lock → ALWAYS boilerplate
  /(^|\/)(dist|build|out|coverage)\//,
  /\.min\.(js|css)$/,
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /(^|\/)node_modules\//,
  /\.(d\.ts|svg)$/, // generated type declarations + vector assets
  /(^|\/)migrations\//, // generated SQL, never hand-authored
];

export const WIRING_PATTERNS: RegExp[] = [
  /\.config\.[cm]?[jt]s$/,
  /(^|\/)(tsconfig|drizzle\.config)[^/]*$/,
  /(^|\/)index\.[cm]?tsx?$/,
  /(^|\/)(server|app|main|container)\.[cm]?tsx?$/,
  /(^|\/)config\.[cm]?tsx?$/,
  /(^|\/)package\.json$/,
  /\.env(\.|$)/,
  /(^|\/)\.github\//, // CI/CD workflows, issue/PR templates, CODEOWNERS, dependabot
  /(^|\/)Dockerfile([^/]*)?$/,
  /(^|\/)docker-compose[^/]*\.ya?ml$/,
]; // everything else → core

// additions+deletions across the whole PR
export const SPLIT_TOO_BIG_TOTAL_LINES = 500;
// AND file count >= this
export const SPLIT_MIN_FILES = 8;
