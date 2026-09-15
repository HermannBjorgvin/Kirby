import { execFileSync } from 'node:child_process';

/** Result of running a tmux subcommand. */
export interface TmuxRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Synchronous run of a tmux subcommand. Tmux's control commands
 *  (new-session, kill-session, has-session, -V) all complete in
 *  milliseconds, so blocking is fine — and using execFileSync matches
 *  the pattern used elsewhere in the workspace
 *  (libs/vcs/core/src/lib/config-store.ts) which keeps mocking
 *  straightforward. */
function runTmux(args: string[]): TmuxRunResult {
  try {
    const stdout = execFileSync('tmux', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    const e = err as Error & {
      status?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: string;
    };
    return {
      stdout:
        typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString() ?? '',
      stderr:
        typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '',
      exitCode: typeof e.status === 'number' ? e.status : 1,
    };
  }
}

/** `tmux -V` → "tmux 3.4". Throws if tmux is unavailable (ENOENT). */
export function tmuxVersion(): string {
  return execFileSync('tmux', ['-V'], { encoding: 'utf8' }).trim();
}

/** Hard teardown — kills exactly the named tmux session and all its
 *  panes. Exact, because a prefix match would take out `name-2` once
 *  `name` itself is gone. */
export function tmuxKillSession(name: string): TmuxRunResult {
  return runTmux(['kill-session', '-t', exactSession(name)]);
}

/** Returns true if a session with this name exists. Exact: a bare
 *  `-t name` would also answer for `name-2` while `name` is gone. */
export function tmuxHasSession(name: string): boolean {
  return runTmux(['has-session', '-t', exactSession(name)]).exitCode === 0;
}

/** What `new-session -d` needs besides the name. */
export interface TmuxNewSessionOptions {
  cwd: string;
  cols: number;
  rows: number;
  /** Already-formed `new-session` flags to splice in before the
   *  command — `-e KEY=value` pairs, typically. */
  flags?: readonly string[];
  /** The command half of the argv (`--`, program, args…), or `[]` for
   *  tmux's own `default-shell`. */
  command?: readonly string[];
}

/** Create a session without attaching any client to it (`new-session
 *  -d`). The session exists when this returns, so a caller can write
 *  options on it before anything else can observe it; the client that
 *  will drive it attaches afterwards with {@link tmuxAttachArgs}. A
 *  non-zero exit is returned, not thrown — a caller racing another
 *  creator inspects {@link isDuplicateSession} and tries another name. */
export function tmuxNewSessionDetached(
  name: string,
  opts: TmuxNewSessionOptions
): TmuxRunResult {
  return runTmux([
    'new-session',
    '-d',
    '-s',
    name,
    '-c',
    opts.cwd,
    '-x',
    String(opts.cols),
    '-y',
    String(opts.rows),
    ...(opts.flags ?? []),
    ...(opts.command ?? []),
  ]);
}

/** Whether `new-session` failed because the name was taken in the
 *  moment between a free-name probe and the create — the one failure a
 *  caller answers by trying the next candidate rather than giving up. */
export function isDuplicateSession(result: TmuxRunResult): boolean {
  return result.exitCode !== 0 && /duplicate session/.test(result.stderr);
}

/** The argv of a tmux client that attaches to exactly this session and
 *  nothing else — `=name:` refuses the prefix match a bare `-t` falls
 *  back to (see {@link exactSession}). */
export function tmuxAttachArgs(name: string): string[] {
  return ['attach-session', '-t', exactSession(name)];
}

/** The names a caller tries, in order, for a preferred one: the name
 *  itself, then `name-2`, `name-3`, … A suffix is chosen at creation
 *  only; nothing reconstructs it later, because the name is a label
 *  and whatever identifies the session lives elsewhere. */
export function* sessionNameCandidates(preferred: string): Generator<string> {
  yield preferred;
  for (let n = 2; ; n += 1) yield `${preferred}-${n}`;
}

/** How many candidates a free-name probe tries before giving up: far
 *  more sessions than one server ever holds, but finite, so a probe
 *  whose `isTaken` never says no cannot spin forever. */
const MAX_NAME_CANDIDATES = 10_000;

/** The first of {@link sessionNameCandidates} that is not taken —
 *  by default, not held by the server (`has-session`, one fork per
 *  candidate; the preferred name is usually free, so usually one).
 *  `isTaken` lets a caller fold in names it holds itself. */
export function tmuxFreeSessionName(
  preferred: string,
  isTaken: (name: string) => boolean = tmuxHasSession
): string {
  let tried = 0;
  for (const candidate of sessionNameCandidates(preferred)) {
    if (!isTaken(candidate)) return candidate;
    if ((tried += 1) >= MAX_NAME_CANDIDATES) break;
  }
  throw new Error(`no free tmux session name for ${preferred}`);
}

/** The `-t` argument that names exactly this session. A bare name is
 *  matched by prefix when no session has it exactly, so with `feature`
 *  and `feature-2` both live, `-t feature` after `feature` is gone
 *  quietly lands on the other one; `=name:` refuses anything but an
 *  exact match. The `=` form arrived in tmux 2.1, so it — not the
 *  probe's 2.0 — is the effective floor for options. */
function exactSession(name: string): string {
  return `=${name}:`;
}

/** Set a session option — a built-in one (`status off`) or a user
 *  option (`@key value`), which is how a caller attaches metadata to
 *  the session for other clients of the server to read. */
export function tmuxSetOption(
  name: string,
  option: string,
  value: string
): TmuxRunResult {
  return runTmux(['set-option', '-t', exactSession(name), option, value]);
}

/** tmux decides from `LANG`/`LC_CTYPE`/`LC_ALL` whether its client is
 *  UTF-8 and, when it is not, rewrites control characters in what it
 *  prints — the tab between listing columns, a newline in a value — to
 *  `_`. `-u` declares the client UTF-8 whatever the locale says, so
 *  every command whose output is parsed carries it. */
const UTF8 = '-u';

/** The value of one session option, or `''` when it is unset (`-q`
 *  makes that a silent, zero exit), the session is not there, or
 *  there is no server. Only the line terminator is dropped: the value
 *  is the caller's, spaces and all. */
export function tmuxShowOption(name: string, option: string): string {
  const { stdout, exitCode } = runTmux([
    UTF8,
    'show-options',
    '-qv',
    '-t',
    exactSession(name),
    option,
  ]);
  return exitCode === 0 ? stdout.replace(/\r?\n$/, '') : '';
}

/** One live session: its name and the directory it was started in. */
export interface TmuxSessionInfo {
  name: string;
  /** `#{session_created}` — seconds since the epoch, tmux's own clock.
   *  Orders two sessions that claim the same identity: the older one
   *  is the one that was there first. `0` when tmux reports nothing
   *  parseable. */
  created: number;
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
 *  and `#{session_path}` predates the 2.0 floor the backend supports.
 *
 *  `options` names session user options (`@key`) to read in the same
 *  fork; each becomes a `#{@key}` column. Tab-separated with the name
 *  first, the creation time second, the options next and the path
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

/** The columns before the path: name, creation time, one per option. */
const FIXED_COLUMNS = 2;

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
  if (options.length === 0) return { name, created, path };
  const values: Record<string, string> = {};
  options.forEach((option, i) => {
    const value = fields[i + FIXED_COLUMNS];
    if (value) values[option] = value;
  });
  return { name, created, path, options: values };
}

/** Every session name the server currently holds — see
 *  {@link tmuxListSessionsDetailed}, which this reads through so a
 *  caller wanting only names pays the same single fork. */
export function tmuxListSessions(): string[] {
  return tmuxListSessionsDetailed().map((s) => s.name);
}
