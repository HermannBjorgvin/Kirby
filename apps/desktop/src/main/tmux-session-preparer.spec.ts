import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSpec } from '@n10/terminal';

const { fork, prepare, install } = vi.hoisted(() => ({
  fork: vi.fn(),
  prepare: vi.fn(),
  install: vi.fn(),
}));
vi.mock('electron', () => ({ utilityProcess: { fork } }));
vi.mock('@n10/terminal-tmux', () => ({
  prepareTmuxSession: prepare,
  setTmuxSessionPreparer: install,
}));
import {
  installDesktopTmuxPreparer,
  prepareDesktopTmuxSession,
} from './tmux-session-preparer.js';

const spec: SessionSpec = {
  cmd: 'agent',
  args: [],
  cwd: '/repo',
  cols: 80,
  rows: 24,
};
const plan = {
  mode: 'create' as const,
  label: 'agent',
  tags: { '@agent': 'example' },
  excludedNames: ['agent-2'],
};
let child: EventEmitter & { postMessage: ReturnType<typeof vi.fn> };
beforeEach(() => {
  child = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  fork.mockReset().mockReturnValue(child);
  prepare.mockReset();
  install.mockReset();
});

describe('desktop tmux process isolation', () => {
  it('prepares newly hosted processes in Electron’s isolated utility process', async () => {
    const pending = prepareDesktopTmuxSession(spec, plan);
    expect(fork).toHaveBeenCalledWith(
      expect.stringMatching(/tmux-session-worker\.js$/),
      [],
      expect.objectContaining({ stdio: 'ignore' })
    );
    expect(child.postMessage).toHaveBeenCalledWith({ spec, plan });
    expect(prepare).not.toHaveBeenCalled();
    child.emit('message', { name: 'agent-3' });
    await expect(pending).resolves.toBe('agent-3');
  });
  it.each(['attach', 'restart'] as const)(
    'keeps %s operations on an existing server local',
    (mode) => {
      prepare.mockReturnValue('existing');
      expect(
        prepareDesktopTmuxSession(spec, { mode, target: 'existing' })
      ).toBe('existing');
      expect(fork).not.toHaveBeenCalled();
    }
  );
  it('propagates preparation errors instead of attaching to a guessed name', async () => {
    const pending = prepareDesktopTmuxSession(spec, plan);
    child.emit('message', { error: 'tmux rejected creation' });
    await expect(pending).rejects.toThrow('tmux rejected creation');
  });
  it('rejects when the worker exits before returning its session', async () => {
    const pending = prepareDesktopTmuxSession(spec, plan);
    child.emit('exit', 1);
    await expect(pending).rejects.toThrow('exited before returning');
  });
  it('installs the preparer as the desktop composition boundary', () => {
    installDesktopTmuxPreparer();
    expect(install).toHaveBeenCalledWith(prepareDesktopTmuxSession);
  });
});
