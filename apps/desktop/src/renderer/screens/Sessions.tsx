import { useState } from 'react';
import type { SessionSummary } from '../../host/contract.js';
import type { WorktreeInfo } from '@kirby/worktree-manager';
import { useHostQuery } from '../hooks/useHostQuery.js';
import { SessionTerminal } from './SessionTerminal.js';

/**
 * The Sessions tab: pick a worktree, launch its agent, and interact
 * through the embedded terminal. Mirrors the TUI's main pane — one
 * agent process per worktree, tabbed.
 */
export function Sessions({ repoCwd }: { repoCwd: string }) {
  const worktrees = useHostQuery(() => window.kirby.listWorktrees(), [repoCwd]);
  const sessions = useHostQuery(() => window.kirby.listSessions(), [repoCwd]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Fall back to the newest known session until the user picks one.
  const effectiveActive =
    activeName ??
    (sessions.data && sessions.data.length > 0
      ? sessions.data[sessions.data.length - 1]!.name
      : null);

  const launch = async (wt: WorktreeInfo) => {
    setActionError(null);
    try {
      const { name } = await window.kirby.launchAgent({
        branch: wt.branch,
        intent: 'continue-or-blank',
      });
      sessions.reload();
      setActiveName(name);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const kill = async (name: string) => {
    try {
      await window.kirby.killSession(name);
      sessions.reload();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const runningNames = new Set(
    (sessions.data ?? []).filter((s) => s.running).map((s) => s.name)
  );

  return (
    <div className="flex h-full min-w-0">
      {/* Launch list */}
      <div className="w-60 shrink-0 overflow-y-auto border-r border-slate-800">
        <h2 className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Worktrees
        </h2>
        {worktrees.data?.map((wt) => (
          <div
            key={wt.path}
            className="group flex items-center justify-between px-3 py-1.5 hover:bg-slate-800/50"
          >
            <span className="truncate font-mono text-xs text-slate-300">
              {wt.branch}
              {runningNames.has(wt.branch.replace(/\//g, '-')) && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" />
              )}
            </span>
            {!runningNames.has(wt.branch.replace(/\//g, '-')) && (
              <button
                onClick={() => void launch(wt)}
                className="invisible rounded bg-cyan-600 px-1.5 py-0.5 text-[10px] text-white group-hover:visible"
              >
                launch
              </button>
            )}
          </div>
        ))}
        {actionError && (
          <p className="px-3 py-2 font-mono text-[10px] text-red-400">
            {actionError}
          </p>
        )}
      </div>

      {/* Session tabs + terminal */}
      <div className="flex min-w-0 flex-1 flex-col">
        {(sessions.data?.length ?? 0) > 0 && (
          <div className="flex items-center gap-1 border-b border-slate-800 px-2 py-1">
            {sessions.data!.map((s: SessionSummary) => (
              <div key={s.name} className="flex items-center">
                <button
                  onClick={() => setActiveName(s.name)}
                  className={`rounded px-2.5 py-1 font-mono text-xs ${
                    effectiveActive === s.name
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {s.name}
                  {s.running ? (
                    <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" />
                  ) : (
                    <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-slate-600 align-middle" />
                  )}
                </button>
                {s.running && (
                  <button
                    onClick={() => void kill(s.name)}
                    title="Kill session"
                    className="ml-0.5 px-0.5 text-[10px] text-slate-600 hover:text-red-400"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="relative min-h-0 flex-1">
          {sessions.data?.length ? (
            sessions.data.map((s) => (
              <div
                key={s.name}
                className={`absolute inset-0 ${
                  effectiveActive === s.name ? '' : 'hidden'
                }`}
              >
                <SessionTerminal
                  name={s.name}
                  active={effectiveActive === s.name}
                />
              </div>
            ))
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-slate-500">
                Launch an agent from a worktree to start a session.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
