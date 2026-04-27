import { createHash } from 'node:crypto';

/** Tmux disallows `.` and `:` in session names (they're reserved as
 *  target separators). All other ASCII is fair game. */
const FORBIDDEN_CHARS = /[.:]/g;

/** Tmux has no documented length cap, but `tmux ls` becomes hard to
 *  read past ~200 chars and some shells truncate names in pane titles.
 *  We cap conservatively. */
const MAX_LEN = 200;

/** When truncating, we suffix a stable hash of the original so two
 *  long names sharing a prefix don't collide. 4 chars × 16 bits ≈
 *  65k buckets — vastly more than realistic concurrent sessions for
 *  one project. */
const HASH_TAIL = 4;

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, HASH_TAIL);
}

/**
 * Pure tmux-mechanics name sanitizer. Knows nothing about branches,
 * worktrees, or the application using it — only tmux's own validity
 * rules.
 *
 * - Replaces tmux-forbidden characters (`.`, `:`) with `-`.
 * - Caps the result at 200 characters; on overflow, truncates the
 *   tail and appends a 4-char hash of the *original* (pre-cap) input
 *   to preserve uniqueness across long names that share a prefix.
 */
export function sanitizeTmuxSessionName(raw: string): string {
  const replaced = raw.replace(FORBIDDEN_CHARS, '-');
  if (replaced.length <= MAX_LEN) return replaced;
  const hash = shortHash(raw);
  // Reserve room for the separator and hash so the final string is exactly MAX_LEN.
  const head = replaced.slice(0, MAX_LEN - HASH_TAIL - 1);
  return `${head}-${hash}`;
}
