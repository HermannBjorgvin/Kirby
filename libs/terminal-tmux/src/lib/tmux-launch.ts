import type { SessionSpec } from '@kirby/terminal';
import { sanitizeTmuxSessionName } from './sanitize-tmux-session-name.js';
import {
  isDuplicateSession,
  sessionNameCandidates,
  tmuxHasSession,
  tmuxKillSession,
  tmuxNewSessionDetached,
  tmuxSetOption,
  tmuxShowOption,
  runTmux,
  tmuxPaneState,
  type TmuxRunResult,
} from './tmux-cli.js';

/** The caller decides identity and intent; this library performs transport operations. */
export type TmuxLaunchPlan =
  | {
      mode: 'create';
      label: string;
      tags: Record<string, string>;
      retainOnExit?: boolean;
      excludedNames?: readonly string[];
    }
  | { mode: 'attach'; target: string }
  | {
      mode: 'restart';
      target: string;
      tags?: Record<string, string>;
      retainOnExit?: boolean;
    };

function checked(result: TmuxRunResult, operation: string): void {
  if (result.exitCode !== 0)
    throw new Error(`tmux ${operation} failed: ${result.stderr.trim()}`);
}

/** The server retains its original environment, so pin launch-specific additions. */
function sessionEnvFlags(spec: SessionSpec): string[] {
  const vars = new Map<string, string>();
  for (const key of ['PATH', 'HOME']) {
    const value = spec.env?.[key] ?? process.env[key];
    if (value) vars.set(key, value);
  }
  for (const [key, value] of Object.entries(spec.envAdditions ?? {})) {
    if (value != null) vars.set(key, value);
  }
  return [...vars].flatMap(([key, value]) => ['-e', `${key}=${value}`]);
}

function commandArgs(
  name: string,
  spec: SessionSpec,
  replacePlaceholder: boolean
): string[] {
  // No command to respawn-pane repeats the placeholder. Explicitly select
  // the configured login shell for an ordinary terminal instead.
  const command = spec.cmd
    ? [spec.cmd, ...spec.args]
    : [tmuxShowOption(name, 'default-shell') || '/bin/sh', '-l'];
  return [
    'respawn-pane',
    ...(replacePlaceholder ? ['-k'] : []),
    '-t',
    `=${name}:`,
    '-c',
    spec.cwd,
    ...sessionEnvFlags(spec),
    '--',
    ...command,
  ];
}

function optionCommands(
  name: string,
  tags: Record<string, string> = {},
  retain = false
): string[][] {
  const options = {
    ...tags,
    'remain-on-exit': retain ? 'on' : 'off',
    status: 'off',
  };
  return Object.entries(options).map(([key, value]) => [
    'set-option',
    '-t',
    `=${name}:`,
    key,
    value,
  ]);
}

function runCommands(commands: string[][]): void {
  const [first, ...following] = commands;
  checked(runTmux(first, following), 'session setup');
}

function create(
  spec: SessionSpec,
  plan: Extract<TmuxLaunchPlan, { mode: 'create' }>
): string {
  const label = sanitizeTmuxSessionName(plan.label);
  let attempts = 0;
  for (const name of sessionNameCandidates(label)) {
    if (++attempts > 10_000) break;
    if (plan.excludedNames?.includes(name) || tmuxHasSession(name)) continue;
    // A long-lived placeholder keeps the session available while options are
    // written. The real command cannot exit before its metadata is installed.
    const result = tmuxNewSessionDetached(name, {
      cwd: spec.cwd,
      cols: spec.cols,
      rows: spec.rows,
      flags: sessionEnvFlags(spec),
      command: ['--', '/bin/sh', '-c', 'exec sleep 86400'],
    });
    if (isDuplicateSession(result)) continue;
    checked(result, `new-session -s ${name}`);
    try {
      // Publish complete metadata and launch in one native command queue, so
      // another client cannot discover a partly tagged placeholder.
      runCommands([
        ...optionCommands(name, plan.tags, plan.retainOnExit),
        commandArgs(name, spec, true),
      ]);
      return name;
    } catch (error) {
      tmuxKillSession(name);
      throw error;
    }
  }
  throw new Error(`no free tmux session name for ${label}`);
}

export function prepareTmuxSession(
  spec: SessionSpec,
  plan: TmuxLaunchPlan
): string {
  if (plan.mode === 'create') return create(spec, plan);
  if (plan.mode === 'restart') {
    const state = tmuxPaneState(plan.target);
    if (!state?.paneDead)
      throw new Error(
        `Cannot restart a running or missing tmux pane: ${plan.target}`
      );
    // A single native command queue stops at a failed respawn. Only the
    // winning launcher may update metadata, and options are applied before
    // tmux processes the new command's exit. No -k may kill a concurrent winner.
    runCommands([
      commandArgs(plan.target, spec, false),
      ...optionCommands(plan.target, plan.tags, plan.retainOnExit),
    ]);
  } else {
    checked(tmuxSetOption(plan.target, 'status', 'off'), 'set-option status');
  }
  return plan.target;
}
