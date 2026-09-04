import { toast } from 'sonner';
import type { PullRequestInfo } from '@kirby/vcs-core/types';
import { useStartBabysit, useStopBabysit } from '../../lib/data/mutations.js';
import type { PrRowCommand } from '../../lib/sidebar/sidebar-row-menu.js';
import { errorMessage } from '../../lib/utils.js';

/**
 * What a sidebar row can do with its pull request: open it, and start
 * or stop babysitting it. Separate from the row so the worktree
 * commands and the pull request commands each read as one list. The
 * babysitter's status is not read here: it rides on the sidebar item.
 */
export function usePullRequestRow(
  pr: PullRequestInfo | undefined,
  cwd: string
): {
  run: (command: PrRowCommand) => void;
} {
  const start = useStartBabysit(cwd);
  const stop = useStopBabysit(cwd);

  const run = (command: PrRowCommand) => {
    if (!pr) return;
    switch (command) {
      case 'open-pr':
        void window.kirby.openExternal(pr.url);
        break;
      case 'babysit':
        start.mutate(pr.id, {
          onSuccess: () => toast.success(`Babysitting #${pr.id}`),
          onError: (e) => toast.error(errorMessage(e)),
        });
        break;
      case 'stop-babysit':
        stop.mutate(pr.id, {
          onError: (e) => toast.error(errorMessage(e)),
        });
        break;
    }
  };

  return { run };
}
