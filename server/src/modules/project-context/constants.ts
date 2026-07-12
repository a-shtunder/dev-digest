/**
 * Bucket set for project-context discovery. Kept as a standalone constant
 * (not inlined into `discovery.ts`) so changing which top-level folders are
 * eligible for discovery only touches this file (AC-3).
 */
export const BUCKETS = ['specs', 'docs', 'insights'] as const;
export type BucketName = (typeof BUCKETS)[number];
