import type { SessionSpec } from '@kirby/terminal';
import type { TmuxFactoryOptions } from '@kirby/terminal-tmux';
import {
  readWorktreeHead,
  type WorktreeHead,
} from './discovery/worktree-origin.js';
import { sessionIdentity, terminalSessionKey } from './session-key.js';
import { hasSession } from './pty-registry.js';
import {
  ORCHESTRA_TAG,
  sessionTags,
  terminalSessionLabel,
  worktreeSessionLabel,
} from './session-identity.js';
import {
  resolveSessionByName,
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
 * identity is its name, which is also its registry key, matched among
 * our tagged sessions whatever their type or repository — a tab is
 * process-global and outlives a repository switch: a restored tab is the
 * `shell`/`agent` session discovery listed, and an orphaned worktree
 * session adopted as an agent tab keeps its `worktree` tag but is
 * attached by exactly the name tmux holds it under. For a new tab the
 * label is the capped preferred `<repo>-shell|agent`. The backend
 * allocates the final name and core encodes it in a terminal key.
 * The registry's held names travel as `isTaken` so a new tab cannot
 * displace a local entry. Worktree keys include the repository and exact branch.
 */
export function kirbyTmuxFactoryOptions(
  repoRoot: string,
  deps: {
    readHead?: (path: string) => WorktreeHead | null;
    hasSession?: (name: string) => boolean;
  } = {}
): TmuxFactoryOptions {
  const readHead = deps.readHead ?? readWorktreeHead;
  const held = deps.hasSession ?? hasSession;
  const identities = new WeakMap<SessionSpec, SpecIdentity>();
  const identity = (spec: SessionSpec): SpecIdentity => {
    let known = identities.get(spec);
    if (!known) {
      known = identify(spec, readHead);
      identities.set(spec, known);
    }
    return known;
  };
  const repoOf = (spec: SessionSpec) => {
    const key = sessionIdentity(spec.name);
    return key?.kind === 'worktree' ? key.repo : repoRoot;
  };
  return {
    resolve: (spec) => {
      const id = identity(spec);
      const key = sessionIdentity(spec.name);
      const found =
        id.type === 'worktree'
          ? resolveWorktreeSession(repoOf(spec), id.branch)
          : key?.kind === 'terminal'
          ? resolveSessionByName(key.id)
          : null;
      return found?.name ?? null;
    },
    label: (spec) => {
      const id = identity(spec);
      return id.type === 'worktree'
        ? worktreeSessionLabel(repoOf(spec), id.branch)
        : terminalSessionLabel(repoRoot, id.type);
    },
    tags: (spec) => sessionTags(repoOf(spec), identity(spec)),
    isTaken: (name, spec) =>
      identity(spec).type !== 'worktree' && held(terminalSessionKey(name)),
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
  // A qualified worktree key retains the exact branch even if HEAD cannot be read.
  const key = sessionIdentity(spec.name);
  return {
    type: 'worktree',
    branch:
      readHead(spec.cwd)?.branch ??
      (key?.kind === 'worktree' ? key.branch : spec.name),
  };
}
