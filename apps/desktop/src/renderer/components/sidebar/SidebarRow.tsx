import {
  CheckCircle2Icon,
  CircleDotIcon,
  CircleIcon,
  GitBranchIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  MessageSquareIcon,
  XCircleIcon,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { ContextMenuItem, SidebarItem } from '../../../host/contract.js';
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
import { cn, errorMessage } from '../../lib/utils.js';
import { Tip } from '../ui/tooltip.js';
import { RemoveWorktreeDialog } from './RemoveWorktreeDialog.js';

export function SidebarRow({
  item,
  active,
  onOpen,
}: {
  item: SidebarItem;
  active: boolean;
  onOpen: (preview: boolean) => void;
}) {
  const { repo } = useRepo();
  const launch = useLaunchAgent(repo.cwd);
  const kill = useKillSession(repo.cwd);
  const create = useCreateWorktree(repo.cwd);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const running = itemRunning(item);
  const hasWorktree = itemHasWorktree(item);
  const branch = itemBranch(item);
  const sessionName = itemSessionName(item);
  const pr = item.pr;
  const title = itemTitle(item);
  const rebasing = item.kind === 'session' && item.session.state === 'rebasing';
  const merged = item.kind === 'session' && item.isMerged;
  const conflictCount =
    (item.kind === 'session' ? item.conflictCount : undefined) ?? 0;

  const onLaunch = () =>
    launch.mutate(
      { branch, intent: 'continue-or-blank' },
      { onError: (e) => toast.error(errorMessage(e)) }
    );
  const onKill = () =>
    sessionName &&
    kill.mutate(sessionName, { onError: (e) => toast.error(errorMessage(e)) });
  const onCheckout = () => {
    onOpen(false); // show the tab right away; it loads while git works
    create.mutate(branch, {
      onSuccess: () => toast.success(`Worktree ready: ${branch}`),
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  // Double-click on an idle worktree row opens the tab AND starts the
  // agent (the TUI's Enter behaviour). PR rows keep dblclick = open;
  // their launch goes through the session/review menu in the tab.
  const onDoubleClick = () => {
    onOpen(false);
    if (item.kind === 'session' && !running) onLaunch();
  };

  /** Native (OS) context menu — built from the item's state. */
  const openContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    const items: ContextMenuItem[] = [
      { id: 'open', label: 'Open' },
      { type: 'separator' },
    ];
    if (hasWorktree && !running)
      items.push({ id: 'launch', label: 'Launch agent' });
    if (hasWorktree && running) items.push({ id: 'kill', label: 'Stop agent' });
    if (!hasWorktree)
      items.push({ id: 'checkout', label: 'Check out as worktree' });
    if (pr)
      items.push({ id: 'open-pr', label: 'Open pull request in browser' });
    items.push({ id: 'copy', label: 'Copy branch name' });
    if (hasWorktree) {
      items.push(
        { type: 'separator' },
        {
          id: 'remove',
          label: 'Remove worktree…',
          danger: true,
        }
      );
    }
    const chosen = await window.kirby.showContextMenu(items);
    switch (chosen) {
      case 'open':
        onOpen(false);
        break;
      case 'launch':
        onLaunch();
        break;
      case 'kill':
        onKill();
        break;
      case 'checkout':
        onCheckout();
        break;
      case 'open-pr':
        if (pr) void window.kirby.openExternal(pr.url);
        break;
      case 'copy':
        void navigator.clipboard.writeText(branch);
        toast.success('Branch name copied');
        break;
      case 'remove':
        setConfirmRemove(true);
        break;
    }
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(true)}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => void openContextMenu(e)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpen(false);
        }}
        className={cn(
          'group flex w-full cursor-default items-center gap-2 py-[3px] pr-2 pl-4 text-base outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring/60',
          active
            ? 'bg-sidebar-active text-sidebar-accent-foreground'
            : 'hover:bg-sidebar-accent'
        )}
      >
        <ItemIcon item={item} running={running} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1.5">
            <span className={cn('truncate', running && 'font-medium')}>
              {title}
            </span>
            {merged && (
              <span className="shrink-0 rounded bg-success/15 px-1 text-[10px] font-medium text-success">
                merged
              </span>
            )}
            {rebasing && (
              <span className="shrink-0 rounded bg-warning/15 px-1 text-[10px] font-medium text-warning">
                rebasing
              </span>
            )}
            {conflictCount > 0 && (
              <span
                className="shrink-0 rounded bg-warning/15 px-1 text-[10px] font-medium text-warning"
                title={`${conflictCount} conflict${
                  conflictCount === 1 ? '' : 's'
                } against the main branch`}
              >
                {conflictCount} conflict{conflictCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {pr && (
            <div
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              title={pr.title}
            >
              <span className="shrink-0 tabular-nums">#{pr.id}</span>
              <span className="min-w-0 truncate">
                {item.kind === 'session' ? pr.title : pr.createdByDisplayName}
              </span>
            </div>
          )}
        </div>
        {pr && <PrMeta pr={pr} />}
      </div>
      {confirmRemove && (
        <RemoveWorktreeDialog
          branch={branch}
          running={running}
          onClose={() => setConfirmRemove(false)}
        />
      )}
    </>
  );
}

function ItemIcon({ item, running }: { item: SidebarItem; running: boolean }) {
  const pr = item.pr;
  let Icon = GitBranchIcon;
  let tone = 'text-muted-foreground';
  if (pr?.isDraft) {
    Icon = GitPullRequestDraftIcon;
  } else if (pr) {
    Icon = GitPullRequestIcon;
    tone = item.kind === 'review-pr' ? reviewTone(item.category) : 'text-info';
  }
  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      <Icon className={cn('size-4', tone)} />
      {running && (
        <span className="absolute -right-0.5 -bottom-0.5 flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-success ring-2 ring-sidebar" />
        </span>
      )}
    </span>
  );
}

function reviewTone(category: 'needs-review' | 'waiting' | 'approved'): string {
  if (category === 'needs-review') return 'text-warning';
  if (category === 'approved') return 'text-success';
  return 'text-muted-foreground';
}

/** Right-aligned compact status cluster: CI, approvals, comments. */
function PrMeta({ pr }: { pr: PullRequestInfo }) {
  const reviewers = pr.reviewers ?? [];
  const approved = reviewers.filter((r) => r.decision === 'approved').length;
  const rejected = reviewers.some((r) => r.decision === 'changes-requested');
  const total = reviewers.length;
  const comments = pr.activeCommentCount ?? 0;
  const ci = pr.buildStatus;

  return (
    <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      {ci && ci !== 'none' && (
        <Tip label={`CI ${ci}`}>
          <span className="flex items-center">
            {ci === 'succeeded' && (
              <CheckCircle2Icon className="size-3.5 text-success" />
            )}
            {ci === 'failed' && (
              <XCircleIcon className="size-3.5 text-destructive" />
            )}
            {ci === 'pending' && (
              <CircleDotIcon className="size-3.5 animate-pulse text-warning" />
            )}
          </span>
        </Tip>
      )}
      {total > 0 && (
        <Tip
          label={
            rejected
              ? 'Changes requested'
              : `${approved} of ${total} reviewers approved`
          }
        >
          <span
            className={cn(
              'flex items-center gap-0.5 tabular-nums',
              rejected
                ? 'text-destructive'
                : approved === total
                ? 'text-success'
                : undefined
            )}
          >
            {rejected ? (
              <XCircleIcon className="size-3" />
            ) : (
              <CircleIcon
                className={cn('size-3', approved === total && 'fill-current')}
              />
            )}
            {approved}/{total}
          </span>
        </Tip>
      )}
      {comments > 0 && (
        <Tip label={`${comments} open comment${comments === 1 ? '' : 's'}`}>
          <span className="flex items-center gap-0.5 tabular-nums">
            <MessageSquareIcon className="size-3" />
            {comments}
          </span>
        </Tip>
      )}
    </div>
  );
}
