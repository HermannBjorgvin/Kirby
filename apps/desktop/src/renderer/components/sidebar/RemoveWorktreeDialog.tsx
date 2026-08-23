import { AlertTriangleIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useRepo } from '../../lib/repo-context.js';
import { useRemoveWorktree } from '../../lib/queries.js';
import { errorMessage } from '../../lib/utils.js';
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
  running,
  onClose,
}: {
  branch: string;
  running: boolean;
  onClose: () => void;
}) {
  const { repo } = useRepo();
  const tabs = useTabs();
  const remove = useRemoveWorktree(repo.cwd);
  const [safety, setSafety] = useState<
    { safe: true } | { safe: false; reason: string } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    window.kirby
      .canRemoveBranch(branch)
      .then((r) => {
        if (!cancelled) setSafety(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSafety({ safe: false, reason: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [branch]);

  const doRemove = (force: boolean) => {
    remove.mutate(
      { branch, force },
      {
        onSuccess: () => {
          toast.success(`Removed worktree ${branch}`);
          tabs.close(`item:session:${branch.replace(/[^a-zA-Z0-9._-]/g, '-')}`);
          onClose();
        },
        onError: (err) => toast.error(errorMessage(err)),
      }
    );
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
              <p className="font-medium">Not safe to delete</p>
              <p className="text-muted-foreground">{safety.reason}</p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={remove.isPending}>
            Cancel
          </Button>
          {safety?.safe !== false ? (
            <Button
              variant="destructive"
              disabled={!safety || remove.isPending}
              onClick={() => doRemove(false)}
            >
              {remove.isPending ? 'Removing…' : 'Remove'}
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => doRemove(true)}
            >
              {remove.isPending ? 'Removing…' : 'Force remove'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
