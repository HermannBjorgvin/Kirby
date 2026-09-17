import { prepareTmuxSession, type TmuxLaunchPlan } from '@n10/terminal-tmux';
import type { SessionSpec } from '@n10/terminal';

/** A utility process starts tmux without inheriting the browser's open resources. */
process.parentPort.once(
  'message',
  ({ data }: { data: { spec: SessionSpec; plan: TmuxLaunchPlan } }) => {
    try {
      const name = prepareTmuxSession(data.spec, data.plan);
      process.parentPort.postMessage({ name });
    } catch (error) {
      process.parentPort.postMessage({
        error: error instanceof Error ? error.message : String(error),
      });
    }
    setImmediate(() => process.exit(0));
  }
);
