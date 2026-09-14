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

/**
 * The session user options ("tags") Kirby shares with Orchestra.
 *
 * Both programs create and inspect `kirby-<projectKey>-<branch>`
 * sessions, and everything either one records about a session lives on
 * the session itself, as a tmux user option: set with `set-option -t
 * '=<name>:' @orchestra-x value`, read in a format string as
 * `#{@orchestra-x}`. A tag dies with its session and needs no file.
 * Values are plain strings without tabs (listings are tab-separated);
 * an absent tag is *unset*, never a sentinel.
 *
 * The provenance tags are written by whichever program creates the
 * session, so the other can describe it without git:
 *
 * - `spawner`: `kirby` ({@link KIRBY_SPAWNER}) or `orchestra`.
 * - `repo`: the absolute, symlink-resolved path of the main checkout —
 *   what `git rev-parse --show-toplevel` prints there, the string the
 *   session's `projectKey` is computed from.
 * - `branch`: the branch the session was spawned under, unsanitized
 *   (`feature/x`); a detached-HEAD worktree's directory name.
 *
 * The rest are Orchestra's, read by Kirby when present: `agent` is the
 * harness in the pane (`claude`, `codex`, …), `orchestrator` the
 * player's reporting target (`codex:<id>` or `tmux:<session>`), and
 * `lastReport` is `<KIND> <ISO-8601 UTC>` of the last report the
 * player delivered.
 */
export const ORCHESTRA_TAG = {
  spawner: '@orchestra-spawner',
  repo: '@orchestra-repo',
  branch: '@orchestra-branch',
  agent: '@orchestra-agent',
  orchestrator: '@orchestra-orchestrator',
  lastReport: '@orchestra-last-report',
} as const;

/** What Kirby writes as `@orchestra-spawner` on the sessions it creates. */
export const KIRBY_SPAWNER = 'kirby';

/** The provenance tags for a worktree session Kirby spawns. `branch` is
 *  left off when it is not known: half a provenance is still worth
 *  having, and a reader treats the missing half as "ask git". */
export function worktreeProvenanceTags(
  repoRoot: string,
  branch: string | null
): Record<string, string> {
  return {
    [ORCHESTRA_TAG.spawner]: KIRBY_SPAWNER,
    [ORCHESTRA_TAG.repo]: repoRoot,
    ...(branch === null ? {} : { [ORCHESTRA_TAG.branch]: branch }),
  };
}
