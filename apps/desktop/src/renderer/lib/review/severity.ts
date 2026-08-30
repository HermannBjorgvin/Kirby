import type { CommentSeverity } from '../../../host/contract.js';

/** Severity values, most→least important (also the edit-select order). */
export const SEVERITIES: CommentSeverity[] = [
  'critical',
  'major',
  'minor',
  'nit',
];

/** Badge variant per severity (shadcn Badge). */
export const SEVERITY_BADGE: Record<
  CommentSeverity,
  'destructive' | 'warning' | 'info' | 'outline'
> = {
  critical: 'destructive',
  major: 'warning',
  minor: 'info',
  nit: 'outline',
};

/** Dot colour per severity (comment list, walkthrough legend). */
export const SEVERITY_DOT: Record<CommentSeverity, string> = {
  critical: 'bg-destructive',
  major: 'bg-warning',
  minor: 'bg-info',
  nit: 'bg-muted-foreground/50',
};

/** Left-rail accent per severity (draft cards). */
export const SEVERITY_RAIL: Record<CommentSeverity, string> = {
  critical: 'border-l-destructive',
  major: 'border-l-warning',
  minor: 'border-l-info',
  nit: 'border-l-muted-foreground/40',
};

/** Compact "2 critical · 1 major" summary from a per-severity tally. */
export function formatSeverityBreakdown(
  counts: Record<CommentSeverity, number>
): string {
  return SEVERITIES.filter((s) => counts[s] > 0)
    .map((s) => `${counts[s]} ${s}`)
    .join(' · ');
}
