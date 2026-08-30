import type { DiffLine } from '@kirby/diff';
import type { CommentSeverity, ReviewComment } from '../../host/contract.js';

/**
 * Pure helpers behind the diff viewer. The host hands us whole-file
 * diffs (`git diff -U99999`) so review comments on untouched lines can
 * be placed; the viewer then has to fold the unchanged bulk back down
 * to something reviewable — GitHub-style ±context with expandable
 * gaps — and optionally lay lines out side by side.
 */

export const DEFAULT_CONTEXT = 3;
/** Gaps shorter than this are shown inline instead of folded. */
const MIN_FOLD = 4;
export const EXPAND_STEP = 20;

export type Side = 'L' | 'R';

/** Anchor key for a line on one side, e.g. "R12" / "L7". */
export function anchorKey(side: Side, line: number): string {
  return `${side}${line}`;
}

export function lineAnchors(line: DiffLine): string[] {
  const out: string[] = [];
  if (line.newLine != null) out.push(anchorKey('R', line.newLine));
  if (line.oldLine != null) out.push(anchorKey('L', line.oldLine));
  return out;
}

/**
 * React key identifying a diff line by what it *is* rather than where
 * it currently sits. Both sides are included because an added and a
 * removed line can share a number, and the type separates the hunk
 * headers, which carry no number at all.
 */
export function lineKey(line: DiffLine): string {
  return `${line.type}:${line.oldLine ?? ''}:${line.newLine ?? ''}`;
}

// ── Folding ──────────────────────────────────────────────────────

export type UnifiedRow =
  | { kind: 'line'; index: number }
  | { kind: 'fold'; from: number; to: number };

/**
 * Compute which line indices are visible: every changed line and hunk
 * header plus `context` lines around them, every line carrying a
 * thread anchor, and anything the user expanded. Remaining runs of
 * hidden lines longer than MIN_FOLD become fold rows.
 */
export function buildUnifiedRows(
  lines: readonly DiffLine[],
  opts: {
    context?: number;
    /** Anchor keys (see anchorKey) that must stay visible. */
    pinnedAnchors?: ReadonlySet<string>;
    /** Line indices the user force-expanded. */
    expanded?: ReadonlySet<number>;
    /** When true nothing is folded (e.g. small files). */
    noFold?: boolean;
  } = {}
): UnifiedRow[] {
  if (opts.noFold) return lines.map((_, index) => ({ kind: 'line', index }));
  return foldHiddenRuns(markVisibleLines(lines, opts));
}

/**
 * First half of the fold: a byte per line, 1 where the reviewer must
 * see it. A line earns that for one of three reasons — it changed (or
 * heads a hunk) and so does its context window, it carries a pinned
 * thread anchor, or the reviewer expanded it by hand.
 */
function markVisibleLines(
  lines: readonly DiffLine[],
  opts: {
    context?: number;
    pinnedAnchors?: ReadonlySet<string>;
    expanded?: ReadonlySet<number>;
  }
): Uint8Array {
  const context = opts.context ?? DEFAULT_CONTEXT;
  const n = lines.length;
  const visible = new Uint8Array(n);
  const mark = (i: number) => {
    const lo = Math.max(0, i - context);
    const hi = Math.min(n - 1, i + context);
    for (let j = lo; j <= hi; j++) visible[j] = 1;
  };
  for (let i = 0; i < n; i++) {
    const l = lines[i];
    if (l.type === 'add' || l.type === 'remove' || l.type === 'hunk-header')
      mark(i);
    else if (hasPinnedAnchor(l, opts.pinnedAnchors)) mark(i);
    if (opts.expanded?.has(i)) visible[i] = 1;
  }
  return visible;
}

/** Whether a thread is anchored to this line on either side. */
function hasPinnedAnchor(
  line: DiffLine,
  pinned: ReadonlySet<string> | undefined
): boolean {
  if (!pinned?.size) return false;
  return lineAnchors(line).some((a) => pinned.has(a));
}

/**
 * Second half of the fold: emit a row per visible line, and collapse
 * each run of hidden ones into a fold. Runs shorter than MIN_FOLD are
 * emitted as lines instead — a fold marker costs more height than the
 * lines it would hide.
 */
function foldHiddenRuns(visible: Uint8Array): UnifiedRow[] {
  const n = visible.length;
  const rows: UnifiedRow[] = [];
  let i = 0;
  while (i < n) {
    if (visible[i]) {
      rows.push({ kind: 'line', index: i });
      i += 1;
      continue;
    }
    let j = i;
    while (j < n && !visible[j]) j += 1;
    if (j - i < MIN_FOLD) {
      for (let k = i; k < j; k++) rows.push({ kind: 'line', index: k });
    } else {
      rows.push({ kind: 'fold', from: i, to: j });
    }
    i = j;
  }
  return rows;
}

/** Indices to add to the expanded set for an expand action on a fold. */
export function expandIndices(
  fold: { from: number; to: number },
  direction: 'up' | 'down' | 'all',
  step = EXPAND_STEP
): number[] {
  const out: number[] = [];
  if (direction === 'all') {
    for (let i = fold.from; i < fold.to; i++) out.push(i);
  } else if (direction === 'up') {
    // "Expand up" reveals lines at the top of the gap (continuing the
    // code above it).
    for (let i = fold.from; i < Math.min(fold.to, fold.from + step); i++)
      out.push(i);
  } else {
    for (let i = Math.max(fold.from, fold.to - step); i < fold.to; i++)
      out.push(i);
  }
  return out;
}

// ── Split (side-by-side) layout ──────────────────────────────────

export interface SplitCell {
  index: number;
  line: DiffLine;
}
export type SplitRow =
  | { kind: 'pair'; left: SplitCell | null; right: SplitCell | null }
  | { kind: 'context'; index: number }
  | { kind: 'hunk'; index: number }
  | { kind: 'fold'; from: number; to: number };

/**
 * Pair removed/added runs by position (the classic side-by-side
 * alignment); context lines span both sides; folds pass through.
 */
export function buildSplitRows(
  lines: readonly DiffLine[],
  unified: readonly UnifiedRow[]
): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < unified.length) {
    const row = unified[i];
    if (row.kind === 'fold') {
      rows.push(row);
      i += 1;
      continue;
    }
    const line = lines[row.index];
    if (line.type === 'hunk-header') {
      rows.push({ kind: 'hunk', index: row.index });
      i += 1;
      continue;
    }
    if (line.type === 'context') {
      rows.push({ kind: 'context', index: row.index });
      i += 1;
      continue;
    }
    // Collect a run of removes followed by a run of adds.
    const removes: SplitCell[] = [];
    const adds: SplitCell[] = [];
    while (i < unified.length) {
      const r = unified[i];
      if (r.kind !== 'line') break;
      const l = lines[r.index];
      if (l.type === 'remove' && adds.length === 0) {
        removes.push({ index: r.index, line: l });
      } else if (l.type === 'add') {
        adds.push({ index: r.index, line: l });
      } else break;
      i += 1;
    }
    const len = Math.max(removes.length, adds.length);
    for (let k = 0; k < len; k++) {
      rows.push({
        kind: 'pair',
        left: removes[k] ?? null,
        right: adds[k] ?? null,
      });
    }
  }
  return rows;
}

// ── File classification for default collapse ─────────────────────

const LOCKFILE_RE =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|Gemfile\.lock|Cargo\.lock|poetry\.lock|composer\.lock|Pipfile\.lock|go\.sum)$/;
const GENERATED_RE =
  /(\.min\.(js|css)|\.bundle\.(js|css)|\.generated\.\w+|\.map|\.snap)$|(^|\/)(dist|build)\//;
export const LARGE_FILE_LINES = 1500;

export type CollapseReason = 'lockfile' | 'generated' | 'large' | null;

export function defaultCollapseReason(
  filename: string,
  changedLines: number
): CollapseReason {
  if (LOCKFILE_RE.test(filename)) return 'lockfile';
  if (GENERATED_RE.test(filename)) return 'generated';
  if (changedLines > LARGE_FILE_LINES) return 'large';
  return null;
}

// ── Draft review walkthrough ─────────────────────────────────────

export const SEVERITY_RANK: Record<CommentSeverity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
  nit: 3,
};

/**
 * Order drafts for the "Review ready" walkthrough: by severity
 * (critical → nit), then by the file's position in the diff, then by
 * line. `fileOrder` maps a filename to its index among the changed
 * files so unknown files sort last.
 */
export function orderDraftsForReview(
  drafts: readonly ReviewComment[],
  fileOrder: ReadonlyMap<string, number>
): ReviewComment[] {
  return [...drafts].sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) return s;
    const fa = fileOrder.get(a.file) ?? Number.MAX_SAFE_INTEGER;
    const fb = fileOrder.get(b.file) ?? Number.MAX_SAFE_INTEGER;
    if (fa !== fb) return fa - fb;
    return a.lineStart - b.lineStart;
  });
}

/** Count drafts per severity, for the "Review ready" breakdown. */
export function severityCounts(
  drafts: readonly ReviewComment[]
): Record<CommentSeverity, number> {
  const counts: Record<CommentSeverity, number> = {
    critical: 0,
    major: 0,
    minor: 0,
    nit: 0,
  };
  for (const d of drafts) counts[d.severity] += 1;
  return counts;
}

/**
 * A window of diff lines around a draft's anchor, for the snippet shown
 * next to it in the walkthrough. Matches on the new-file line (RIGHT)
 * or old-file line (LEFT); returns the anchored lines plus `radius`
 * lines of context on each side. `anchor` flags which rows the comment
 * covers so the snippet can highlight them.
 */
export function snippetAround(
  lines: readonly DiffLine[],
  side: 'LEFT' | 'RIGHT',
  lineStart: number,
  lineEnd: number,
  radius = 3
): { line: DiffLine; anchored: boolean }[] {
  const key = side === 'LEFT' ? 'oldLine' : 'newLine';
  const inRange = (l: DiffLine) => {
    const n = l[key];
    return n != null && n >= lineStart && n <= lineEnd;
  };
  const first = lines.findIndex(inRange);
  if (first < 0) {
    // Anchor not in the diff (outdated / out of hunk): show nothing.
    return [];
  }
  let last = first;
  for (let i = first; i < lines.length; i++) if (inRange(lines[i])) last = i;
  const from = Math.max(0, first - radius);
  const to = Math.min(lines.length - 1, last + radius);
  const out: { line: DiffLine; anchored: boolean }[] = [];
  for (let i = from; i <= to; i++) {
    out.push({ line: lines[i], anchored: i >= first && i <= last });
  }
  return out;
}
