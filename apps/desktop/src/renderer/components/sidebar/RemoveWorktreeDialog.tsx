import { AlertTriangleIcon } from 'lucide-react';
import { useRepo } from '../../lib/repo-context.js';
import {
  useBranchRemovalSafety,
  useRemoveWorktree,
} from '../../lib/queries.js';
import { useTabs } from '../../lib/tabs.js';
import { Button } from '../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.js';

/**
 * Confirm + execute worktree removal. Asks the host whether the branch
 * is safe to delete first (unpushed commits, open PR, …) and surfaces
 * the reason with a force option, mirroring the TUI's delete modal.
 */
export function RemoveWorktreeDialog({
  branch,
  itemKey,
  running,
  onClose,
}: {
  branch: string;
  /** The sidebar item's key — a PR-backed worktree's tab is keyed by
   *  PR id, not branch, so the key can't be derived from the branch. */
  itemKey: string;
  running: boolean;
  onClose: () => void;
}) {
  const { repo } = useRepo();
  const tabs = useTabs();
  const remove = useRemoveWorktree(repo.cwd);
  // `undefined` until the host answers — the confirm button stays
  // disabled for as long as that is the case.
  const { data: safety } = useBranchRemovalSafety(repo.cwd, branch);

  // Only these safety reasons may be overridden, matching the TUI:
  // protected branches and in-progress rebases are hard refusals.
  const overridable =
    safety?.safe === false &&
    (safety.reason === 'uncommitted changes' ||
      safety.reason === 'not pushed to upstream');

  // Optimistic: the tab and this dialog close on confirm, and the
  // sidebar row hides itself for as long as the mutation is pending
  // (useRemovingBranches). Removal virtually always succeeds; if it
  // doesn't, the row reappears by itself and the error is toasted from
  // the mutation, which outlives this component.
  const doRemove = (force: boolean) => {
    // Look the tab up by item key rather than rebuilding its id: a tab
    // keeps the id it was opened with even after `sync-items` re-keys
    // it (worktree `branch:x` → `pr:42` once a PR appears), so the
    // reconstructed id would miss and leave the tab open on a worktree
    // that no longer exists.
    const tab = tabs.tabs.find(
      (t) => t.kind === 'item' && t.itemKey === itemKey
    );
    if (tab) tabs.close(tab.id);
    onClose();
    remove.mutate({ branch, force });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove worktree?</DialogTitle>
          <DialogDescription>
            This deletes the worktree for{' '}
            <span className="font-mono text-foreground">{branch}</span>
            {running ? ' and stops its running agent' : ''}. The branch is
            deleted too unless git refuses.
          </DialogDescription>
        </DialogHeader>

        {safety && !safety.safe && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
            <div>
              <p className="font-medium">
                {overridable ? 'Not safe to delete' : 'Cannot delete'}
              </p>
              <p className="text-muted-foreground">{safety.reason}</p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {safety?.safe !== false ? (
            <Button
              variant="destructive"
              disabled={!safety}
              onClick={() => doRemove(false)}
            >
              Remove
            </Button>
          ) : overridable ? (
            <Button variant="destructive" onClick={() => doRemove(true)}>
              Force remove
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
