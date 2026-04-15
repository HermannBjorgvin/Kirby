import { describe, expect, it } from 'vitest';
import { buildNonInteractiveGitEnv } from './non-interactive-git.js';

describe('buildNonInteractiveGitEnv', () => {
  it('sets non-interactive git defaults', () => {
    expect(buildNonInteractiveGitEnv()).toEqual(
      expect.objectContaining({
        GCM_INTERACTIVE: 'never',
        GIT_TERMINAL_PROMPT: '0',
        SSH_ASKPASS_REQUIRE: 'never',
        GIT_SSH_COMMAND: expect.stringContaining('-oBatchMode=yes'),
      })
    );
  });

  it('preserves and augments an existing GIT_SSH_COMMAND', () => {
    expect(
      buildNonInteractiveGitEnv({
        GIT_SSH_COMMAND: 'ssh -i ~/.ssh/custom',
      }).GIT_SSH_COMMAND
    ).toBe('ssh -i ~/.ssh/custom -oBatchMode=yes');
  });

  it('does not duplicate BatchMode when already configured', () => {
    expect(
      buildNonInteractiveGitEnv({
        GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -i ~/.ssh/custom',
      }).GIT_SSH_COMMAND
    ).toBe('ssh -oBatchMode=yes -i ~/.ssh/custom');
  });
});
