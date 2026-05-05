import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionSpec } from '@kirby/terminal';

const {
  ptySpawnArgs,
  disposeSpy,
  writeSpy,
  resizeSpy,
  onDataSpy,
  onExitSpy,
  offDataSpy,
  offExitSpy,
  tmuxKillSpy,
  MockPtySession,
} = vi.hoisted(() => {
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
  const tmuxKillSpy = vi.fn();
  class MockPtySession {
    pid = 1234;
    cols: number;
    rows: number;
    constructor(cmd: string, args: string[], opts: Record<string, unknown>) {
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
    ptySpawnArgs,
    disposeSpy,
    writeSpy,
    resizeSpy,
    onDataSpy,
    onExitSpy,
    offDataSpy,
    offExitSpy,
    tmuxKillSpy,
    MockPtySession,
  };
});

vi.mock('@kirby/terminal-pty', () => ({ PtySession: MockPtySession }));
vi.mock('./tmux-cli.js', () => ({
  tmuxKillSession: (name: string) => tmuxKillSpy(name),
}));

import { createTmuxBackendFactory } from './tmux-backend.js';

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

describe('createTmuxBackendFactory', () => {
  beforeEach(() => {
    ptySpawnArgs.length = 0;
    disposeSpy.mockReset();
    writeSpy.mockReset();
    resizeSpy.mockReset();
    onDataSpy.mockReset();
    onExitSpy.mockReset();
    offDataSpy.mockReset();
    offExitSpy.mockReset();
    tmuxKillSpy.mockReset();
  });

  it('spawns `tmux new-session -A` with the prefixed, sanitized name', () => {
    const factory = createTmuxBackendFactory({
      sessionPrefix: 'kirby-abc12345-',
    });
    factory(spec({ name: 'release/v1.0.1' }));
    expect(ptySpawnArgs).toHaveLength(1);
    const { cmd, args } = ptySpawnArgs[0]!;
    expect(cmd).toBe('tmux');
    // `release/v1.0.1` has dots and a slash. Slashes are valid in tmux
    // names; dots are not, so they get replaced.
    expect(args).toContain('-s');
    const idx = args.indexOf('-s');
    expect(args[idx + 1]).toBe('kirby-abc12345-release/v1-0-1');
  });

  it('passes cmd and args after the `--` separator', () => {
    const factory = createTmuxBackendFactory();
    factory(spec({ cmd: '/bin/sh', args: ['-c', 'claude --continue'] }));
    const { args } = ptySpawnArgs[0]!;
    const sep = args.indexOf('--');
    expect(sep).toBeGreaterThan(0);
    expect(args.slice(sep + 1)).toEqual(['/bin/sh', '-c', 'claude --continue']);
  });

  it('passes cwd, cols, rows to the local PTY for sizing', () => {
    const factory = createTmuxBackendFactory();
    factory(spec({ cols: 120, rows: 40 }));
    const { args, opts } = ptySpawnArgs[0]!;
    expect(args).toContain('-c');
    expect(args[args.indexOf('-c') + 1]).toBe('/tmp/work');
    expect(args[args.indexOf('-x') + 1]).toBe('120');
    expect(args[args.indexOf('-y') + 1]).toBe('40');
    expect(opts['cwd']).toBe('/tmp/work');
    expect(opts['cols']).toBe(120);
    expect(opts['rows']).toBe(40);
  });

  it('forwards write/resize/onData/onExit to the inner PtySession', () => {
    const factory = createTmuxBackendFactory();
    const backend = factory(spec());
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
    const factory = createTmuxBackendFactory();
    const backend = factory(spec());
    backend.dispose();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(tmuxKillSpy).not.toHaveBeenCalled();
  });

  it('kill() runs `tmux kill-session` with the sanitized name AND disposes the local PTY', () => {
    const factory = createTmuxBackendFactory({ sessionPrefix: 'kirby-' });
    const backend = factory(spec({ name: 'feature/foo' }));
    backend.kill();
    expect(tmuxKillSpy).toHaveBeenCalledWith('kirby-feature/foo');
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('kill() is idempotent — second call does nothing', () => {
    const factory = createTmuxBackendFactory();
    const backend = factory(spec());
    backend.kill();
    backend.kill();
    expect(tmuxKillSpy).toHaveBeenCalledTimes(1);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('honors an empty sessionPrefix (lib stays caller-agnostic)', () => {
    const factory = createTmuxBackendFactory();
    factory(spec({ name: 'plainsession' }));
    const args = ptySpawnArgs[0]!.args;
    const idx = args.indexOf('-s');
    expect(args[idx + 1]).toBe('plainsession');
  });
});
