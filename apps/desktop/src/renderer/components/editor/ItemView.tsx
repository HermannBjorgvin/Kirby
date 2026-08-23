import {
  ExternalLinkIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  PlayIcon,
  SquareIcon,
  TerminalIcon,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  Group,
  Panel,
  Separator as PanelSeparator,
} from 'react-resizable-panels';
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
import { cn, errorMessage } from '../../lib/utils.js';
import { PrReview } from '../review/PrReview.js';
import { SessionTerminal } from '../terminal/SessionTerminal.js';
import { Button } from '../ui/button.js';
import { Tip } from '../ui/tooltip.js';
import { LaunchDialog, type LaunchChoice } from './LaunchDialog.js';

/**
 * One editor tab for a sidebar item.
 *
 * When the item's branch has a review session (running or its final
 * frame), the tab is a review workspace: the agent terminal on the
 * left, the PR review (diff + drafts + comments) on the right, split
 * resizably — so the drafts the agent writes appear in the diff live.
 * With no session it's the plain PR review, or a launch call-to-action
 * for a bare worktree.
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
  /** null → auto (split when a session exists); otherwise a forced sole pane. */
  const [solo, setSolo] = useState<'terminal' | 'review' | null>(null);

  const branch = item ? itemBranch(item) : '';
  // Any sidebar row for this branch carrying a live/idle session — the
  // item's own worktree row, or (for review-bucket PRs, which aren't
  // `session` items) the session name the host attached to the PR item.
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
  const hasTerminal = Boolean(sessionName);

  const estimateGrid = () => {
    const el = paneRef.current;
    if (!el) return {};
    const rect = el.getBoundingClientRect();
    const cols = Math.max(20, Math.floor((rect.width / 2 - 24) / 7.8));
    const rows = Math.max(5, Math.floor((rect.height - 16) / 18));
    return { cols, rows };
  };

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

  const terminalPane = sessionName ? (
    <SessionTerminal name={sessionName} active={active && solo !== 'review'} />
  ) : null;
  const reviewPane = pr ? <PrReview pr={pr} /> : null;

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

        {/* Layout switch: split �| terminal-only | review-only (only
            meaningful when both a terminal and a review exist). */}
        {hasTerminal && pr && (
          <div className="flex shrink-0 items-center rounded-md border border-border p-0.5">
            <LayoutButton
              active={solo === 'terminal'}
              onClick={() => setSolo('terminal')}
              icon={<TerminalIcon className="size-3.5" />}
              label="Agent terminal only"
            />
            <LayoutButton
              active={solo === null}
              onClick={() => setSolo(null)}
              icon={<SplitIcon />}
              label="Split: terminal + review"
            />
            <LayoutButton
              active={solo === 'review'}
              onClick={() => setSolo('review')}
              icon={<GitPullRequestIcon className="size-3.5" />}
              label="Review only"
            />
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
        {hasTerminal && pr ? (
          // Review workspace: terminal �| review, resizable. Both panes
          // stay mounted (hidden with `hidden`) so the terminal keeps
          // its scrollback and the diff its scroll position when soloing.
          <Group orientation="horizontal" className="h-full">
            <Panel
              id="agent"
              defaultSize="46%"
              minSize="20%"
              className={cn('min-w-0', solo === 'review' && 'hidden')}
            >
              <div className="relative h-full">{terminalPane}</div>
            </Panel>
            <PanelSeparator
              className={cn(
                'relative w-px bg-border transition-colors after:absolute after:inset-y-0 after:-left-1 after:w-2 hover:bg-primary data-[resize-handle-state=drag]:bg-primary',
                solo !== null && 'hidden'
              )}
            />
            <Panel
              id="review"
              minSize="20%"
              className={cn('min-w-0', solo === 'terminal' && 'hidden')}
            >
              {reviewPane}
            </Panel>
          </Group>
        ) : hasTerminal ? (
          <div className="relative h-full">{terminalPane}</div>
        ) : pr ? (
          reviewPane
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <TerminalIcon className="size-10 opacity-30" />
            <p className="text-base">No agent is running in this worktree.</p>
            <Button onClick={onLaunchClick} disabled={busy}>
              <PlayIcon /> Launch agent
            </Button>
          </div>
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

function LayoutButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Tip label={label}>
      <button
        onClick={onClick}
        aria-pressed={active}
        aria-label={label}
        className={cn(
          'flex h-6 items-center justify-center rounded px-2',
          active
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        {icon}
      </button>
    </Tip>
  );
}

/** Two-column split glyph (lucide has no exact match at this weight). */
function SplitIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="size-3.5"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  );
}
