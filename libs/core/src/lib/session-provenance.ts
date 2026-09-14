import type { SessionBackendFactory, SessionSpec } from '@kirby/terminal';
import {
  readWorktreeHead,
  type WorktreeHead,
} from './discovery/worktree-origin.js';
import { isQualifiedTmuxName } from './terminal/terminal-name.js';
import { worktreeProvenanceTags } from './tmux-namespace.js';

/**
 * Stamp every worktree session the tmux backend creates with where it
 * came from — the `@orchestra-*` provenance tags in `tmux-namespace.ts`
 * — so Orchestra, and a later Kirby, can describe it from the session
 * alone.
 *
 * Wrapped around the tmux factory by the composition root, which is
 * where the repo root is already known for the prefix; so nothing is
 * forked on the PTY path, and the branch is read from the worktree's
 * HEAD file rather than from git. A qualified name is a session that
 * already exists under its full tmux name — a terminal tab, or an
 * orphaned worktree session being re-attached — which Kirby attaches
 * to rather than creates, so whatever provenance it carries is left as
 * it is. Terminal tabs are out of the convention altogether.
 */
export function withProvenanceTags(
  factory: SessionBackendFactory,
  repoRoot: string,
  deps: { readHead?: (path: string) => WorktreeHead | null } = {}
): SessionBackendFactory {
  const readHead = deps.readHead ?? readWorktreeHead;
  return (spec: SessionSpec) => {
    if (isQualifiedTmuxName(spec.name)) return factory(spec);
    const branch = readHead(spec.cwd)?.branch ?? null;
    return factory({
      ...spec,
      tags: { ...spec.tags, ...worktreeProvenanceTags(repoRoot, branch) },
    });
  };
}
