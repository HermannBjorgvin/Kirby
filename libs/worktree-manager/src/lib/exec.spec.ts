import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

import { exec as execCb } from 'node:child_process';
import { execNoPrompt } from './exec.js';

const mockExecCb = vi.mocked(execCb);

describe('execNoPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecCb.mockImplementation((...args: unknown[]) => {
      const callback = args[2] as ((error: null, stdout: string, stderr: string) => void) | undefined;
      callback?.(null, '', '');
      return {} as never;
    });
  });

  it('sets non-interactive git environment defaults', async () => {
    await execNoPrompt('git fetch --all --prune', { encoding: 'utf8' });

    expect(mockExecCb).toHaveBeenCalledWith(
      'git fetch --all --prune',
      expect.objectContaining({
        encoding: 'utf8',
        env: expect.objectContaining({
          GCM_INTERACTIVE: 'never',
          GIT_TERMINAL_PROMPT: '0',
          SSH_ASKPASS_REQUIRE: 'never',
          GIT_SSH_COMMAND: expect.stringContaining('-oBatchMode=yes'),
        }),
      }),
      expect.any(Function)
    );
  });

  it('preserves and augments an existing GIT_SSH_COMMAND', async () => {
    await execNoPrompt('git fetch origin main', {
      env: { GIT_SSH_COMMAND: 'ssh -i ~/.ssh/custom' },
    });

    expect(mockExecCb).toHaveBeenCalledWith(
      'git fetch origin main',
      expect.objectContaining({
        env: expect.objectContaining({
          GIT_SSH_COMMAND: 'ssh -i ~/.ssh/custom -oBatchMode=yes',
        }),
      }),
      expect.any(Function)
    );
  });

  it('does not duplicate BatchMode when it is already configured', async () => {
    await execNoPrompt('git fetch origin main', {
      env: { GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -i ~/.ssh/custom' },
    });

    expect(mockExecCb).toHaveBeenCalledWith(
      'git fetch origin main',
      expect.objectContaining({
        env: expect.objectContaining({
          GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -i ~/.ssh/custom',
        }),
      }),
      expect.any(Function)
    );
  });
});
