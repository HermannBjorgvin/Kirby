import { execFile } from 'node:child_process';
import { branchToSessionName } from '@kirby/worktree-manager';
import { beamKillArgs, beamLsArgs, beamTarget } from '@kirby/terminal-beam';
import { disposeSession } from '../pty-registry.js';
import type { SessionWorkspaces, WorkspaceRow } from './workspaces.js';

// ── Beam-hosted workspaces ───────────────────────────────────────
//
// Sessions that live on a beam host. beam creates the worktree at
// spawn time (the terminal backend passes --repo/--branch), so
// prepare() only computes the path and records the branch for the
// backend's lookups. The inventory comes from `beam ls --json`;
// teardown is one `beam kill --rm-worktree`, which reads the worktree
// off the tmux session and removes both.

interface BeamLsRow {
  remote: string;
  session: string;
  attached: boolean;
  path: string;
  repo: string;
  worktree: string;
  branch: string;
}

function runBeam(args: string[]): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      'beam',
      args,
      { encoding: 'utf8', timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve({ stdout });
      }
    );
  });
}

// The branch each pending spawn was opened for, keyed by session key.
// Written by prepare(), read back by the terminal backend's
// repoFor/branchFor lookups in the same spawn. Never persisted: on a
// reattach after restart the map is empty, the backend omits the
// worktree flags, and beam attaches to the existing session anyway.
const pendingBranches = new Map<string, string>();

export function createBeamWorkspaces(
  host: string,
  repoPath: string,
  sessionPrefix: string
): SessionWorkspaces {
  const repo = repoPath.replace(/\/+$/, '');
  return {
    host,
    async prepare(branch) {
      const key = `${host}:${branchToSessionName(branch)}`;
      pendingBranches.set(key, branch);
      // Must match beam's own derivation: the worktree lives under the
      // repo, named after the session as beam sees it (prefix included).
      return `${repo}/.beam/worktrees/${sessionPrefix}${branchToSessionName(
        branch
      )}`;
    },
    async list() {
      let rows: BeamLsRow[];
      try {
        const { stdout } = await runBeam(beamLsArgs());
        rows = JSON.parse(stdout) as BeamLsRow[];
      } catch {
        // The host being unreachable (VPN down, laptop roaming) must
        // not blank the sidebar — remote rows simply disappear until
        // the next refresh finds the host again.
        return [];
      }
      const out: WorkspaceRow[] = [];
      for (const r of rows) {
        if (r.remote !== host) continue;
        if (!r.session.startsWith(sessionPrefix)) continue;
        const name = `${host}:${r.session.slice(sessionPrefix.length)}`;
        out.push({
          name,
          host,
          ...(r.branch ? { branch: r.branch } : {}),
          ...(r.worktree || r.path ? { cwd: r.worktree || r.path } : {}),
        });
      }
      return out;
    },
    async remove(sessionName) {
      // Drop the local attach first (without killing), then let beam
      // take the session and its worktree down together — the worktree
      // location lives on the tmux session and dies with it, so the
      // kill and the removal must be one beam call.
      disposeSession(sessionName);
      await runBeam(beamKillArgs(beamTarget(sessionName, sessionPrefix), true));
    },
  };
}

/** Lookups the composition root wires into the beam terminal backend. */
export function pendingBranchFor(sessionKey: string): string | undefined {
  return pendingBranches.get(sessionKey);
}
