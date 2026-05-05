import { describe, it, expect, vi, beforeEach } from 'vitest';

const { tmuxVersionMock } = vi.hoisted(() => ({
  tmuxVersionMock: vi.fn(),
}));

vi.mock('./tmux-cli.js', () => ({
  tmuxVersion: tmuxVersionMock,
}));

import { isTmuxAvailable, __resetForTests } from './is-tmux-available.js';

describe('isTmuxAvailable', () => {
  beforeEach(() => {
    __resetForTests();
    tmuxVersionMock.mockReset();
  });

  it('reports available for a current tmux release', async () => {
    tmuxVersionMock.mockReturnValue('tmux 3.4');
    const status = await isTmuxAvailable();
    expect(status).toEqual({ available: true, version: '3.4' });
  });

  it('parses the next-X.Y development version format', async () => {
    tmuxVersionMock.mockReturnValue('tmux next-3.5');
    const status = await isTmuxAvailable();
    expect(status.available).toBe(true);
    expect(status.version).toBe('3.5');
  });

  it('rejects too-old tmux releases with reason and install hint', async () => {
    tmuxVersionMock.mockReturnValue('tmux 1.8');
    const status = await isTmuxAvailable();
    expect(status.available).toBe(false);
    expect(status.version).toBe('1.8');
    expect(status.reason).toMatch(/too old/);
    expect(status.installHint).toBeTruthy();
  });

  it('reports unavailable when the binary is missing', async () => {
    tmuxVersionMock.mockImplementation(() => {
      throw Object.assign(new Error('spawn tmux ENOENT'), { code: 'ENOENT' });
    });
    const status = await isTmuxAvailable();
    expect(status.available).toBe(false);
    expect(status.reason).toMatch(/not found/);
    expect(status.installHint).toBeTruthy();
  });

  it('reports unavailable when -V output is unparseable', async () => {
    tmuxVersionMock.mockReturnValue('garbage');
    const status = await isTmuxAvailable();
    expect(status.available).toBe(false);
    expect(status.reason).toMatch(/unexpected output/);
  });

  it('memoizes the result across calls', async () => {
    tmuxVersionMock.mockReturnValue('tmux 3.4');
    await isTmuxAvailable();
    await isTmuxAvailable();
    await isTmuxAvailable();
    expect(tmuxVersionMock).toHaveBeenCalledTimes(1);
  });
});
