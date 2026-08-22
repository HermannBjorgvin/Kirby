import { useEffect, useState } from 'react';
import type { KirbyHostApi, RepoInfo } from '../host/contract.js';
import { RepoOpen } from './screens/RepoOpen.js';
import { Sidebar } from './screens/Sidebar.js';
import { Reviews } from './screens/Reviews.js';
import { Sessions } from './screens/Sessions.js';
import { VersionBadge } from './screens/VersionBadge.js';

declare global {
  interface Window {
    kirby: KirbyHostApi;
  }
}

type MainTab = 'reviews' | 'sessions';

/**
 * App shell: repo-open gate, then sidebar + tabbed main pane.
 */
export function App() {
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState<MainTab>('reviews');

  // Restore the previously opened repo (the host remembers it for the
  // session; this also covers electron reloads during development).
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

  if (!repo) {
    return <RepoOpen onOpened={setRepo} />;
  }

  return (
    <div className="flex h-screen">
      <Sidebar repoCwd={repo.cwd} onSwitchRepo={() => setRepo(null)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <nav className="flex items-center gap-1 border-b border-slate-800 px-3 py-1.5">
          {(['reviews', 'sessions'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1 text-xs font-medium capitalize ${
                tab === t
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t}
            </button>
          ))}
          <span className="ml-auto font-mono text-[10px] text-slate-600">
            {repo.providerId ?? 'no provider'}
            {repo.vcsConfigured ? '' : ' (not configured)'}
          </span>
        </nav>
        <div className="min-h-0 flex-1">
          {tab === 'reviews' ? (
            <Reviews repoCwd={repo.cwd} vcsConfigured={repo.vcsConfigured} />
          ) : (
            <Sessions repoCwd={repo.cwd} />
          )}
        </div>
      </div>
      <VersionBadge />
    </div>
  );
}
