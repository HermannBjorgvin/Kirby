import { utilityProcess } from 'electron';
import { join } from 'node:path';
import {
  prepareTmuxSession,
  setTmuxSessionPreparer,
  type TmuxLaunchPlan,
} from '@kirby/terminal-tmux';
import type { SessionSpec } from '@kirby/terminal';

/** Forking directly from Electron leaks Chromium descriptors into the persistent
 * tmux server on Linux. Electron's supported utility-process API isolates them. */
export function prepareDesktopTmuxSession(
  spec: SessionSpec,
  plan: TmuxLaunchPlan
): string | Promise<string> {
  // Existing targets cannot create a server and need no extra process boundary.
  if (plan.mode !== 'create') return prepareTmuxSession(spec, plan);
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(
      join(import.meta.dirname, 'tmux-session-worker.js'),
      [],
      {
        stdio: 'ignore',
        serviceName: 'Kirby tmux session launcher',
      }
    );
    let completed = false;
    const finish = (error?: Error, name?: string) => {
      if (completed) return;
      completed = true;
      if (error) reject(error);
      else resolve(name!);
    };
    // Native preparation bounds each command and owns failed-create cleanup.
    // Do not terminate the worker in the middle of that transaction.
    child.once('message', (message: { name?: string; error?: string }) => {
      if (typeof message.name === 'string') finish(undefined, message.name);
      else finish(new Error(message.error ?? 'Invalid tmux launcher response'));
    });
    child.once('exit', (code) =>
      finish(
        new Error(`Tmux launcher exited before returning a session (${code})`)
      )
    );
    child.postMessage({ spec, plan });
  });
}

export function installDesktopTmuxPreparer(): void {
  setTmuxSessionPreparer(prepareDesktopTmuxSession);
}
