import { describe, expect, it, vi } from 'vitest';
import type { SessionBackend, SessionSpec } from '@kirby/terminal';
import { withProvenanceTags } from './session-provenance.js';
import type { WorktreeHead } from './discovery/worktree-origin.js';

/**
 * Every worktree session Kirby creates under tmux says where it came
 * from — in the session's own user options, the same tags Orchestra
 * writes on the sessions it spawns, so either program can describe the
 * other's. The composition root wraps the tmux factory with this; the
 * branch is read from the worktree's HEAD file, not forked from git.
 */

const BACKEND = {} as SessionBackend;

function spec(overrides: Partial<SessionSpec> = {}): SessionSpec {
  return {
    name: 'feature-x',
    cmd: '/bin/sh',
    args: ['-c', 'claude'],
    cwd: '/repo/.claude/worktrees/feature-x',
    cols: 80,
    rows: 24,
    ...overrides,
  };
}

function wrap(head: (path: string) => WorktreeHead | null) {
  const inner = vi.fn<(s: SessionSpec) => SessionBackend>(() => BACKEND);
  const factory = withProvenanceTags(inner, '/repo', { readHead: head });
  return { inner, factory, spec: () => inner.mock.calls[0]![0] };
}

const onBranch = (path: string): WorktreeHead => ({
  branch: `feature/${path.split('/').pop()!.slice(8)}`,
  detached: false,
});

describe('withProvenanceTags', () => {
  it('tags a worktree session with the spawner, the repo root and the unsanitized branch', () => {
    const w = wrap(onBranch);
    expect(w.factory(spec())).toBe(BACKEND);
    expect(w.spec().tags).toEqual({
      '@orchestra-spawner': 'kirby',
      '@orchestra-repo': '/repo',
      '@orchestra-branch': 'feature/x',
    });
  });

  it('reads the branch at the session directory', () => {
    const head = vi.fn(onBranch);
    const w = wrap(head);
    w.factory(spec({ cwd: '/repo/.claude/worktrees/feature-y' }));
    expect(head).toHaveBeenCalledWith('/repo/.claude/worktrees/feature-y');
    expect(w.spec().tags?.['@orchestra-branch']).toBe('feature/y');
  });

  // A detached HEAD has no branch; the directory's name is what the
  // session is named after, and what the tag says.
  it('uses the directory name a detached worktree is named after', () => {
    const w = wrap((path) => ({
      branch: path.split('/').pop()!,
      detached: true,
    }));
    w.factory(spec({ cwd: '/repo/.claude/worktrees/hotfix-dir' }));
    expect(w.spec().tags?.['@orchestra-branch']).toBe('hotfix-dir');
  });

  // Provenance is written by whichever program *creates* a session. A
  // qualified name is one that already exists under its full tmux name
  // — a terminal tab, or an orphaned worktree session being re-attached
  // — so Kirby is attaching, not creating, and leaves what is there.
  it.each([
    ['a terminal tab', 'kirby-term-shell-1a2b3c'],
    ['an orphaned worktree session', 'kirby-0123456789abcdef-old-branch'],
  ])('leaves %s untagged', (_label, name) => {
    const head = vi.fn(onBranch);
    const w = wrap(head);
    w.factory(spec({ name }));
    expect(w.spec().tags).toBeUndefined();
    expect(head).not.toHaveBeenCalled();
  });

  it('still says who spawned it and where when the branch cannot be read', () => {
    const w = wrap(() => null);
    w.factory(spec());
    expect(w.spec().tags).toEqual({
      '@orchestra-spawner': 'kirby',
      '@orchestra-repo': '/repo',
    });
  });

  it('keeps the tags a caller set and everything else about the spec', () => {
    const w = wrap(onBranch);
    const original = spec({
      tags: { '@custom': '1' },
      envAdditions: { A: 'b' },
    });
    w.factory(original);
    expect(w.spec()).toEqual({
      ...original,
      tags: { ...original.tags, ...w.spec().tags },
    });
    expect(w.spec().tags?.['@custom']).toBe('1');
    expect(original.tags).toEqual({ '@custom': '1' });
  });
});
