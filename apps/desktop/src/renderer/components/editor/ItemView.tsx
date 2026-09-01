import { Loader2Icon, PlayIcon, TerminalIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SidebarItem } from '../../../host/contract.js';
import { useRepo } from '../../lib/repo-context.js';
import {
  useAgentOptions,
  useAllBranches,
  useSessions,
} from '../../lib/data/queries.js';
import {
  itemBranch,
  itemHasWorktree,
  itemRunning,
  itemSessionName,
  liveSessionName,
} from '../../lib/sidebar/sidebar-model.js';
import {
  clearLaunchMenuRequest,
  launchMenuOpen,
  useLaunchMenuRequested,
} from '../../lib/sidebar/launch-menu-request.js';
import { estimateTerminalGrid } from '../../lib/terminal-grid.js';
import { PrWorkspace } from './lazy-panes.js';
import { Button } from '../ui/button.js';
import { LaunchDialog, type LaunchChoice } from './LaunchDialog.js';
import { useItemLaunch } from './use-item-launch.js';

/**
 * One editor tab for a sidebar item.
 *   • A pull request → the review workspace (PrWorkspace): a rail of
 *     Agent / Files / Comments beside a pane that swaps between the diff
 *     and the agent terminal. Launch/Stop live in the rail.
 *   • A bare worktree → its agent terminal, or a launch call-to-action.
 *
 * Every launch goes through the session menu (LaunchDialog) — it is
 * where the agent for this launch is chosen, whether or not the row has
 * a pull request.
 */

/**
 * A branch can hold two sidebar rows — the pull request, and the
 * worktree that actually owns the agent session. The tab may have been
 * opened from either, so both are folded together here and the pane
 * reads the live session regardless of which row it came from.
 */
function resolveItemState(
  item: SidebarItem,
  sessionRow: SidebarItem | undefined,
  aliveSessions: readonly { name: string }[]
) {
  const rowSessionName =
    itemSessionName(item) ??
    (sessionRow ? itemSessionName(sessionRow) : undefined);
  return {
    sessionName: liveSessionName(rowSessionName, aliveSessions),
    running:
      itemRunning(item) || (sessionRow ? itemRunning(sessionRow) : false),
    hasWorktree: Boolean(rowSessionName) || itemHasWorktree(item),
    pr: item.pr ?? sessionRow?.pr,
  };
}

type ItemState = ReturnType<typeof resolveItemState>;

/**
 * The branch behind the tab and, once the item exists, what it has:
 * a worktree, a live session, a pull request.
 */
function useItemState(
  cwd: string,
  item: SidebarItem | undefined,
  items: SidebarItem[]
): { branch: string; state: ItemState | undefined } {
  const sessions = useSessions(cwd);
  const branch = item ? itemBranch(item) : '';
  const sessionRow = useMemo(
    () => items.find((i) => itemBranch(i) === branch && itemSessionName(i)),
    [items, branch]
  );
  const state = item
    ? resolveItemState(item, sessionRow, sessions.data ?? [])
    : undefined;
  return { branch, state };
}

function launchTarget(branch: string, state: ItemState | undefined) {
  return {
    branch,
    hasWorktree: state?.hasWorktree ?? false,
    pr: state?.pr,
    sessionName: state?.sessionName,
  };
}

/**
 * Default branch for PR-less worktree diffs: main, falling back to
 * master (the host's ref resolver prefers origin/<name>).
 */
function useBaseBranch(cwd: string): string {
  const allBranches = useAllBranches(cwd);
  return useMemo(() => {
    const names = new Set(
      (allBranches.data ?? []).map((b) => b.replace(/^origin\//, ''))
    );
    return names.has('main') ? 'main' : 'master';
  }, [allBranches.data]);
}

/**
 * Whether the session menu is showing. Two things open it: the tab's
 * own Launch button, and a request from outside the tab — the sidebar
 * (Enter, double-click, "Launch agent…") or the palette after a fresh
 * checkout. A request is honored once the item exists; a running agent
 * has nothing to choose, and a tab the user has left must not pop the
 * menu later, so the request is dropped in both cases.
 */
function useLaunchMenu(branch: string, active: boolean, state?: ItemState) {
  const [own, setOwn] = useState(false);
  const running = state?.running ?? false;
  const requested = useLaunchMenuRequested(branch);

  // The dialog portals to <body>, so an inactive-but-mounted
  // (visibility:hidden) pane would leave it floating over whichever
  // tab is active now — leaving the tab dismisses it.
  const [prevActive, setPrevActive] = useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    if (!active) setOwn(false);
  }
  useEffect(() => {
    if (requested && (running || !active)) clearLaunchMenuRequest(branch);
  }, [requested, running, active, branch]);
  // A tab closed before its item arrived (a checkout still in flight)
  // must not leave its request behind for a later visit to the branch.
  useEffect(() => () => clearLaunchMenuRequest(branch), [branch]);

  const open = launchMenuOpen({
    own,
    requested,
    hasItem: state !== undefined,
    running,
  });
  const close = () => {
    setOwn(false);
    clearLaunchMenuRequest(branch);
  };
  return { open, show: () => setOwn(true), close };
}

function Preparing({ itemKey }: { itemKey: string }) {
  // Either the worktree is still being created (optimistic tab) or the
  // item left the sidebar; show a quiet loading state — the pane
  // resolves itself on the next sidebar poll.
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2Icon className="size-6 animate-spin" />
      <p className="text-sm">Preparing {itemKey.replace(/^[a-z]+:/, '')}…</p>
    </div>
  );
}

export function ItemView({
  item,
  items,
  itemKey,
  active,
  onPin,
}: {
  item: SidebarItem | undefined;
  items: SidebarItem[];
  itemKey: string;
  active: boolean;
  onPin: () => void;
}) {
  const { repo } = useRepo();
  const agents = useAgentOptions(repo.cwd).data ?? [];
  const paneRef = useRef<HTMLDivElement>(null);
  const { branch, state } = useItemState(repo.cwd, item, items);
  const baseBranch = useBaseBranch(repo.cwd);
  const menu = useLaunchMenu(branch, active, state);

  // Half-width: a PR launch lands in the split review workspace where
  // the terminal shares the pane with the diff.
  const estimateGrid = () => {
    const el = paneRef.current;
    if (!el) return {};
    return estimateTerminalGrid(el.getBoundingClientRect(), 0.6);
  };
  const { choose, stop, busy } = useItemLaunch(
    repo.cwd,
    launchTarget(branch, state),
    estimateGrid
  );

  if (!item || !state) return <Preparing itemKey={itemKey} />;
  const { sessionName, running, hasWorktree, pr } = state;

  const onLaunchClick = () => {
    onPin();
    menu.show();
  };
  const onChoose = (choice: LaunchChoice) => {
    menu.close();
    onPin();
    choose(choice);
  };
  const dialog = menu.open && (
    <LaunchDialog
      pr={pr}
      branch={branch}
      hasWorktree={hasWorktree}
      agents={agents}
      onChoose={onChoose}
      onClose={menu.close}
    />
  );

  // A pull request is the full review workspace (its own merged header,
  // rail, and content). A bare worktree keeps a simple header + terminal.
  if (pr) {
    return (
      <div ref={paneRef} className="flex h-full min-h-0 min-w-0 flex-col">
        <PrWorkspace
          pr={pr}
          branch={pr.sourceBranch}
          baseBranch={pr.targetBranch}
          sessionName={sessionName}
          running={running}
          active={active}
          busy={busy}
          onLaunch={onLaunchClick}
          onStop={stop}
        />
        {dialog}
      </div>
    );
  }

  // A worktree without a PR: same workspace, gracefully degraded —
  // Agent + Files rail with the diff vs the default branch; no
  // comments/drafts sections. Worktree still being created → loader.
  return (
    <div ref={paneRef} className="flex h-full min-h-0 min-w-0 flex-col">
      {hasWorktree ? (
        <PrWorkspace
          branch={branch}
          baseBranch={baseBranch}
          sessionName={sessionName}
          running={running}
          active={active}
          busy={busy}
          onLaunch={onLaunchClick}
          onStop={stop}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <TerminalIcon className="size-10 opacity-30" />
          <p className="text-base">No worktree for this branch yet.</p>
          <Button onClick={onLaunchClick} disabled={busy}>
            <PlayIcon /> Check out & launch
          </Button>
        </div>
      )}
      {dialog}
    </div>
  );
}
