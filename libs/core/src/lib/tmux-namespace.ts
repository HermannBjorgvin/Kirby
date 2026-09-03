/**
 * The namespace every tmux session Kirby creates lives under.
 *
 * The one place the literal is written. Two things are composed from it
 * and both have to agree with what a later scan recognises: the
 * per-repository prefix for worktree sessions
 * (`session-backend.ts`, `kirby-<projectKey>-<branch>`) and the
 * terminal-tab names (`terminal/terminal-name.ts`,
 * `kirby-term-<kind>-<id>`).
 */
export const KIRBY_TMUX_PREFIX = 'kirby-';
