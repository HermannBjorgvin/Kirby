import { describe, it, expect, afterEach } from 'vitest';
import { assertScratchTmuxSocket } from '../../vitest.setup.js';

/**
 * The guard the live suite leans on. It is the thing standing between a
 * misconfigured run and `tmux kill-session` against the developer's own
 * server, so it gets tested rather than trusted.
 */
const pinned = process.env.TMUX_TMPDIR;

afterEach(() => {
  process.env.TMUX_TMPDIR = pinned;
  delete process.env.TMUX;
});

describe('assertScratchTmuxSocket', () => {
  it('passes on the socket the setup file pinned', () => {
    expect(() => assertScratchTmuxSocket()).not.toThrow();
  });

  // $TMUX names a socket outright and beats TMUX_TMPDIR, so a correct
  // TMUX_TMPDIR is no defence while it is set.
  it('refuses to run while $TMUX names a real session', () => {
    process.env.TMUX = '/tmp/tmux-1000/default,123,0';
    expect(() => assertScratchTmuxSocket()).toThrow(/\$TMUX is set/);
  });

  it('refuses a socket dir that is not the scratch one', () => {
    process.env.TMUX_TMPDIR = '/tmp/somewhere-else';
    expect(() => assertScratchTmuxSocket()).toThrow(/scratch dir/);
  });

  it('refuses an unset socket dir, which would mean the default socket', () => {
    delete process.env.TMUX_TMPDIR;
    expect(() => assertScratchTmuxSocket()).toThrow(/\(unset\)/);
  });
});
