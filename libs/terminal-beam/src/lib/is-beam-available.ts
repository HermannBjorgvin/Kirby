import { execFile } from 'node:child_process';

export interface BeamStatus {
  available: boolean;
  /** Names of the machines registered with beam, from `beam remote ls`. */
  remotes: string[];
  reason?: string;
  installHint?: string;
}

/**
 * Machine names out of the `beam remote ls` table: skip the header,
 * take the first column. The no-remotes case prints a sentence, not a
 * table, and yields an empty list.
 */
export function parseRemoteLs(stdout: string): string[] {
  const lines = stdout.trimEnd().split('\n');
  if (lines.length === 0 || lines[0]?.startsWith('no remotes')) return [];
  return lines
    .slice(1)
    .map((line) => line.split(/\s+/)[0] ?? '')
    .filter(Boolean);
}

const INSTALL_HINT =
  'install beam and put it on PATH (bun link in the beam checkout)';

function probe(): Promise<BeamStatus> {
  return new Promise((resolve) => {
    execFile(
      'beam',
      ['remote', 'ls'],
      { encoding: 'utf8', timeout: 5000 },
      (error, stdout) => {
        if (error) {
          const notFound = (error as NodeJS.ErrnoException).code === 'ENOENT';
          resolve({
            available: false,
            remotes: [],
            reason: notFound ? 'beam is not installed' : error.message,
            ...(notFound ? { installHint: INSTALL_HINT } : {}),
          });
          return;
        }
        resolve({ available: true, remotes: parseRemoteLs(stdout) });
      }
    );
  });
}

let memo: Promise<BeamStatus> | null = null;

/** Probe once per process; the Settings guard reads the cached result
 *  synchronously via the composition root, like the tmux probe. */
export function isBeamAvailable(): Promise<BeamStatus> {
  if (!memo) memo = probe();
  return memo;
}
