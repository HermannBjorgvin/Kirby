import { runTmux } from './tmux-cli.js';

export interface TmuxPaneState {
  paneDead: boolean;
  exitCode?: number;
  exitSignal?: number;
}

function optionalNumber(value: string | undefined): number | undefined {
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
}

function parsePaneState(fields: string[]): TmuxPaneState {
  const exitCode = optionalNumber(fields[1]);
  const exitSignal = optionalNumber(fields[2]);
  return {
    paneDead: fields[0] === '1',
    ...(exitCode == null ? {} : { exitCode }),
    ...(exitSignal == null ? {} : { exitSignal }),
  };
}

/** Null means the session/pane no longer exists. */
export function tmuxPaneState(name: string): TmuxPaneState | null {
  const result = runTmux([
    '-u',
    'display-message',
    '-p',
    '-t',
    `=${name}:`,
    '#{pane_id}\t#{pane_dead}\t#{pane_dead_status}\t#{pane_dead_signal}',
  ]);
  const fields = result.stdout.trimEnd().split('\t');
  // display-message may succeed with empty output for a vanished target.
  // Require an actual pane identity and explicit native liveness state.
  if (
    result.exitCode !== 0 ||
    !/^%\d+$/.test(fields[0] ?? '') ||
    !['0', '1'].includes(fields[1] ?? '')
  )
    return null;
  return parsePaneState(fields.slice(1));
}

const UTF8 = '-u';

/** One live session: its name and the directory it was started in. */
export interface TmuxSessionInfo {
  name: string;
  /** `#{session_created}` — seconds since the epoch, tmux's own clock.
   *  Orders two sessions that claim the same identity: the older one
   *  is the one that was there first. `0` when tmux reports nothing
   *  parseable. */
  created: number;
  /** Active pane lifecycle, independent of whether clients are attached. */
  paneDead: boolean;
  exitCode?: number;
  exitSignal?: number;
  /** `#{session_path}` — the `-c` directory `new-session` was given,
   *  or the server's cwd when it was not. Empty when tmux reports
   *  nothing. */
  path: string;
  /** The session user options {@link tmuxListSessionsDetailed} was
   *  asked for, by name, for those that have a value. An unset option
   *  expands to nothing in a format string, which is indistinguishable
   *  from one set to `''`, so both are left out. Absent when no option
   *  names were asked for. */
  options?: Record<string, string>;
}

/** Every session the server currently holds, with the directory each
 *  was started in, or `[]` when there is no server at all
 *  (`list-sessions` exits non-zero with "no server running").
 *
 *  One fork regardless of how many sessions exist, which is the whole
 *  reason it exists next to {@link tmuxHasSession}: a caller checking
 *  N candidates pays N forks through `has-session` and one through
 *  this. `#{session_name}` is the oldest of tmux's format variables
 *  and all requested native fields are available in the supported tmux versions.
 *
 *  `options` names session user options (`@key`) to read in the same
 *  fork; each becomes a `#{@key}` column. Tab-separated with the name
 *  first, the creation time and pane lifecycle next, then options and the path
 *  last: a session name never carries a tab (the sanitizer only
 *  rewrites `.` and `:`, and nothing composes one with a tab), an
 *  option value is the caller's to keep tab-free, and the path may
 *  contain anything — so the first columns are split off one tab at a
 *  time and whatever remains, tabs included, is the path. */
export function tmuxListSessionsDetailed(
  options: readonly string[] = []
): TmuxSessionInfo[] {
  const columns = [
    '#{session_name}',
    '#{session_created}',
    '#{pane_dead}',
    '#{pane_dead_status}',
    '#{pane_dead_signal}',
    ...options.map((option) => `#{${option}}`),
    '#{session_path}',
  ];
  const { stdout, exitCode } = runTmux([
    UTF8,
    'list-sessions',
    '-F',
    columns.join('\t'),
  ]);
  if (exitCode !== 0) return [];
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseSessionLine(line, options));
}

/** Native columns before the optional user tags and final path. */
const FIXED_COLUMNS = 5;

/** One `list-sessions` line back into a session: the leading columns
 *  are the name, the creation time and the asked-for options; the
 *  remainder is the path. */
function parseSessionLine(
  line: string,
  options: readonly string[]
): TmuxSessionInfo {
  const leading = FIXED_COLUMNS + options.length;
  const fields = line.split('\t', leading);
  const rest = fields.join('\t').length;
  const name = fields[0] ?? line;
  const created = Number.parseInt(fields[1] ?? '', 10) || 0;
  const path = fields.length >= leading ? line.slice(rest + 1) : '';
  const state = parsePaneState(fields.slice(2, 5));
  if (options.length === 0) return { name, created, path, ...state };
  const values: Record<string, string> = {};
  options.forEach((option, i) => {
    const value = fields[i + FIXED_COLUMNS];
    if (value) values[option] = value;
  });
  return { name, created, path, ...state, options: values };
}
