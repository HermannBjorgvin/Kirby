import { useState } from 'react';
import type { SidebarItem } from '../../host/contract.js';
import { itemRunning, itemTitle } from '../lib/sidebar-model.js';
import { SessionTerminal } from './SessionTerminal.js';
import { PrReview } from './PrReview.js';

/**
 * The single content pane, driven by the selected sidebar item —
 * mirroring the TUI's one-pane model:
 *   • a running session  → its agent terminal
 *   • a worktree/PR idle → launch/checkout action + PR review (if any)
 *   • an orphan/review PR → the PR review + "check out & launch"
 */
export function ContentPane({
  item,
  onChanged,
}: {
  item: SidebarItem | undefined;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!item) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-slate-500">
          Select a worktree or pull request.
        </p>
      </div>
    );
  }

  const running = itemRunning(item);
  const pr = item.pr;
  const branch =
    item.kind === 'session'
      ? item.branch ?? item.session.name
      : item.pr.sourceBranch;
  const sessionName = item.kind === 'session' ? item.session.name : undefined;
  const hasWorktree = item.kind === 'session';

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const launch = () =>
    run(() =>
      window.kirby.launchAgent({ branch, intent: 'continue-or-blank' })
    );

  const checkoutAndLaunch = () =>
    run(async () => {
      await window.kirby.createWorktree(branch);
      await window.kirby.launchAgent({ branch, intent: 'continue-or-blank' });
    });

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-slate-100">
            {pr && (
              <span className="mr-1.5 font-mono text-cyan-400">#{pr.id}</span>
            )}
            {itemTitle(item)}
          </h3>
          <p className="truncate font-mono text-[11px] text-slate-500">
            {pr ? `${pr.sourceBranch} → ${pr.targetBranch}` : branch}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {pr && (
            <a
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              className="rounded px-2 py-1 text-xs text-slate-400 hover:text-cyan-400"
            >
              open ↗
            </a>
          )}
          {!running && hasWorktree && (
            <button
              onClick={() => void launch()}
              disabled={busy}
              className="rounded bg-cyan-600 px-3 py-1 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {busy ? '…' : 'Launch agent'}
            </button>
          )}
          {!running && !hasWorktree && (
            <button
              onClick={() => void checkoutAndLaunch()}
              disabled={busy}
              className="rounded bg-cyan-600 px-3 py-1 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {busy ? '…' : 'Check out & launch'}
            </button>
          )}
        </div>
      </header>

      {error && (
        <p className="border-b border-red-900/60 px-4 py-2 font-mono text-xs text-red-400">
          {error}
        </p>
      )}

      {/* Body */}
      {running && sessionName ? (
        <SessionTerminal name={sessionName} active />
      ) : pr ? (
        <PrReview pr={pr} />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-slate-500">
            No agent running for this worktree. Launch one to start.
          </p>
        </div>
      )}
    </div>
  );
}
