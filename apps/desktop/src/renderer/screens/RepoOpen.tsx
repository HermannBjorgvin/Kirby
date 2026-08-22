import { useCallback, useEffect, useState } from 'react';
import type { RecentRepoEntry, RepoInfo } from '../../host/contract.js';
import { VersionBadge } from './VersionBadge.js';

/**
 * Repo gate / switcher. Two panes:
 *   left  — recent projects, one click to reopen
 *   right — add a repository via the native folder picker or a path
 */
export function RepoOpen({ onOpened }: { onOpened: (repo: RepoInfo) => void }) {
  const [recents, setRecents] = useState<RecentRepoEntry[] | null>(null);
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadRecents = useCallback(() => {
    window.kirby
      .listRecentRepos()
      .then(setRecents)
      .catch(() => setRecents([]));
  }, []);

  useEffect(() => {
    loadRecents();
  }, [loadRecents]);

  const open = async (target?: string) => {
    const cwd = target ?? path;
    if (!cwd?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onOpened(await window.kirby.openRepo(cwd.trim()));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      loadRecents();
    } finally {
      setBusy(false);
    }
  };

  const pickFolder = async () => {
    setError(null);
    try {
      const dir = await window.kirby.selectRepoDirectory();
      if (dir) void open(dir);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main className="flex h-screen flex-col px-10 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
          Kirby Desktop
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Pick a repository to manage worktrees and reviews
        </p>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_360px] gap-6">
        {/* ── Left: recent projects ─────────────────────────── */}
        <section className="flex min-h-0 flex-col rounded-lg border border-slate-800 bg-slate-950/50">
          <h2 className="border-b border-slate-800 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Recent projects
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {recents === null && (
              <p className="px-2 py-1 text-sm text-slate-500">Loading…</p>
            )}
            {recents !== null && recents.length === 0 && (
              <p className="px-2 py-1 text-sm text-slate-500">
                Nothing here yet — open a repository to pin it to this list.
              </p>
            )}
            {recents?.map((r) => {
              const name = r.cwd.split('/').filter(Boolean).pop() ?? r.cwd;
              return (
                <div
                  key={r.cwd}
                  className="group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-slate-800/70"
                >
                  <button
                    onClick={() => void open(r.cwd)}
                    disabled={!r.valid || busy}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-sm font-medium text-slate-200">
                      {name}
                      {!r.valid && (
                        <span className="ml-2 rounded bg-slate-800 px-1 py-0.5 align-middle text-[9px] uppercase tracking-wide text-slate-500">
                          missing
                        </span>
                      )}
                    </p>
                    <p className="truncate font-mono text-[11px] text-slate-500">
                      {r.cwd}
                    </p>
                  </button>
                  <button
                    onClick={() => {
                      void window.kirby.forgetRecent(r.cwd).then(loadRecents);
                    }}
                    title="Remove from list"
                    className="invisible shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-600 hover:text-red-400 group-hover:visible"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Right: add repository ─────────────────────────── */}
        <section className="flex flex-col justify-center gap-4 self-start rounded-lg border border-slate-800 bg-slate-950/50 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Add repository
          </h2>

          <button
            onClick={() => void pickFolder()}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-cyan-600 px-4 py-6 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            <span className="text-lg">📁</span>
            {busy ? 'Opening…' : 'Choose folder…'}
          </button>
          <p className="-mt-2 text-center text-[11px] text-slate-500">
            Opens your system folder picker
          </p>

          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-600">
            <span className="h-px flex-1 bg-slate-800" />
            or paste a path
            <span className="h-px flex-1 bg-slate-800" />
          </div>

          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void open();
            }}
          >
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/home/you/projects/my-repo"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-500"
            />
            <button
              type="submit"
              disabled={busy || !path.trim()}
              className="rounded-md border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 hover:border-cyan-600 disabled:opacity-40"
            >
              Open
            </button>
          </form>

          {error && (
            <p className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 font-mono text-xs text-red-300">
              {error}
            </p>
          )}
        </section>
      </div>

      <VersionBadge />
    </main>
  );
}
