import { Loader2Icon, PlayIcon, TerminalIcon } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { SidebarItem } from '../../../host/contract.js';
import { useRepo } from '../../lib/repo-context.js';
import { useAllBranches, useSessions } from '../../lib/data/queries.js';
import {
  useCreateWorktree,
  useKillSession,
  useLaunchAgent,
  useLaunchReview,
} from '../../lib/data/mutations.js';
import {
  itemBranch,
  itemHasWorktree,
  itemRunning,
  itemSessionName,
  liveSessionName,
} from '../../lib/sidebar/sidebar-model.js';
import { estimateTerminalGrid } from '../../lib/terminal-grid.js';
import { errorMessage } from '../../lib/utils.js';
import { PrWorkspace } from '../review/PrWorkspace.js';
import { Button } from '../ui/button.js';
import { LaunchDialog, type LaunchChoice } from './LaunchDialog.js';

/**
 * One editor tab for a sidebar item.
 *   • A pull request → the review workspace (PrWorkspace): a rail of
 *     Agent / Files / Comments beside a pane that swaps between the diff
 *     and the agent terminal. Launch/Stop live in the rail.
 *   • A bare worktree → its agent terminal, or a launch call-to-action.
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
  const launch = useLaunchAgent(repo.cwd);
  const launchReview = useLaunchReview(repo.cwd);
  const kill = useKillSession(repo.cwd);
  const sessions = useSessions(repo.cwd);
  const create = useCreateWorktree(repo.cwd);
  const paneRef = useRef<HTMLDivElement>(null);
  const [launchMenu, setLaunchMenu] = useState(false);

  // The launch dialog portals to <body>, so an inactive-but-mounted
  // (visibility:hidden) pane would leave it floating over whichever
  // tab is active now — leaving the tab dismisses it.
  const [prevActive, setPrevActive] = useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    if (!active) setLaunchMenu(false);
  }

  const branch = item ? itemBranch(item) : '';
  const sessionRow = useMemo(
    () => items.find((i) => itemBranch(i) === branch && itemSessionName(i)),
    [items, branch]
  );
  // Default branch for PR-less worktree diffs: main, falling back to
  // master (the host's ref resolver prefers origin/<name>).
  const allBranches = useAllBranches(repo.cwd);
  const baseBranch = useMemo(() => {
    const names = new Set(
      (allBranches.data ?? []).map((b) => b.replace(/^origin\//, ''))
    );
    return names.has('main') ? 'main' : 'master';
  }, [allBranches.data]);

  if (!item) {
    // Either the worktree is still being created (optimistic tab) or
    // the item left the sidebar; show a quiet loading state — the pane
    // resolves itself on the next sidebar poll.
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2Icon className="size-6 animate-spin" />
        <p className="text-sm">Preparing {itemKey.replace(/^[a-z]+:/, '')}…</p>
      </div>
    );
  }

  const { sessionName, running, hasWorktree, pr } = resolveItemState(
    item,
    sessionRow,
    sessions.data ?? []
  );

  // Half-width: a PR launch lands in the split review workspace where
  // the terminal shares the pane with the diff.
  const estimateGrid = () => {
    const el = paneRef.current;
    if (!el) return {};
    return estimateTerminalGrid(el.getBoundingClientRect(), 0.6);
  };

  const startPlainSession = async () => {
    onPin();
    if (!hasWorktree) {
      const id = toast.loading(`Checking out ${branch}…`);
      try {
        await create.mutateAsync(branch);
        toast.success(`Worktree ready: ${branch}`, { id });
      } catch (e) {
        toast.error(errorMessage(e), { id });
        return;
      }
    }
    launch.mutate(
      { branch, intent: 'continue-or-blank', ...estimateGrid() },
      { onError: (e) => toast.error(errorMessage(e)) }
    );
  };

  const onLaunchClick = () => {
    onPin();
    if (pr) setLaunchMenu(true);
    else void startPlainSession();
  };

  const onChoose = (choice: LaunchChoice) => {
    setLaunchMenu(false);
    if (choice.kind === 'session') {
      void startPlainSession();
      return;
    }
    if (!pr) return;
    const id = toast.loading(
      hasWorktree
        ? 'Starting review…'
        : `Checking out ${branch} and starting review…`
    );
    launchReview.mutate(
      { pr, instruction: choice.instruction, ...estimateGrid() },
      {
        onSuccess: () => toast.success('Review agent started', { id }),
        onError: (e) => toast.error(errorMessage(e), { id }),
      }
    );
  };

  const doKill = () =>
    sessionName &&
    kill.mutate(sessionName, { onError: (e) => toast.error(errorMessage(e)) });

  const busy = launch.isPending || create.isPending || launchReview.isPending;

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
          onStop={doKill}
        />
        {launchMenu && (
          <LaunchDialog
            pr={pr}
            hasWorktree={hasWorktree}
            onChoose={onChoose}
            onClose={() => setLaunchMenu(false)}
          />
        )}
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
          onStop={doKill}
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
    </div>
  );
}
