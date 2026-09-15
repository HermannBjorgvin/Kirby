import type { SessionSpec } from '@kirby/terminal';
import type { TmuxFactoryOptions } from '@kirby/terminal-tmux';
import {
  readWorktreeHead,
  type WorktreeHead,
} from './discovery/worktree-origin.js';
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
 * label is the capped preferred `<repo>-shell|agent`; the collision
 * suffix `newTerminalSessionName` chose for the registry key is the
 * backend's to append again, after the cap, from its own probe of the
 * same server — so a suffixed name is never capped a second time. The
 * registry's own held names travel along as `isTaken`, so both probes
 * skip the same names and the key and the created name agree. That
 * applies to tabs only: a worktree session is keyed by its branch, so
 * a registry key equal to some worktree label says nothing about the
 * label being free.
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
  return {
    resolve: (spec) => {
      const id = identity(spec);
      const found =
        id.type === 'worktree'
          ? resolveWorktreeSession(repoRoot, id.branch)
          : resolveSessionByName(spec.name);
      return found?.name ?? null;
    },
    label: (spec) => {
      const id = identity(spec);
      return id.type === 'worktree'
        ? worktreeSessionLabel(repoRoot, id.branch)
        : terminalSessionLabel(repoRoot, id.type);
    },
    tags: (spec) => sessionTags(repoRoot, identity(spec)),
    isTaken: (name, spec) =>
      identity(spec).type !== 'worktree' && held(name),
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
