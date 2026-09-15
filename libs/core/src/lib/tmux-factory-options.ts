import type { SessionSpec } from '@kirby/terminal';
import type { TmuxFactoryOptions } from '@kirby/terminal-tmux';
import {
  readWorktreeHead,
  type WorktreeHead,
} from './discovery/worktree-origin.js';
import {
  ORCHESTRA_TAG,
  sessionTags,
  worktreeSessionLabel,
} from './session-identity.js';
import {
  resolveTerminalSession,
  resolveWorktreeSession,
} from './session-resolver.js';

/**
 * Kirby's answers to the tmux backend's three questions — what a spec
 * already is, what to call it if it is new, and what to write on it —
 * composed once by the composition root where the repo root is known.
 *
 * A spec is a terminal tab when its launcher said so through
 * `spec.tags` (`@orchestra-session-type` of `shell` or `agent`; see
 * `launchTerminalSession`), and a worktree session otherwise. A
 * worktree session's identity is (repo, branch), the branch read from
 * the spec directory's HEAD file rather than forked from git: the
 * branch checked out *now*, or the directory's name on a detached
 * HEAD, which is also what the session is tagged with. A terminal's
 * identity is its name, which is also its registry key: for a new tab
 * `newTerminalSessionName` chose a free label before spawning, so the
 * label handed to the backend is the name itself and the two agree;
 * for a restored tab discovery hands back the name tmux holds.
 */
export function kirbyTmuxFactoryOptions(
  repoRoot: string,
  deps: { readHead?: (path: string) => WorktreeHead | null } = {}
): TmuxFactoryOptions {
  const readHead = deps.readHead ?? readWorktreeHead;
  const identities = new WeakMap<SessionSpec, SpecIdentity>();
  const identity = (spec: SessionSpec): SpecIdentity => {
    let known = identities.get(spec);
    if (!known) {
      known = identify(spec, readHead);
      identities.set(spec, known);
    }
    return known;
  };
  return {
    resolve: (spec) => {
      const id = identity(spec);
      const found =
        id.type === 'worktree'
          ? resolveWorktreeSession(repoRoot, id.branch)
          : resolveTerminalSession(spec.name);
      return found?.name ?? null;
    },
    label: (spec) => {
      const id = identity(spec);
      return id.type === 'worktree'
        ? worktreeSessionLabel(repoRoot, id.branch)
        : spec.name;
    },
    tags: (spec) => sessionTags(repoRoot, identity(spec)),
  };
}

type SpecIdentity =
  | { type: 'worktree'; branch: string }
  | { type: 'shell' | 'agent' };

function identify(
  spec: SessionSpec,
  readHead: (path: string) => WorktreeHead | null
): SpecIdentity {
  const declared = spec.tags?.[ORCHESTRA_TAG.sessionType];
  if (declared === 'shell' || declared === 'agent') return { type: declared };
  // A HEAD that cannot be read — the directory is not a checkout — is
  // named by the registry key, which is the branch with `/` rewritten
  // and so the branch itself for the common case.
  return { type: 'worktree', branch: readHead(spec.cwd)?.branch ?? spec.name };
}
