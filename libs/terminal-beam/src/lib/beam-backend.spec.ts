import { describe, it, expect, vi, beforeEach } from 'vitest';

const ptyCtor = vi.fn();
vi.mock('@kirby/terminal-pty', () => ({
  PtySession: class {
    pid = 42;
    cols: number;
    rows: number;
    constructor(
      cmd: string,
      args: string[],
      opts: { cols: number; rows: number }
    ) {
      ptyCtor(cmd, args, opts);
      this.cols = opts.cols;
      this.rows = opts.rows;
    }
    write = vi.fn();
    resize = vi.fn();
    onData = vi.fn();
    offData = vi.fn();
    onExit = vi.fn();
    offExit = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock('./beam-cli.js', () => ({
  beamKillSession: vi.fn(() => ({ stdout: '', stderr: '', exitCode: 0 })),
}));

import { createBeamBackendFactory } from './beam-backend.js';
import { beamKillSession } from './beam-cli.js';

const spec = {
  name: 'desktop:kirby-abc-feature-x',
  cmd: '/bin/sh',
  args: ['-c', 'claude --continue || claude'],
  cwd: '/data/repo/.beam/worktrees/kirby-abc-feature-x',
  cols: 120,
  rows: 40,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createBeamBackendFactory', () => {
  it('spawns the beam CLI with create-or-attach argv', () => {
    const factory = createBeamBackendFactory({
      repoFor: () => '/data/repo',
      branchFor: () => 'feature/x',
    });
    factory(spec);
    expect(ptyCtor).toHaveBeenCalledTimes(1);
    const [cmd, args] = ptyCtor.mock.calls[0]!;
    expect(cmd).toBe('beam');
    // No -c here: beam refuses it next to --repo, and the worktree
    // already decides the directory.
    expect(args).toEqual([
      'new',
      'desktop:kirby-abc-feature-x',
      '--repo',
      '/data/repo',
      '--branch',
      'feature/x',
      '--',
      'sh',
      '-lc',
      "/bin/sh -c 'claude --continue || claude'",
    ]);
  });

  it('omits worktree flags when the lookups return nothing (reattach)', () => {
    const factory = createBeamBackendFactory();
    factory(spec);
    const [, args] = ptyCtor.mock.calls[0]!;
    expect(args).not.toContain('--repo');
    expect(args).not.toContain('--branch');
  });

  it('a custom binary name is used', () => {
    createBeamBackendFactory({ beamBin: '/opt/beam' })(spec);
    expect(ptyCtor.mock.calls[0]![0]).toBe('/opt/beam');
  });

  it('dispose detaches without killing the remote session', () => {
    const backend = createBeamBackendFactory()(spec);
    backend.dispose();
    expect(beamKillSession).not.toHaveBeenCalled();
  });

  it('kill tears the remote session down, once', () => {
    const backend = createBeamBackendFactory()(spec);
    backend.kill();
    backend.kill();
    expect(beamKillSession).toHaveBeenCalledTimes(1);
    expect(beamKillSession).toHaveBeenCalledWith(
      'beam',
      'desktop:kirby-abc-feature-x'
    );
  });
});
