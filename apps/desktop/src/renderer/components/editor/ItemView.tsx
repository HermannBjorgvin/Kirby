import {
  ExternalLinkIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  PlayIcon,
  SquareIcon,
  TerminalIcon,
} from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';
import type { SidebarItem } from '../../../host/contract.js';
import { useRepo } from '../../lib/repo-context.js';
import {
  useCreateWorktree,
  useKillSession,
  useLaunchAgent,
} from '../../lib/queries.js';
import {
  itemBranch,
  itemHasWorktree,
  itemRunning,
  itemSessionName,
  itemTitle,
} from '../../lib/sidebar-model.js';
import { errorMessage } from '../../lib/utils.js';
import { PrReview } from '../review/PrReview.js';
import { SessionTerminal } from '../terminal/SessionTerminal.js';
import { Button } from '../ui/button.js';
import { Tip } from '../ui/tooltip.js';

/**
 * One editor tab for a sidebar item:
 *   • running session     → its terminal (full pane)
 *   • PR (any kind)       → PR review, with launch/checkout in the toolbar
 *   • idle plain worktree → launch call-to-action
 */
export function ItemView({
  item,
  itemKey,
  active,
  onPin,
}: {
  item: SidebarItem | undefined;
  itemKey: string;
  active: boolean;
  onPin: () => void;
}) {
  const { repo } = useRepo();
  const launch = useLaunchAgent(repo.cwd);
  const kill = useKillSession(repo.cwd);
  const create = useCreateWorktree(repo.cwd);
  const paneRef = useRef<HTMLDivElement>(null);

  if (!item) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        This item is no longer in the sidebar ({itemKey}).
      </div>
    );
  }

  const running = itemRunning(item);
  const hasWorktree = itemHasWorktree(item);
  const branch = itemBranch(item);
  const sessionName = itemSessionName(item);
  const pr = item.pr;
  // Tab header: prefer the PR title when there is one; the branch is
  // shown alongside in mono, so repeating it as the title adds nothing.
  const title = pr ? pr.title : itemTitle(item);

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

  const doLaunch = () => {
    onPin();
    launch.mutate(
      { branch, intent: 'continue-or-blank', ...estimateGrid() },
      { onError: (e) => toast.error(errorMessage(e)) }
    );
  };
  const doCheckoutAndLaunch = () => {
    onPin();
    const id = toast.loading(`Checking out ${branch}…`);
    create.mutate(branch, {
      onSuccess: () => {
        toast.success(`Worktree ready: ${branch}`, { id });
        launch.mutate(
          { branch, intent: 'continue-or-blank', ...estimateGrid() },
          { onError: (e) => toast.error(errorMessage(e)) }
        );
      },
      onError: (e) => toast.error(errorMessage(e), { id }),
    });
  };
  const doKill = () =>
    sessionName &&
    kill.mutate(sessionName, { onError: (e) => toast.error(errorMessage(e)) });

  const busy = launch.isPending || create.isPending;

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
          ) : hasWorktree ? (
            <Button size="sm" onClick={doLaunch} disabled={busy}>
              <PlayIcon /> {busy ? 'Launching…' : 'Launch agent'}
            </Button>
          ) : (
            <Button size="sm" onClick={doCheckoutAndLaunch} disabled={busy}>
              <PlayIcon /> {busy ? 'Working…' : 'Check out & launch'}
            </Button>
          )}
        </div>
      </header>

      <div ref={paneRef} className="relative min-h-0 flex-1">
        {running && sessionName ? (
          <SessionTerminal name={sessionName} active={active} />
        ) : pr ? (
          <PrReview pr={pr} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <TerminalIcon className="size-10 opacity-30" />
            <p className="text-base">No agent is running in this worktree.</p>
            <Button onClick={doLaunch} disabled={busy}>
              <PlayIcon /> Launch agent
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
