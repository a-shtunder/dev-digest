import { z } from 'zod';

import { Risk, RiskSeverity } from './brief';

/**
 * PR Brief Card: condensed "what/why/risk" summary card shown on a PR's
 * review overview, plus the endpoint envelope that serves it.
 */

// ---- Review focus ----
export const ReviewFocusItem = z.object({
  label: z.string(),
  file_ref: z.string(),
  reason: z.string(),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

// ---- Brief ----
export const Brief = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: RiskSeverity,
  risks: z.array(Risk),
  review_focus: z.array(ReviewFocusItem),
});
export type Brief = z.infer<typeof Brief>;

// ---- Endpoint envelope ----
export const PrBriefResponse = z.object({
  brief: Brief,
  core_summaries: z.record(z.string(), z.string()),
  head_sha: z.string(),
  generated: z.boolean(),
});
export type PrBriefResponse = z.infer<typeof PrBriefResponse>;
