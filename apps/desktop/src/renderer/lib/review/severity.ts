import {
  conventionalSeverity,
  type ConventionalComment,
} from '@kirby/review-comments/conventional';
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

/**
 * A Conventional Comments header, coloured on the same scale as an
 * agent's severity.
 *
 * The two vocabularies describe the same thing — how much this remark
 * binds — so they have to look the same on screen. A reviewer's
 * "issue (blocking)" and an agent's `critical` are one claim, and
 * giving them different colours would invent a distinction the reader
 * then has to learn.
 */
export function conventionalBadge(
  header: Pick<ConventionalComment, 'label' | 'decorations'>
): (typeof SEVERITY_BADGE)[CommentSeverity] {
  return SEVERITY_BADGE[conventionalSeverity(header)];
}
