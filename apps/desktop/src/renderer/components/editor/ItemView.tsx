import {
  GitBranchIcon,
  PlayIcon,
  SquareIcon,
  TerminalIcon,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { SidebarItem } from '../../../host/contract.js';
import { useRepo } from '../../lib/repo-context.js';
import {
  useCreateWorktree,
  useKillSession,
  useLaunchAgent,
  useLaunchReview,
} from '../../lib/queries.js';
import {
  itemBranch,
  itemHasWorktree,
  itemRunning,
  itemSessionName,
  itemTitle,
} from '../../lib/sidebar-model.js';
import { errorMessage } from '../../lib/utils.js';
import { PrWorkspace } from '../review/PrWorkspace.js';
import { SessionTerminal } from '../terminal/SessionTerminal.js';
import { Button } from '../ui/button.js';
import { LaunchDialog, type LaunchChoice } from './LaunchDialog.js';

/**
 * One editor tab for a sidebar item.
 *   • A pull request → the review workspace (PrWorkspace): a rail of
 *     Agent / Files / Comments beside a pane that swaps between the diff
 *     and the agent terminal. Launch/Stop live in the rail.
 *   • A bare worktree → its agent terminal, or a launch call-to-action.
 */
export function ItemView({
  item,
  items,
  itemKey,
  active,
  onPin,
}: {
  item: SidebarItem | undefined;
  items: SidebarItem[];
  itemKey: string;
  active: boolean;
  onPin: () => void;
}) {
  const { repo } = useRepo();
  const launch = useLaunchAgent(repo.cwd);
  const launchReview = useLaunchReview(repo.cwd);
  const kill = useKillSession(repo.cwd);
  const create = useCreateWorktree(repo.cwd);
  const paneRef = useRef<HTMLDivElement>(null);
  const [launchMenu, setLaunchMenu] = useState(false);

  const branch = item ? itemBranch(item) : '';
  const sessionRow = useMemo(
    () => items.find((i) => itemBranch(i) === branch && itemSessionName(i)),
    [items, branch]
  );

  if (!item) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        This item is no longer in the sidebar ({itemKey}).
      </div>
    );
  }

  const sessionName =
    itemSessionName(item) ??
    (sessionRow ? itemSessionName(sessionRow) : undefined);
  const running =
    itemRunning(item) || (sessionRow ? itemRunning(sessionRow) : false);
  const hasWorktree = Boolean(sessionName) || itemHasWorktree(item);
  const pr = item.pr ?? sessionRow?.pr;
  const title = pr ? pr.title : itemTitle(item);

  const estimateGrid = () => {
    const el = paneRef.current;
    if (!el) return {};
    const rect = el.getBoundingClientRect();
    const cols = Math.max(20, Math.floor((rect.width * 0.6 - 24) / 7.8));
    const rows = Math.max(5, Math.floor((rect.height - 16) / 18));
    return { cols, rows };
  };

  const startPlainSession = async () => {
    onPin();
    if (!hasWorktree) {
      const id = toast.loading(`Checking out ${branch}…`);
      try {
        await create.mutateAsync(branch);
        toast.success(`Worktree ready: ${branch}`, { id });
      } catch (e) {
        toast.error(errorMessage(e), { id });
        return;
      }
    }
    launch.mutate(
      { branch, intent: 'continue-or-blank', ...estimateGrid() },
      { onError: (e) => toast.error(errorMessage(e)) }
    );
  };

  const onLaunchClick = () => {
    onPin();
    if (pr) setLaunchMenu(true);
    else void startPlainSession();
  };

  const onChoose = (choice: LaunchChoice) => {
    setLaunchMenu(false);
    if (choice.kind === 'session') {
      void startPlainSession();
      return;
    }
    if (!pr) return;
    const id = toast.loading(
      hasWorktree
        ? 'Starting review…'
        : `Checking out ${branch} and starting review…`
    );
    launchReview.mutate(
      { pr, instruction: choice.instruction, ...estimateGrid() },
      {
        onSuccess: () => toast.success('Review agent started', { id }),
        onError: (e) => toast.error(errorMessage(e), { id }),
      }
    );
  };

  const doKill = () =>
    sessionName &&
    kill.mutate(sessionName, { onError: (e) => toast.error(errorMessage(e)) });

  const busy = launch.isPending || create.isPending || launchReview.isPending;

  // A pull request is the full review workspace (its own merged header,
  // rail, and content). A bare worktree keeps a simple header + terminal.
  if (pr) {
    return (
      <>
        <PrWorkspace
          pr={pr}
          sessionName={sessionName}
          running={running}
          active={active}
          busy={busy}
          onLaunch={onLaunchClick}
          onStop={doKill}
        />
        {launchMenu && (
          <LaunchDialog
            pr={pr}
            hasWorktree={hasWorktree}
            onChoose={onChoose}
            onClose={() => setLaunchMenu(false)}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-3">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{title}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {branch}
          </span>
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {running ? (
            <Button
              variant="outline"
              size="sm"
              onClick={doKill}
              disabled={kill.isPending}
            >
              <SquareIcon /> Stop agent
            </Button>
          ) : (
            <Button size="sm" onClick={onLaunchClick} disabled={busy}>
              <PlayIcon />{' '}
              {busy
                ? 'Working…'
                : hasWorktree
                ? 'Launch agent'
                : 'Check out & launch'}
            </Button>
          )}
        </div>
      </header>

      <div ref={paneRef} className="relative min-h-0 flex-1">
        {sessionName ? (
          <div className="absolute inset-0">
            <SessionTerminal name={sessionName} active={active} />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <TerminalIcon className="size-10 opacity-30" />
            <p className="text-base">No agent is running in this worktree.</p>
            <Button onClick={onLaunchClick} disabled={busy}>
              <PlayIcon /> {hasWorktree ? 'Launch agent' : 'Check out & launch'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
