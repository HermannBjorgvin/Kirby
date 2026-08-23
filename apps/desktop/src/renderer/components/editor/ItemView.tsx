import {
  ExternalLinkIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  PlayIcon,
  SearchCodeIcon,
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
  itemTitle,
} from '../../lib/sidebar-model.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { PrReview } from '../review/PrReview.js';
import { SessionTerminal } from '../terminal/SessionTerminal.js';
import { Button } from '../ui/button.js';
import { Tip } from '../ui/tooltip.js';
import { LaunchDialog, type LaunchChoice } from './LaunchDialog.js';

/**
 * One editor tab for a sidebar item. A PR can be reached through
 * several sidebar rows (its worktree row, an orphan/review row); the
 * tab resolves the worktree session for the same branch so any of them
 * shows the running terminal — and lets you flip between the terminal
 * and the review while the agent works.
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
  const [viewOverride, setViewOverride] = useState<
    'terminal' | 'review' | null
  >(null);

  const branch = item ? itemBranch(item) : '';
  // The worktree/session row for this branch (may be the item itself).
  const sessionItem = useMemo(
    () =>
      items.find(
        (i): i is Extract<SidebarItem, { kind: 'session' }> =>
          i.kind === 'session' && itemBranch(i) === branch
      ),
    [items, branch]
  );

  if (!item) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        This item is no longer in the sidebar ({itemKey}).
      </div>
    );
  }

  const running = sessionItem ? itemRunning(sessionItem) : itemRunning(item);
  const hasWorktree = Boolean(sessionItem) || itemHasWorktree(item);
  const sessionName = sessionItem?.session.name;
  const pr = item.pr ?? sessionItem?.pr;
  const title = pr ? pr.title : itemTitle(item);
  const canShowTerminal = running && Boolean(sessionName);
  const view: 'terminal' | 'review' =
    viewOverride ?? (canShowTerminal ? 'terminal' : 'review');

  /** Estimate the terminal grid from the pane so the PTY's first paint
   *  is already the right size (wterm corrects it on mount anyway). */
  const estimateGrid = () => {
    const el = paneRef.current;
    if (!el) return {};
    const rect = el.getBoundingClientRect();
    const cols = Math.max(20, Math.floor((rect.width - 24) / 7.8));
    const rows = Math.max(5, Math.floor((rect.height - 16) / 18));
    return { cols, rows };
  };

  const afterLaunch = () => setViewOverride('terminal');

  const startPlainSession = async () => {
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
      { onSuccess: afterLaunch, onError: (e) => toast.error(errorMessage(e)) }
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
        onSuccess: () => {
          toast.success('Review agent started', { id });
          afterLaunch();
        },
        onError: (e) => toast.error(errorMessage(e), { id }),
      }
    );
  };

  const doKill = () =>
    sessionName &&
    kill.mutate(sessionName, { onError: (e) => toast.error(errorMessage(e)) });

  const busy = launch.isPending || create.isPending || launchReview.isPending;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-3">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {pr ? (
            <GitPullRequestIcon className="size-4 shrink-0 text-info" />
          ) : (
            <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-medium">{title}</span>
          {pr && (
            <span className="shrink-0 text-sm text-muted-foreground">
              #{pr.id}
            </span>
          )}
          <span className="truncate font-mono text-xs text-muted-foreground">
            {pr ? `${pr.sourceBranch} → ${pr.targetBranch}` : branch}
          </span>
        </span>

        {pr && canShowTerminal && (
          <div className="flex shrink-0 items-center rounded-md border border-border p-0.5">
            <Tip label="Agent terminal">
              <button
                onClick={() => setViewOverride('terminal')}
                className={cn(
                  'flex h-6 items-center gap-1 rounded px-2 text-xs',
                  view === 'terminal'
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <TerminalIcon className="size-3.5" /> Terminal
              </button>
            </Tip>
            <Tip label="Diff, comments and drafts">
              <button
                onClick={() => setViewOverride('review')}
                className={cn(
                  'flex h-6 items-center gap-1 rounded px-2 text-xs',
                  view === 'review'
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <SearchCodeIcon className="size-3.5" /> Review
              </button>
            </Tip>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-1.5">
          {pr && (
            <Tip label="Open on the provider">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void window.kirby.openExternal(pr.url)}
              >
                <ExternalLinkIcon /> Open
              </Button>
            </Tip>
          )}
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
        {canShowTerminal && sessionName && (
          <div
            className={cn(
              'absolute inset-0',
              view !== 'terminal' && 'invisible'
            )}
          >
            <SessionTerminal
              name={sessionName}
              active={active && view === 'terminal'}
            />
          </div>
        )}
        {pr ? (
          <div
            className={cn('absolute inset-0', view !== 'review' && 'invisible')}
          >
            <PrReview pr={pr} />
          </div>
        ) : (
          !canShowTerminal && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <TerminalIcon className="size-10 opacity-30" />
              <p className="text-base">No agent is running in this worktree.</p>
              <Button onClick={onLaunchClick} disabled={busy}>
                <PlayIcon /> Launch agent
              </Button>
            </div>
          )
        )}
      </div>

      {launchMenu && pr && (
        <LaunchDialog
          pr={pr}
          hasWorktree={hasWorktree}
          onChoose={onChoose}
          onClose={() => setLaunchMenu(false)}
        />
      )}
    </div>
  );
}
