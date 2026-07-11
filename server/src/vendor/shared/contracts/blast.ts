import { z } from 'zod';

/**
 * Blast Radius (L04): flat mirror of repo-intel's own `BlastResult` shape
 * (server/src/modules/repo-intel/types.ts), Zod-validated for the HTTP
 * boundary. Deliberately distinct names from contracts/brief.ts's
 * BlastRadius/ChangedSymbol/BlastCaller/DownstreamImpact — those belong to a
 * separate, not-yet-built LLM-authored "PR Brief" feature with an
 * incompatible grouped/snake_case shape.
 */

export const BlastChangedSymbol = z.object({
  file: z.string(),
  name: z.string(),
  kind: z.string(),
});
export type BlastChangedSymbol = z.infer<typeof BlastChangedSymbol>;

export const BlastCallerRow = z.object({
  file: z.string(),
  symbol: z.string(),
  viaSymbol: z.string(),
  /** The exact file that declares `viaSymbol` this row calls into — disambiguates
   *  two changed files that happen to declare a same-named symbol. */
  viaFile: z.string(),
  line: z.number().int(),
  rank: z.number(),
});
export type BlastCallerRow = z.infer<typeof BlastCallerRow>;

export const BlastFileFacts = z.object({
  endpoints: z.array(z.string()),
  crons: z.array(z.string()),
});
export type BlastFileFacts = z.infer<typeof BlastFileFacts>;

export const BlastDegradedReason = z.enum([
  'flag_off',
  'index_failed',
  'index_partial',
  'repo_too_large',
  'no_data',
]);
export type BlastDegradedReason = z.infer<typeof BlastDegradedReason>;

export const BlastRadiusResult = z.object({
  changedSymbols: z.array(BlastChangedSymbol),
  callers: z.array(BlastCallerRow),
  impactedEndpoints: z.array(z.string()),
  factsByFile: z.record(z.string(), BlastFileFacts).optional(),
  degraded: z.boolean().optional(),
  reason: BlastDegradedReason.optional(),
});
export type BlastRadiusResult = z.infer<typeof BlastRadiusResult>;
