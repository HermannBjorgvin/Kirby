import type { DiffLine } from '@kirby/diff';

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
  const context = opts.context ?? DEFAULT_CONTEXT;
  const n = lines.length;
  if (opts.noFold) return lines.map((_, index) => ({ kind: 'line', index }));

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
    else if (opts.pinnedAnchors?.size) {
      for (const a of lineAnchors(l)) {
        if (opts.pinnedAnchors.has(a)) {
          mark(i);
          break;
        }
      }
    }
    if (opts.expanded?.has(i)) visible[i] = 1;
  }

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

// ── Intra-line (word) diff ───────────────────────────────────────

export interface CharRange {
  start: number;
  end: number;
}

const TOKEN_RE = /\w+|\s+|[^\w\s]/g;
const MAX_TOKENS = 300;

function tokenize(s: string): string[] {
  return s.match(TOKEN_RE) ?? [];
}

/**
 * Character ranges that differ between a removed line and its paired
 * added line, per side. Uses an LCS over word-ish tokens; bails out
 * (returns null) when the lines are too different for highlights to
 * help, or too long to diff cheaply.
 */
export function wordDiff(
  oldText: string,
  newText: string
): { old: CharRange[]; new: CharRange[] } | null {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  if (a.length === 0 || b.length === 0) return null;
  if (a.length + b.length > MAX_TOKENS) return null;

  // LCS table
  const m = a.length;
  const n = b.length;
  const dp: Uint16Array[] = [];
  for (let i = 0; i <= m; i++) dp.push(new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const oldR: CharRange[] = [];
  const newR: CharRange[] = [];
  let i = 0;
  let j = 0;
  let oa = 0;
  let ob = 0;
  let changedChars = 0;
  const push = (arr: CharRange[], start: number, end: number) => {
    const last = arr[arr.length - 1];
    if (last && last.end === start) last.end = end;
    else arr.push({ start, end });
  };
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      oa += a[i].length;
      ob += b[j].length;
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(oldR, oa, oa + a[i].length);
      changedChars += a[i].length;
      oa += a[i].length;
      i += 1;
    } else {
      push(newR, ob, ob + b[j].length);
      changedChars += b[j].length;
      ob += b[j].length;
      j += 1;
    }
  }
  while (i < m) {
    push(oldR, oa, oa + a[i].length);
    changedChars += a[i].length;
    oa += a[i].length;
    i += 1;
  }
  while (j < n) {
    push(newR, ob, ob + b[j].length);
    changedChars += b[j].length;
    ob += b[j].length;
    j += 1;
  }
  // Mostly different → highlighting everything is noise.
  if (changedChars > 0.7 * (oldText.length + newText.length)) return null;
  return { old: oldR, new: newR };
}

/** Trim leading/trailing whitespace-only ranges for nicer highlights. */
export function isWhitespaceRange(text: string, r: CharRange): boolean {
  return text.slice(r.start, r.end).trim().length === 0;
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
