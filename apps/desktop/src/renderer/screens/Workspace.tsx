import { useEffect, useMemo, useState } from 'react';
import {
  Group,
  Panel,
  Separator as PanelSeparator,
} from 'react-resizable-panels';
import { toast } from 'sonner';
import type {
  MenuCommand,
  MenuCommandEvent,
  RepoInfo,
  SidebarItem,
} from '../../host/contract.js';
import { AttentionRail } from '../components/AttentionRail.js';
import {
  applyPendingRemovals,
  itemBranch,
  itemKey,
  itemRunning,
  itemSessionName,
} from '../lib/sidebar-model.js';
import { CommandPalette } from '../components/CommandPalette.js';
import { EditorArea } from '../components/editor/EditorArea.js';
import { ShortcutsDialog } from '../components/ShortcutsDialog.js';
import { Sidebar } from '../components/sidebar/Sidebar.js';
import { StatusBar } from '../components/StatusBar.js';
import { TitleBar } from '../components/TitleBar.js';
import { useQueryClient } from '@tanstack/react-query';
import { keys } from '../lib/query-keys.js';
import { useSidebarModel } from '../lib/queries.js';
import { useRefreshRemote, useRemovingBranches } from '../lib/mutations.js';
import { RepoProvider, useRepo } from '../lib/repo-context.js';
import { TabsProvider, useTabs, type ItemEntry } from '../lib/tabs.js';
import { useCloseTabs } from '../lib/use-close-tabs.js';
import { setThemePreference, type ThemePreference } from '../lib/theme.js';
import { errorMessage } from '../lib/utils.js';

const SIDEBAR_KEY = 'kirby.sidebar.hidden';

/**
 * The main window once a repo is open: title bar, resizable sidebar +
 * tabbed editor area, status bar. Owns global shortcuts, native menu
 * command routing and the command palette.
 */
export function Workspace({
  repo,
  onSwitchRepo,
  onOpenRepo,
  onPickRepoFolder,
}: {
  repo: RepoInfo;
  onSwitchRepo: () => void;
  onOpenRepo: (cwd: string) => void;
  onPickRepoFolder: () => void;
}) {
  const ctx = useMemo(
    () => ({ repo, switchRepo: onSwitchRepo }),
    [repo, onSwitchRepo]
  );
  return (
    <RepoProvider value={ctx}>
      <TabsProvider>
        <WorkspaceInner
          onSwitchRepo={onSwitchRepo}
          onOpenRepo={onOpenRepo}
          onPickRepoFolder={onPickRepoFolder}
        />
      </TabsProvider>
    </RepoProvider>
  );
}

function WorkspaceInner({
  onSwitchRepo,
  onOpenRepo,
  onPickRepoFolder,
}: {
  onSwitchRepo: () => void;
  onOpenRepo: (cwd: string) => void;
  onPickRepoFolder: () => void;
}) {
  const { repo } = useRepo();
  const tabs = useTabs();
  const model = useSidebarModel(repo.cwd);
  const refresh = useRefreshRemote(repo.cwd);
  // Worktrees being removed drop out of the model right away — every
  // consumer below (sidebar, tabs, attention rail) derives from this one
  // list, so the whole window reacts on confirm rather than on the git
  // round-trip.
  const removing = useRemovingBranches();
  const items: SidebarItem[] = useMemo(
    () => applyPendingRemovals(model.data ?? [], removing),
    [model.data, removing]
  );
  const closer = useCloseTabs(items);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) === '1'
  );

  const toggleSidebar = () =>
    setSidebarHidden((h) => {
      localStorage.setItem(SIDEBAR_KEY, h ? '0' : '1');
      return !h;
    });

  // The sidebar as the tab model sees it.
  const entries: ItemEntry[] = useMemo(
    () =>
      items.map((i) => ({
        itemKey: itemKey(i),
        branch: itemBranch(i),
        running: itemRunning(i),
        sessionName: itemSessionName(i),
      })),
    [items]
  );

  // The one place the two stores are reconciled. The reducer follows
  // items whose key changed (a worktree grows a PR: branch:x → pr:n,
  // and back when it closes), opens a tab for each newly running
  // agent, and pins preview tabs that have an agent behind them —
  // atomically, so no render ever sees a half-reconciled strip.
  //
  // `tabs` (the whole api, which changes identity on every dispatch)
  // is the dependency on purpose: opening a preview tab is itself a
  // reason to re-run, since the branch it lands on may already be
  // live. Re-running settles — every step above is idempotent and
  // returns the same state object once there is nothing left to do.
  useEffect(() => {
    tabs.syncItems(entries);
  }, [tabs, entries]);

  // The host's remote sync loop toasts its events (auto-deleted merged
  // branch, blocked auto-delete) and the sidebar refetches to match.
  const qc = useQueryClient();
  useEffect(() => {
    const off = window.kirby.onSyncNotice(({ message, kind }) => {
      if (kind === 'success') toast.success(message);
      else toast.warning(message);
      void qc.invalidateQueries({ queryKey: keys.sidebar(repo.cwd) });
    });
    return off;
  }, [qc, repo.cwd]);

  // Surface query failures once, not on every poll.
  const lastError = model.error ? errorMessage(model.error) : null;
  useEffect(() => {
    if (lastError) toast.error(lastError, { id: 'sidebar-error' });
  }, [lastError]);

  // Native application menu → renderer actions.
  useEffect(() => {
    // A full Record rather than a switch: adding a MenuCommand is then
    // a type error here until it has a handler, which is the same
    // guarantee the exhaustive switch gave, minus the branching.
    const handlers: Record<MenuCommand, (arg?: string) => void> = {
      'open-repo': onPickRepoFolder,
      'switch-repo': onSwitchRepo,
      'new-worktree': () => setPaletteOpen(true),
      'command-palette': () => setPaletteOpen(true),
      'open-settings': () => tabs.openSettings(),
      'close-tab': () => closer.closeActive(),
      'toggle-sidebar': toggleSidebar,
      'refresh-remote': () =>
        refresh.mutate(undefined, {
          onError: (e) => toast.error(errorMessage(e)),
        }),
      'set-theme': (arg) => {
        if (arg === 'system' || arg === 'light' || arg === 'dark') {
          setThemePreference(arg as ThemePreference);
        }
      },
      'open-url': (arg) => {
        if (arg) void window.kirby.openExternal(arg);
      },
      'show-shortcuts': () => setShortcutsOpen(true),
      about: () => void window.kirby.showAbout(),
    };
    const off = window.kirby.onMenuCommand(
      ({ command, arg }: MenuCommandEvent) => handlers[command](arg)
    );
    return off;
  }, [tabs, closer, refresh, onPickRepoFolder, onSwitchRepo]);

  // In-page shortcuts for the web-rendered UI. Anything that is also a
  // native menu accelerator reaches us through onMenuCommand instead;
  // handled here: palette (⌘K). Tab cycling was removed for now — it
  // collided with Shift+Tab inside agent terminals (Claude Code's mode
  // switch).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar
        repo={repo}
        onSwitchRepo={onSwitchRepo}
        onOpenRepo={onOpenRepo}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenSettings={() => tabs.openSettings()}
      />

      <div className="flex min-h-0 flex-1">
        {sidebarHidden && (
          <AttentionRail items={items} onReveal={toggleSidebar} />
        )}
        <Group
          orientation="horizontal"
          className="min-h-0 flex-1"
          id="workspace"
        >
          {!sidebarHidden && (
            <>
              <Panel
                id="sidebar"
                defaultSize="280px"
                minSize="200px"
                maxSize="45%"
                className="min-w-0"
              >
                <Sidebar
                  items={items}
                  loading={model.isLoading}
                  error={null}
                  onNewWorktree={() => setPaletteOpen(true)}
                  onCollapse={toggleSidebar}
                />
              </Panel>
              <PanelSeparator className="relative w-px bg-border transition-colors after:absolute after:inset-y-0 after:-left-1 after:w-2 hover:bg-primary data-[resize-handle-state=drag]:bg-primary" />
            </>
          )}
          <Panel id="editor" minSize="40%" className="min-w-0">
            <EditorArea
              items={items}
              onOpenPalette={() => setPaletteOpen(true)}
            />
          </Panel>
        </Group>
      </div>

      <StatusBar items={items} onOpenSettings={() => tabs.openSettings()} />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={items}
        onToggleSidebar={toggleSidebar}
        onSwitchRepo={onSwitchRepo}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {closer.confirmDialog}
    </div>
  );
}
