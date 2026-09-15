import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionSpec } from '@kirby/terminal';
import type * as TmuxCli from './tmux-cli.js';
import type { TmuxRunResult } from './tmux-cli.js';

/**
 * The backend at the tmux boundary, with the CLI mocked: every call it
 * makes is recorded in order, so a test can say not only what was run
 * but what ran before what — the tags before the client, the probe
 * before the create — which is the whole contract.
 */

const {
  calls,
  ptySpawnArgs,
  disposeSpy,
  writeSpy,
  resizeSpy,
  onDataSpy,
  onExitSpy,
  offDataSpy,
  offExitSpy,
  taken,
  newSessionResults,
  MockPtySession,
} = vi.hoisted(() => {
  /** Every tmux call and PTY spawn, in the order it happened. */
  const calls: string[] = [];
  const ptySpawnArgs: {
    cmd: string;
    args: string[];
    opts: Record<string, unknown>;
  }[] = [];
  const disposeSpy = vi.fn();
  const writeSpy = vi.fn();
  const resizeSpy = vi.fn();
  const onDataSpy = vi.fn();
  const onExitSpy = vi.fn();
  const offDataSpy = vi.fn();
  const offExitSpy = vi.fn();
  /** Names `has-session` answers yes for. */
  const taken = new Set<string>();
  /** Scripted `new-session` outcomes by name; unlisted names succeed. */
  const newSessionResults = new Map<string, TmuxRunResult>();
  class MockPtySession {
    pid = 1234;
    cols: number;
    rows: number;
    constructor(cmd: string, args: string[], opts: Record<string, unknown>) {
      calls.push(`pty ${cmd} ${args.join(' ')}`);
      ptySpawnArgs.push({ cmd, args, opts });
      this.cols = (opts['cols'] as number) ?? 80;
      this.rows = (opts['rows'] as number) ?? 24;
    }
    write = writeSpy;
    resize = resizeSpy;
    onData = onDataSpy;
    offData = offDataSpy;
    onExit = onExitSpy;
    offExit = offExitSpy;
    dispose = disposeSpy;
    kill = vi.fn();
  }
  return {
    calls,
    ptySpawnArgs,
    disposeSpy,
    writeSpy,
    resizeSpy,
    onDataSpy,
    onExitSpy,
    offDataSpy,
    offExitSpy,
    taken,
    newSessionResults,
    MockPtySession,
  };
});

vi.mock('@kirby/terminal-pty', () => ({ PtySession: MockPtySession }));
vi.mock('./tmux-cli.js', async (importOriginal) => {
  const actual = await importOriginal<typeof TmuxCli>();
  const ok: TmuxRunResult = { stdout: '', stderr: '', exitCode: 0 };
  return {
    ...actual,
    tmuxKillSession: (name: string) => {
      calls.push(`kill-session ${name}`);
      return ok;
    },
    tmuxHasSession: (name: string) => {
      calls.push(`has-session ${name}`);
      return taken.has(name);
    },
    tmuxSetOption: (name: string, option: string, value: string) => {
      calls.push(`set-option ${name} ${option} ${value}`);
      return ok;
    },
    tmuxNewSessionDetached: (
      name: string,
      opts: { cwd: string; cols: number; rows: number; command?: string[] }
    ) => {
      calls.push(
        `new-session ${name} -c ${opts.cwd} -x ${opts.cols} -y ${opts.rows}` +
          (opts.command?.length ? ` ${opts.command.join(' ')}` : '')
      );
      const result = newSessionResults.get(name);
      if (result) return result;
      taken.add(name);
      return ok;
    },
    // Below 3.2 so the `-e` session-env flags stay off and the exact
    // argv assertions in this file remain stable. (The -e behavior is
    // covered by the live spec against a real tmux.)
    tmuxVersion: () => 'tmux 3.1',
  };
});

import {
  createTmuxBackendFactory,
  type TmuxFactoryOptions,
} from './tmux-backend.js';

function spec(overrides: Partial<SessionSpec> = {}): SessionSpec {
  return {
    name: 'feature-foo',
    cmd: '/bin/sh',
    args: ['-c', 'claude'],
    cwd: '/tmp/work',
    cols: 100,
    rows: 30,
    ...overrides,
  };
}

/** A factory whose identity rules are the test's: nothing resolves
 *  unless said so, the label is the spec's name, and the tags are
 *  whatever the test hands over. */
function factory(overrides: Partial<TmuxFactoryOptions> = {}) {
  return createTmuxBackendFactory({
    resolve: () => null,
    label: (s) => s.name,
    tags: () => ({}),
    ...overrides,
  });
}

const DUPLICATE: TmuxRunResult = {
  stdout: '',
  stderr: 'duplicate session: feature-foo\n',
  exitCode: 1,
};

beforeEach(() => {
  calls.length = 0;
  ptySpawnArgs.length = 0;
  taken.clear();
  newSessionResults.clear();
  disposeSpy.mockReset();
  writeSpy.mockReset();
  resizeSpy.mockReset();
  onDataSpy.mockReset();
  onExitSpy.mockReset();
  offDataSpy.mockReset();
  offExitSpy.mockReset();
});

describe('createTmuxBackendFactory', () => {
  describe('a session the caller resolves', () => {
    it('attaches to exactly that name and creates nothing', () => {
      const tags = vi.fn(() => ({ '@a': 'v' }));
      factory({ resolve: () => 'repo-feature-foo-2', tags })(spec());
      expect(calls).toEqual([
        'set-option repo-feature-foo-2 status off',
        'pty tmux attach-session -t =repo-feature-foo-2:',
      ]);
      // Tags describe a session's creation; an attach writes none and
      // does not even ask for them.
      expect(tags).not.toHaveBeenCalled();
    });

    it('kills that name, not the label, on kill()', () => {
      const backend = factory({ resolve: () => 'other-name' })(spec());
      backend.kill();
      expect(calls).toContain('kill-session other-name');
      expect(calls).not.toContain('kill-session feature-foo');
    });
  });

  describe('a session the caller does not resolve', () => {
    it('creates it detached, tags it, and only then attaches a client', () => {
      factory({ tags: () => ({ '@x-repo': '/repo', '@x-branch': 'f/x' }) })(
        spec()
      );
      expect(calls).toEqual([
        'has-session feature-foo',
        'new-session feature-foo -c /tmp/work -x 100 -y 30 -- /bin/sh -c claude',
        'set-option feature-foo @x-repo /repo',
        'set-option feature-foo @x-branch f/x',
        'set-option feature-foo status off',
        'pty tmux attach-session -t =feature-foo:',
      ]);
    });

    // The caller may hold names the server no longer does (a registry
    // entry outliving its session); those are skipped like server-held
    // ones, so the caller's key and the created name agree.
    it('skips candidates the caller reports as taken', () => {
      const backend = factory({ isTaken: (n) => n === 'feature-foo' })(spec());
      expect(calls.filter((c) => c.startsWith('new-session'))).toEqual([
        'new-session feature-foo-2 -c /tmp/work -x 100 -y 30 -- /bin/sh -c claude',
      ]);
      expect(calls).not.toContain('has-session feature-foo');
      backend.kill();
      expect(calls).toContain('kill-session feature-foo-2');
    });

    it('sanitizes the label to tmux rules before using it', () => {
      factory({ label: () => 'release/v1.0.1' })(spec());
      expect(calls[1]).toMatch(/^new-session release\/v1-0-1 /);
      expect(calls.at(-1)).toBe('pty tmux attach-session -t =release/v1-0-1:');
    });

    // The label is a wish, not an identity. A session that holds it and
    // was not resolved is somebody else's: it is neither attached to
    // nor touched, and the next free suffix is taken instead.
    it('leaves a foreign session holding the label alone and takes the next suffix', () => {
      taken.add('feature-foo');
      taken.add('feature-foo-2');
      const backend = factory()(spec());
      expect(calls.filter((c) => c.startsWith('new-session'))).toEqual([
        'new-session feature-foo-3 -c /tmp/work -x 100 -y 30 -- /bin/sh -c claude',
      ]);
      expect(calls.at(-1)).toBe('pty tmux attach-session -t =feature-foo-3:');
      expect(calls).not.toContain('set-option feature-foo status off');
      backend.kill();
      expect(calls).toContain('kill-session feature-foo-3');
      expect(calls).not.toContain('kill-session feature-foo');
    });

    // Between the probe and the create another creator can take the
    // name. tmux says so, and the answer is the next candidate — not a
    // second session under a name that is now someone else's.
    it('moves to the next suffix when the create loses a race for the name', () => {
      newSessionResults.set('feature-foo', DUPLICATE);
      factory()(spec());
      expect(calls.filter((c) => c.startsWith('new-session'))).toEqual([
        'new-session feature-foo -c /tmp/work -x 100 -y 30 -- /bin/sh -c claude',
        'new-session feature-foo-2 -c /tmp/work -x 100 -y 30 -- /bin/sh -c claude',
      ]);
      expect(calls.at(-1)).toBe('pty tmux attach-session -t =feature-foo-2:');
    });

    // Two creators racing for the same label: the first loses `label`,
    // the second loses `label-2`. Probing continues from the original
    // label, so the answer is `label-3` — never `label-2-2`.
    it('keeps probing from the original label after losing a second race', () => {
      newSessionResults.set('feature-foo', DUPLICATE);
      newSessionResults.set('feature-foo-2', DUPLICATE);
      factory()(spec());
      expect(
        calls
          .filter((c) => c.startsWith('new-session'))
          .map((c) => c.split(' ')[1])
      ).toEqual(['feature-foo', 'feature-foo-2', 'feature-foo-3']);
      expect(calls.at(-1)).toBe('pty tmux attach-session -t =feature-foo-3:');
    });

    // The suffix goes on after the 200-character cap, and the result is
    // not capped or hashed again: a capped label plus `-2` is 202
    // characters, and that is the name.
    it('appends the suffix after the cap without re-capping', () => {
      const capped = `${'x'.repeat(195)}-abcd`;
      taken.add(capped);
      factory({ label: () => capped })(spec());
      expect(calls.at(-1)).toBe(`pty tmux attach-session -t =${capped}-2:`);
      expect(`${capped}-2`).toHaveLength(202);
    });

    it('throws, and attaches nothing, when tmux refuses to create for any other reason', () => {
      newSessionResults.set('feature-foo', {
        stdout: '',
        stderr: 'error connecting to /tmp/tmux-1000/default\n',
        exitCode: 1,
      });
      expect(() => factory()(spec())).toThrow(/error connecting/);
      expect(ptySpawnArgs).toEqual([]);
    });

    it('passes cmd and args after the `--` separator', () => {
      factory()(spec({ cmd: '/bin/sh', args: ['-c', 'claude --continue'] }));
      expect(calls[1]).toBe(
        'new-session feature-foo -c /tmp/work -x 100 -y 30 -- /bin/sh -c claude --continue'
      );
    });

    // A terminal tab wants whatever the user's shell is, and tmux
    // already knows: `new-session` with no command runs its
    // `default-shell`. So an empty `cmd` must end the argv at the flags
    // — appending `--` and an empty string would ask tmux to exec ""
    // and fail on the spot.
    it("runs tmux's default shell when cmd is empty, with no `--` at all", () => {
      factory()(spec({ cmd: '', args: [] }));
      expect(calls[1]).toBe(
        'new-session feature-foo -c /tmp/work -x 100 -y 30'
      );
    });
  });

  it('sizes the local PTY from the spec and runs the client in cwd', () => {
    factory()(spec({ cols: 120, rows: 40 }));
    const { cmd, args, opts } = ptySpawnArgs[0]!;
    expect(cmd).toBe('tmux');
    expect(args).toEqual(['attach-session', '-t', '=feature-foo:']);
    expect(opts['cwd']).toBe('/tmp/work');
    expect(opts['cols']).toBe(120);
    expect(opts['rows']).toBe(40);
  });

  // Kirby itself may run inside tmux; the client must not inherit that
  // or it refuses to nest.
  it('starts the client without TMUX in its environment', () => {
    factory()(spec({ env: { TMUX: '/tmp/tmux-1/default,1,0', PATH: '/bin' } }));
    const env = ptySpawnArgs[0]!.opts['env'] as Record<string, string>;
    expect(env).not.toHaveProperty('TMUX');
    expect(env['PATH']).toBe('/bin');
  });

  it('forwards write/resize/onData/onExit to the inner PtySession', () => {
    const backend = factory()(spec());
    backend.write('hello');
    backend.resize(90, 25);
    const dataCb = () => undefined;
    const exitCb = () => undefined;
    backend.onData(dataCb);
    backend.onExit(exitCb);
    backend.offData(dataCb);
    backend.offExit(exitCb);
    expect(writeSpy).toHaveBeenCalledWith('hello');
    expect(resizeSpy).toHaveBeenCalledWith(90, 25);
    expect(onDataSpy).toHaveBeenCalledWith(dataCb);
    expect(onExitSpy).toHaveBeenCalledWith(exitCb);
    expect(offDataSpy).toHaveBeenCalledWith(dataCb);
    expect(offExitSpy).toHaveBeenCalledWith(exitCb);
  });

  it('dispose() detaches the local PTY without killing the tmux session', () => {
    const backend = factory()(spec());
    backend.dispose();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.startsWith('kill-session'))).toBe(false);
  });

  it('kill() runs `tmux kill-session` on the created name AND disposes the local PTY', () => {
    const backend = factory({ label: () => 'repo-feature/foo' })(spec());
    backend.kill();
    expect(calls).toContain('kill-session repo-feature/foo');
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('kill() is idempotent — second call does nothing', () => {
    const backend = factory()(spec());
    backend.kill();
    backend.kill();
    expect(calls.filter((c) => c.startsWith('kill-session'))).toHaveLength(1);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });
});
