import type { IPty } from 'node-pty';

/** Signal delivery is not process termination: wait for node-pty's exit event. */
export function stopPty(pty: IPty): Promise<void> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(force);
      clearTimeout(deadline);
      subscription.dispose();
      if (error)
        reject(error instanceof Error ? error : new Error(String(error)));
      else resolve();
    };
    const signal = (name?: string) => {
      try {
        pty.kill(name);
      } catch (error) {
        finish(error);
      }
    };
    const force = setTimeout(() => signal('SIGKILL'), 5000);
    const deadline = setTimeout(() => {
      finish(new Error(`PTY ${pty.pid} did not exit after termination`));
    }, 10_000);
    const subscription = pty.onExit(() => finish());
    signal();
  });
}

/** Replacement, shutdown and browser reconnects share one PTY lifecycle. */
export function createPtyQueue(): (
  action: () => Promise<void>
) => Promise<void> {
  let pending = Promise.resolve();
  return (action) => {
    const next = pending.then(action);
    pending = next.catch(() => undefined);
    return next;
  };
}
