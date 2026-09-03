import { toast } from 'sonner';
import type { PullRequestInfo } from '@kirby/vcs-core/types';
import type { BabysitStatus } from '../../../host/contract.js';
import { useStartBabysit, useStopBabysit } from '../../lib/data/mutations.js';
import { useBabysat } from '../../lib/data/queries.js';
import type { PrRowCommand } from '../../lib/sidebar/sidebar-row-menu.js';
import { errorMessage } from '../../lib/utils.js';

/**
 * What a sidebar row can do with its pull request: open it, and start
 * or stop babysitting it. Separate from the row so the worktree
 * commands and the pull request commands each read as one list.
 */
export function usePullRequestRow(
  pr: PullRequestInfo | undefined,
  cwd: string
): {
  /** The babysitter's status, when the pull request has one. */
  babysit: BabysitStatus | undefined;
  run: (command: PrRowCommand) => void;
} {
  const start = useStartBabysit(cwd);
  const stop = useStopBabysit(cwd);
  const babysat = useBabysat(cwd);
  const babysit = babysat.data?.find((s) => s.prId === pr?.id);

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

  return { babysit, run };
}
