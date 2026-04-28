import { tmuxVersion } from './tmux-cli.js';

export interface TmuxStatus {
  available: boolean;
  /** Reported by `tmux -V` — e.g. "3.4" or "next-3.5". Undefined if
   *  the binary couldn't be invoked. */
  version?: string;
  /** Why availability failed. Undefined when `available === true`. */
  reason?: string;
  /** Platform-specific suggestion shown to the user when tmux is
   *  missing. Undefined when `available === true`. */
  installHint?: string;
}

const MIN_MAJOR = 2;

let memoized: Promise<TmuxStatus> | null = null;

function installHintForPlatform(): string {
  switch (process.platform) {
    case 'darwin':
      return 'brew install tmux';
    case 'linux':
      return 'sudo apt install tmux  # or your distro equivalent';
    default:
      return 'See https://github.com/tmux/tmux/wiki/Installing';
  }
}

/** Parse "tmux 3.4" or "tmux next-3.5" → "3.4" / "3.5". */
function parseVersion(raw: string): { full: string; major: number } | null {
  const match = /tmux(?:\s+next-)?\s*([0-9]+(?:\.[0-9]+)?)/.exec(raw);
  if (!match) return null;
  const full = match[1]!;
  const major = Number.parseInt(full.split('.')[0]!, 10);
  if (Number.isNaN(major)) return null;
  return { full, major };
}

async function probe(): Promise<TmuxStatus> {
  let raw: string;
  try {
    raw = tmuxVersion();
  } catch {
    return {
      available: false,
      reason: 'tmux binary not found on PATH',
      installHint: installHintForPlatform(),
    };
  }
  const parsed = parseVersion(raw);
  if (!parsed) {
    return {
      available: false,
      reason: `unexpected output from \`tmux -V\`: ${raw}`,
      installHint: installHintForPlatform(),
    };
  }
  if (parsed.major < MIN_MAJOR) {
    return {
      available: false,
      version: parsed.full,
      reason: `tmux ${parsed.full} is too old; need ≥ ${MIN_MAJOR}.0`,
      installHint: installHintForPlatform(),
    };
  }
  return { available: true, version: parsed.full };
}

/** Memoized one-shot probe. The result is cached for the process
 *  lifetime — if the user installs tmux mid-session they need to
 *  restart Kirby for the change to take effect. */
export function isTmuxAvailable(): Promise<TmuxStatus> {
  if (!memoized) memoized = probe();
  return memoized;
}

/** Test-only reset. Not exported from the package. */
export function __resetForTests(): void {
  memoized = null;
}
