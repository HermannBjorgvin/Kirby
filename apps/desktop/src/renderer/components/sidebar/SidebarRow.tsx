import { useState } from 'react';
import { toast } from 'sonner';
import type { SidebarItem } from '../../../host/contract.js';
import { useRepo } from '../../lib/repo-context.js';
import {
  useCreateWorktree,
  useKillSession,
  useOpenInEditor,
  useLaunchAgent,
} from '../../lib/mutations.js';
import {
  itemBranch,
  itemHasWorktree,
  itemKey,
  itemRunning,
  itemSessionName,
  itemTitle,
} from '../../lib/sidebar-model.js';
import { sidebarRowMenuItems } from '../../lib/sidebar-row-menu.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { PrMeta } from './PrMeta.js';
import { RemoveWorktreeDialog } from './RemoveWorktreeDialog.js';
import { ItemIcon } from './SidebarRowIcon.js';

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
  const openEditor = useOpenInEditor();
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
    const chosen = await window.kirby.showContextMenu(
      sidebarRowMenuItems({ hasWorktree, running, hasPr: Boolean(pr) })
    );
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
      case 'open-editor':
        openEditor.mutate(branch, {
          onSuccess: ({ editor }) => toast.success(`Opened in ${editor}`),
          onError: (e) => toast.error(errorMessage(e)),
        });
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
          itemKey={itemKey(item)}
          running={running}
          onClose={() => setConfirmRemove(false)}
        />
      )}
    </>
  );
}
