export function buildNonInteractiveGitEnv(
  env: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  const mergedEnv = { ...process.env, ...env };
  const sshCommand = mergedEnv.GIT_SSH_COMMAND?.includes('BatchMode=')
    ? mergedEnv.GIT_SSH_COMMAND
    : `${mergedEnv.GIT_SSH_COMMAND ?? 'ssh'} -oBatchMode=yes`;

  return {
    ...mergedEnv,
    GCM_INTERACTIVE: 'never',
    GIT_SSH_COMMAND: sshCommand,
    GIT_TERMINAL_PROMPT: '0',
    SSH_ASKPASS_REQUIRE: 'never',
  };
}
