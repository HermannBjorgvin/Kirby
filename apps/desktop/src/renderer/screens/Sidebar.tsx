import { useState } from 'react';
import type { WorktreeInfo } from '@kirby/worktree-manager';
import { useHostQuery } from '../hooks/useHostQuery.js';

/**
 * Sidebar: the worktree/session list, mirroring the TUI's left pane.
 * Phase-5 slice covers worktree listing + create/remove; sessions and
 * reviews entries arrive with the terminal pane (phase 6).
 */
export function Sidebar({ repoCwd }: { repoCwd: string }) {
  const worktrees = useHostQuery(() => window.kirby.listWorktrees(), [repoCwd]);
  const branches = useHostQuery(() => window.kirby.listBranches(), [repoCwd]);
  const [newBranch, setNewBranch] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const runAction = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
      worktrees.reload();
      branches.reload();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const existingBranches = new Set(worktrees.data?.map((w) => w.branch));

  return (
    <aside className="flex h-full w-72 flex-col border-r border-slate-800 bg-slate-950/60">
      <div className="border-b border-slate-800 px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Worktrees
        </h2>
        <p className="mt-0.5 truncate font-mono text-xs text-slate-400">
          {repoCwd}
        </p>
      </div>

      {/* Create worktree */}
      <form
        className="flex items-center gap-1.5 border-b border-slate-800 px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newBranch.trim()) return;
          void runAction(async () => {
            await window.kirby.createWorktree(newBranch.trim());
            setNewBranch('');
          });
        }}
      >
        <input
          type="text"
          value={newBranch}
          onChange={(e) => setNewBranch(e.target.value)}
          placeholder="new branch…"
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-500"
        />
        <button
          type="submit"
          disabled={!newBranch.trim()}
          title="Create worktree"
          className="rounded bg-cyan-600 px-2 py-1 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-40"
        >
          +
        </button>
      </form>

      {/* Worktree list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {worktrees.loading && (
          <p className="px-2 py-1 text-sm text-slate-500">Loading…</p>
        )}
        {worktrees.error && (
          <p className="px-2 py-1 font-mono text-xs text-red-400">
            {worktrees.error}
          </p>
        )}
        {worktrees.data?.map((wt) => (
          <WorktreeRow
            key={wt.path}
            wt={wt}
            confirmRemove={confirmRemove === wt.branch}
            onAskRemove={() => setConfirmRemove(wt.branch)}
            onCancelRemove={() => setConfirmRemove(null)}
            onRemove={(force) =>
              void runAction(() =>
                window.kirby.removeWorktree(wt.branch, force)
              )
            }
          />
        ))}
      </div>

      {/* Branches without a worktree */}
      {branches.data && branches.data.length > 0 && (
        <div className="border-t border-slate-800 px-3 py-2">
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
            Other branches
          </h3>
          <div className="max-h-32 space-y-0.5 overflow-y-auto">
            {branches.data
              .filter((b) => !existingBranches.has(b))
              .map((b) => (
                <button
                  key={b}
                  onClick={() =>
                    void runAction(() => window.kirby.createWorktree(b))
                  }
                  title={`Create worktree for ${b}`}
                  className="block w-full truncate rounded px-2 py-1 text-left font-mono text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                >
                  {b}
                </button>
              ))}
          </div>
        </div>
      )}

      {actionError && (
        <p className="border-t border-red-900/60 px-3 py-2 font-mono text-xs text-red-400">
          {actionError}
        </p>
      )}
    </aside>
  );
}

function WorktreeRow({
  wt,
  confirmRemove,
  onAskRemove,
  onCancelRemove,
  onRemove,
}: {
  wt: WorktreeInfo;
  confirmRemove: boolean;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemove: (force: boolean) => void;
}) {
  return (
    <div className="group flex items-center justify-between rounded px-2 py-1.5 hover:bg-slate-800/70">
      <div className="min-w-0">
        <p className="truncate font-mono text-sm text-slate-200">{wt.branch}</p>
        <p className="truncate font-mono text-[10px] text-slate-500">
          {wt.state ?? (wt.bare ? 'bare' : '')}
        </p>
      </div>
      {confirmRemove ? (
        <div className="flex shrink-0 gap-1">
          <button
            onClick={() => onRemove(false)}
            className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] text-white hover:bg-red-500"
          >
            remove
          </button>
          <button
            onClick={() => onRemove(true)}
            title="Force remove (discard changes)"
            className="rounded bg-red-900 px-1.5 py-0.5 text-[10px] text-red-200 hover:bg-red-800"
          >
            force
          </button>
          <button
            onClick={onCancelRemove}
            className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-slate-200"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={onAskRemove}
          title="Remove worktree"
          className="invisible shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-500 hover:text-red-400 group-hover:visible"
        >
          ✕
        </button>
      )}
    </div>
  );
}
