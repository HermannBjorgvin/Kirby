import { useEffect, useMemo, useRef, useState } from 'react';
import type { KirbyHostApi, RepoInfo, SidebarItem } from '../host/contract.js';
import { RepoOpen } from './screens/RepoOpen.js';
import { UnifiedSidebar } from './screens/UnifiedSidebar.js';
import { ContentPane } from './screens/ContentPane.js';
import { Settings } from './screens/Settings.js';
import { VersionBadge } from './screens/VersionBadge.js';
import { useHostQuery } from './hooks/useHostQuery.js';
import { itemKey } from './lib/sidebar-model.js';

declare global {
  interface Window {
    kirby: KirbyHostApi;
  }
}

export function App() {
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    window.kirby
      .getRepo()
      .then(setRepo)
      .finally(() => setChecked(true));
  }, []);

  if (!checked) {
    return (
      <main className="flex h-screen items-center justify-center">
        <p className="animate-pulse font-mono text-sm text-slate-500">
          connecting to host…
        </p>
      </main>
    );
  }

  if (!repo) return <RepoOpen onOpened={setRepo} />;

  return (
    <RepoWorkspace
      key={repo.cwd}
      repo={repo}
      onSwitchRepo={() => setRepo(null)}
    />
  );
}

function RepoWorkspace({
  repo,
  onSwitchRepo,
}: {
  repo: RepoInfo;
  onSwitchRepo: () => void;
}) {
  const model = useHostQuery(() => window.kirby.getSidebarModel(), [repo.cwd]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem('kirby.sidebarWidth'));
    return saved >= 200 && saved <= 640 ? saved : 288;
  });
  const [sidebarHidden, setSidebarHidden] = useState(false);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(640, Math.max(200, startW + (ev.clientX - startX)));
      setSidebarWidth(w);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      localStorage.setItem(
        'kirby.sidebarWidth',
        String(sidebarWidthRef.current)
      );
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const items: SidebarItem[] = useMemo(() => model.data ?? [], [model.data]);
  const sidebarWidthRef = useRef(sidebarWidth);
  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  // Poll for sidebar changes (running state, new PRs) like the TUI's
  // background sync.
  useEffect(() => {
    const id = setInterval(() => model.reload(), 5000);
    return () => clearInterval(id);
  }, [model]);

  // Keep a valid selection as the list changes.
  const selectedItem = useMemo(() => {
    if (items.length === 0) return undefined;
    const found = items.find((it) => itemKey(it) === selectedKey);
    return found ?? items[0];
  }, [items, selectedKey]);
  const effectiveKey = selectedItem ? itemKey(selectedItem) : null;

  const runAction = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
      model.reload();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex h-screen">
      {sidebarHidden ? (
        <button
          onClick={() => setSidebarHidden(false)}
          title="Show sidebar"
          className="h-full w-6 shrink-0 border-r border-slate-800 bg-slate-950/60 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
        >
          »
        </button>
      ) : (
        <>
          <UnifiedSidebar
            items={items}
            loading={model.loading}
            selectedKey={effectiveKey}
            onSelect={setSelectedKey}
            onCreateWorktree={(branch) =>
              void runAction(() => window.kirby.createWorktree(branch))
            }
            onOpenSettings={() => setShowSettings(true)}
            onSwitchRepo={onSwitchRepo}
            onToggleHide={() => setSidebarHidden(true)}
            width={sidebarWidth}
            repoCwd={repo.cwd}
            actionError={actionError ?? model.error}
          />
          <div
            onMouseDown={startResize}
            title="Drag to resize"
            className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-cyan-600/50"
          />
        </>
      )}

      <div className="min-w-0 flex-1">
        {showSettings ? (
          <div className="flex h-full flex-col">
            <div className="border-b border-slate-800 px-4 py-2">
              <button
                onClick={() => setShowSettings(false)}
                className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                ← Back
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <Settings repoCwd={repo.cwd} />
            </div>
          </div>
        ) : (
          <ContentPane item={selectedItem} onChanged={() => model.reload()} />
        )}
      </div>

      <VersionBadge />
    </div>
  );
}
