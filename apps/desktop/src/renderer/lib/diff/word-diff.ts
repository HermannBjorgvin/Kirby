/**
 * Intra-line diffing: given a removed line and the added line it was
 * paired with, which characters actually changed.
 *
 * Separate from diff-model.ts because it answers a different question.
 * That file lays rows out — folding unchanged runs, pairing sides;
 * this one looks inside a single pair of lines, and is the only part
 * of the viewer that runs an actual diff algorithm.
 */

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
 * Longest-common-subsequence lengths for every suffix pair, built from
 * the end backwards so `dp[i][j]` is the LCS of `a[i..]` and `b[j..]`.
 * The walk below reads it to decide which side to advance.
 */
function lcsTable(a: string[], b: string[]): Uint16Array[] {
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
  return dp;
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

  const m = a.length;
  const n = b.length;
  const dp = lcsTable(a, b);
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
