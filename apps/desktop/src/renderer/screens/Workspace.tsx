import { PanelLeftOpenIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  Group,
  Panel,
  Separator as PanelSeparator,
} from 'react-resizable-panels';
import { toast } from 'sonner';
import type {
  MenuCommandEvent,
  RepoInfo,
  SidebarItem,
} from '../../host/contract.js';
import { CommandPalette } from '../components/CommandPalette.js';
import { EditorArea } from '../components/editor/EditorArea.js';
import { ShortcutsDialog } from '../components/ShortcutsDialog.js';
import { Sidebar } from '../components/sidebar/Sidebar.js';
import { StatusBar } from '../components/StatusBar.js';
import { TitleBar } from '../components/TitleBar.js';
import { Button } from '../components/ui/button.js';
import { Tip } from '../components/ui/tooltip.js';
import { useRefreshRemote, useSidebarModel } from '../lib/queries.js';
import { RepoProvider, useRepo } from '../lib/repo-context.js';
import { TabsProvider, useTabs } from '../lib/tabs.js';
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
  const items: SidebarItem[] = useMemo(() => model.data ?? [], [model.data]);
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

  // Surface query failures once, not on every poll.
  const lastError = model.error ? errorMessage(model.error) : null;
  useEffect(() => {
    if (lastError) toast.error(lastError, { id: 'sidebar-error' });
  }, [lastError]);

  // Native application menu → renderer actions.
  useEffect(() => {
    const off = window.kirby.onMenuCommand(
      ({ command, arg }: MenuCommandEvent) => {
        switch (command) {
          case 'open-repo':
            onPickRepoFolder();
            break;
          case 'switch-repo':
            onSwitchRepo();
            break;
          case 'new-worktree':
          case 'command-palette':
            setPaletteOpen(true);
            break;
          case 'open-settings':
            tabs.openSettings();
            break;
          case 'close-tab':
            tabs.closeActive();
            break;
          case 'toggle-sidebar':
            toggleSidebar();
            break;
          case 'refresh-remote':
            refresh.mutate(undefined, {
              onError: (e) => toast.error(errorMessage(e)),
            });
            break;
          case 'set-theme':
            if (arg === 'system' || arg === 'light' || arg === 'dark') {
              setThemePreference(arg as ThemePreference);
            }
            break;
          case 'open-url':
            if (arg) void window.kirby.openExternal(arg);
            break;
          case 'show-shortcuts':
            setShortcutsOpen(true);
            break;
          case 'about':
            void window.kirby.showAbout();
            break;
        }
      }
    );
    return off;
  }, [tabs, refresh, onPickRepoFolder, onSwitchRepo]);

  // In-page shortcuts for the web-rendered UI. Anything that is also a
  // native menu accelerator reaches us through onMenuCommand instead,
  // so only palette/⌘K (not a menu item) is handled here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
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
          <div className="flex w-9 shrink-0 flex-col items-center border-r border-border bg-sidebar pt-1">
            <Tip label="Show sidebar (Ctrl B)" side="right">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                aria-label="Show sidebar"
              >
                <PanelLeftOpenIcon />
              </Button>
            </Tip>
          </div>
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
    </div>
  );
}
