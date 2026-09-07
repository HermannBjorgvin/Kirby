import { describe, expect, it } from 'vitest';
import { sanitizeTmuxSessionName } from '@kirby/terminal-tmux';
import {
  isQualifiedTmuxName,
  newTerminalSessionName,
  parseTerminalSessionName,
} from './terminal-name.js';

/**
 * A terminal session's identity lives entirely in its tmux name — there
 * is no state file — so the name has to say what kind it is, survive
 * tmux's own rewriting, and never be mistaken for a worktree session.
 */
describe('terminal session names', () => {
  it('round-trips the kind through the name', () => {
    for (const kind of ['shell', 'agent'] as const) {
      const name = newTerminalSessionName(kind);
      expect(parseTerminalSessionName(name)).toEqual({
        kind,
        id: expect.stringMatching(/^[0-9a-f]{6,}$/) as string,
      });
    }
  });

  // Several terminals per directory are allowed, and the directory is
  // not part of the name — so the id is the only thing telling two
  // shells in the same folder apart.
  it('gives every terminal its own name', () => {
    const names = new Set(
      Array.from({ length: 50 }, () => newTerminalSessionName('shell'))
    );
    expect(names.size).toBe(50);
  });

  // The backend sanitizes every name before tmux sees it (`.` and `:`
  // replaced, long names truncated and hashed). A name that came back
  // different would not parse, and the terminal would vanish on the
  // next launch.
  it('survives the tmux sanitizer unchanged', () => {
    const name = newTerminalSessionName('agent');
    expect(sanitizeTmuxSessionName(name)).toBe(name);
  });

  it('is not fooled by worktree sessions or the user’s own sessions', () => {
    expect(parseTerminalSessionName('kirby-0123456789abcdef-main')).toBeNull();
    expect(parseTerminalSessionName('kirby-term-shell')).toBeNull();
    expect(parseTerminalSessionName('kirby-term-editor-abc123')).toBeNull();
    expect(parseTerminalSessionName('dotfiles')).toBeNull();
    // A worktree branch that happens to be called this is a branch, and
    // its tmux name carries the project hash in front.
    expect(parseTerminalSessionName('term-shell-abc123')).toBeNull();
  });
});

/**
 * The tmux factory prefixes registry names with the repository's
 * namespace. A terminal name is complete already, and so is a fully
 * composed worktree name being re-attached as an orphan — prefixing
 * either would spawn a second session beside the one meant to be
 * resumed.
 */
describe('isQualifiedTmuxName', () => {
  it('accepts terminal names and composed worktree names', () => {
    expect(isQualifiedTmuxName(newTerminalSessionName('shell'))).toBe(true);
    expect(isQualifiedTmuxName('kirby-0123456789abcdef-feature-x')).toBe(true);
  });

  // The registry keys worktree sessions by bare branch name, and a
  // branch may be called anything — including something that starts
  // with the namespace. Only the two exact shapes count.
  it('rejects a branch whose name merely starts with the namespace', () => {
    expect(isQualifiedTmuxName('kirby-fix')).toBe(false);
    expect(isQualifiedTmuxName('kirby-term')).toBe(false);
    expect(isQualifiedTmuxName('kirby-abc-feature')).toBe(false);
    expect(isQualifiedTmuxName('feature-x')).toBe(false);
  });
});
