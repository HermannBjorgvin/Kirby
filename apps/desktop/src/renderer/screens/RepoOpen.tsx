import { useState } from 'react';
import type { RepoInfo } from '../../host/contract.js';

/**
 * First-run screen: point the desktop app at a repository. The native
 * directory dialog arrives later; a typed path keeps the bridge
 * surface testable for now.
 */
export function RepoOpen({ onOpened }: { onOpened: (repo: RepoInfo) => void }) {
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const open = async () => {
    if (!path.trim()) return;
    setOpening(true);
    setError(null);
    try {
      onOpened(await window.kirby.openRepo(path.trim()));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpening(false);
    }
  };

  return (
    <main className="flex h-screen flex-col items-center justify-center gap-6 px-8">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-100">
          Kirby Desktop
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Open a git repository to manage worktrees and reviews
        </p>
      </div>

      <form
        className="flex w-full max-w-xl items-center gap-2"
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
          className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-500"
        />
        <button
          type="submit"
          disabled={opening || !path.trim()}
          className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {opening ? 'Opening…' : 'Open'}
        </button>
      </form>

      {error && (
        <p className="max-w-xl rounded-md border border-red-900 bg-red-950/50 px-3 py-2 font-mono text-sm text-red-300">
          {error}
        </p>
      )}
    </main>
  );
}
