import {
  GitBranchIcon,
  GitPullRequestIcon,
  SettingsIcon,
  XIcon,
} from 'lucide-react';
import { useDeferredValue, useMemo } from 'react';
import type {
  ContextMenuItem,
  SessionActivitySnapshot,
  SidebarItem,
} from '../../../host/contract.js';
import { usePlanCount } from '../../lib/plan.js';
import { useRepo } from '../../lib/repo-context.js';
import { useSessionActivity } from '../../lib/queries.js';
import {
  itemBranch,
  itemKey,
  itemRunning,
  itemSessionName,
  itemTitle,
} from '../../lib/sidebar-model.js';
import { useTabs, type Tab } from '../../lib/tabs.js';
import { useCloseTabs } from '../../lib/use-close-tabs.js';
import { cn } from '../../lib/utils.js';
import { ErrorBoundary } from '../ErrorBoundary.js';
import { SettingsView } from '../settings/SettingsView.js';
import { EmptyState } from './EmptyState.js';
import { ItemView } from './ItemView.js';

/**
 * Tab strip + stacked panes. Every open tab stays mounted (panes are
 * absolutely positioned and hidden with `visibility`, not unmounted)
 * so running terminals keep their scrollback and PR views keep their
 * scroll position when you switch away and back.
 */
export function EditorArea({
  items,
  onOpenPalette,
}: {
  items: SidebarItem[];
  onOpenPalette: () => void;
}) {
  const { repo } = useRepo();
  const tabs = useTabs();
  const closer = useCloseTabs(items);
  const activity = useSessionActivity(repo.cwd);
  const byKey = useMemo(
    () => new Map(items.map((i) => [itemKey(i), i])),
    [items]
  );
  const byBranch = useMemo(
    () => new Map(items.map((i) => [itemBranch(i), i])),
    [items]
  );

  /**
   * The sidebar item a tab is showing.
   *
   * Falls back to the tab's stamped branch when its key doesn't resolve:
   * an item re-keys the moment a PR appears (`branch:x` → `pr:42`), and
   * `sync-items` only catches up in an effect — one render happens
   * first. Looking up by key alone would make that render treat the tab
   * as itemless, which unmounts the pane and destroys a live agent's
   * terminal (its scrollback only partly recoverable from the host's
   * ring buffer) twice over a PR's life.
   */
  const itemFor = (tab: Tab): SidebarItem | undefined => {
    if (tab.kind !== 'item') return undefined;
    return (
      byKey.get(tab.itemKey) ??
      (tab.branch ? byBranch.get(tab.branch) : undefined)
    );
  };

  const sessionNameFor = (tab: Tab): string | undefined => {
    const item = itemFor(tab);
    if (!item) return undefined;
    const branch = itemBranch(item);
    for (const i of items) {
      const name = itemSessionName(i);
      if (name && itemBranch(i) === branch) return name;
    }
    return undefined;
  };

  // The tab strip tracks the live state so clicks feel instant; the
  // panes below follow a *deferred* copy, so mounting/unmounting a
  // pane runs as an interruptible background render instead of
  // blocking the click. No blanket overlay: the virtualized diff and
  // the rail each show their own skeletons, and the terminal renders
  // in the first frame.
  const paneTabs = useDeferredValue(tabs.tabs);
  const paneActiveId = useDeferredValue(tabs.activeId);

  // Mount policy: the active tab plus any tab whose branch has a PTY
  // session (its terminal must stay mounted to keep scrollback). Other
  // panes unmount while inactive — a diff pane can hold tens of
  // thousands of nodes, and keeping several alive made every
  // interaction (typing, closing tabs) pay for all of them.
  const hasSession = (tab: Tab): boolean => sessionNameFor(tab) != null;

  if (tabs.tabs.length === 0) {
    return (
      <EmptyState onOpenPalette={onOpenPalette} hasItems={items.length > 0} />
    );
  }

  const confirmDialog = closer.confirmDialog;

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-tab [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.tabs.map((tab) => {
          const sessionName = sessionNameFor(tab);
          return (
            <TabButton
              key={tab.id}
              tab={tab}
              item={itemFor(tab)}
              active={tab.id === tabs.activeId}
              closer={closer}
              snapshot={sessionName ? activity.data?.[sessionName] : undefined}
            />
          );
        })}
        <div className="flex-1" />
      </div>
      <div className="relative min-h-0 flex-1">
        {paneTabs.map((tab) => {
          const active = tab.id === paneActiveId;
          if (!active && !hasSession(tab)) return null;
          return (
            <div
              key={tab.id}
              aria-hidden={!active}
              className={cn(
                'absolute inset-0 flex min-h-0 flex-col',
                !active && 'invisible'
              )}
            >
              <ErrorBoundary resetKey={tab.id}>
                {tab.kind === 'settings' ? (
                  <SettingsView />
                ) : (
                  <ItemView
                    item={itemFor(tab)}
                    items={items}
                    itemKey={tab.itemKey}
                    active={active}
                    onPin={() => tabs.pin(tab.id)}
                  />
                )}
              </ErrorBoundary>
            </div>
          );
        })}
      </div>
      {confirmDialog}
    </div>
  );
}

/** The tab's kind icon, with the agent's state hung off its corner. */
function TabIcon({
  Icon,
  running,
  snapshot,
}: {
  Icon: typeof SettingsIcon;
  running: boolean;
  snapshot: SessionActivitySnapshot | undefined;
}) {
  return (
    <span className="relative flex shrink-0">
      <Icon className="size-4" />
      {snapshot?.active ? (
        <span className="absolute -right-1 -bottom-1 flex items-center justify-center rounded-full bg-tab-active p-0.5">
          <span className="agent-spinner size-2.5 rounded-full" />
        </span>
      ) : running ? (
        <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-success ring-2 ring-tab-active" />
      ) : null}
    </span>
  );
}

function TabButton({
  tab,
  item,
  active,
  closer,
  snapshot,
}: {
  tab: Tab;
  item: SidebarItem | undefined;
  active: boolean;
  closer: ReturnType<typeof useCloseTabs>;
  snapshot: SessionActivitySnapshot | undefined;
}) {
  const tabs = useTabs();
  const label =
    tab.kind === 'settings'
      ? 'Settings'
      : item
      ? itemTitle(item)
      : tab.itemKey.replace(/^[a-z]+:/, '');
  const running = item ? itemRunning(item) : false;
  // A plan is built inside a tab and then navigated away from, so the
  // count has to be visible from wherever the user ends up.
  const planCount = usePlanCount(item?.pr?.id);
  const Icon =
    tab.kind === 'settings'
      ? SettingsIcon
      : item?.pr
      ? GitPullRequestIcon
      : GitBranchIcon;

  const openContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    const items: ContextMenuItem[] = [
      { id: 'close', label: 'Close' },
      {
        id: 'close-others',
        label: 'Close Others',
        enabled: tabs.tabs.length > 1,
      },
      { id: 'close-all', label: 'Close All' },
    ];
    if (tab.preview) {
      items.push({ type: 'separator' }, { id: 'pin', label: 'Keep Open' });
    }
    const chosen = await window.kirby.showContextMenu(items);
    if (chosen === 'close') closer.close(tab.id);
    else if (chosen === 'close-others') closer.closeOthers(tab.id);
    else if (chosen === 'close-all') closer.closeAll();
    else if (chosen === 'pin') tabs.pin(tab.id);
  };

  return (
    <div
      role="tab"
      aria-selected={active}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/kirby-tab', tab.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('text/kirby-tab')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }
      }}
      onDrop={(e) => {
        const dragged = e.dataTransfer.getData('text/kirby-tab');
        if (!dragged || dragged === tab.id) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const side =
          e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
        tabs.moveTab(dragged, tab.id, side);
      }}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          closer.close(tab.id);
        }
      }}
      onClick={() => tabs.activate(tab.id)}
      onDoubleClick={() => tabs.pin(tab.id)}
      onContextMenu={(e) => void openContextMenu(e)}
      className={cn(
        'group relative flex h-full max-w-56 min-w-28 cursor-default items-center gap-2 border-r border-border pr-1.5 pl-3 text-base transition-colors select-none',
        active
          ? 'bg-tab-active text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        // The agent finished a work streak and nobody has looked yet.
        snapshot?.flashing && !active && 'tab-attention'
      )}
    >
      {active && <span className="absolute inset-x-0 top-0 h-px bg-primary" />}
      <TabIcon Icon={Icon} running={running} snapshot={snapshot} />
      <span className={cn('min-w-0 flex-1 truncate', tab.preview && 'italic')}>
        {label}
      </span>
      {planCount > 0 && (
        <span
          aria-label={`${planCount} comment${
            planCount === 1 ? '' : 's'
          } in the plan`}
          className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] font-medium tabular-nums text-primary"
        >
          {planCount}
        </span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          closer.close(tab.id);
        }}
        aria-label="Close tab"
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100',
          active && 'opacity-100'
        )}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
