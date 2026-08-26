import {
  CheckCircle2Icon,
  CircleDotIcon,
  CodeIcon,
  CopyIcon,
  ExternalLinkIcon,
  GitPullRequestIcon,
  MessageSquareIcon,
  XCircleIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { useOpenInEditor } from '../../lib/queries.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { Avatar } from '../ui/avatar.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Tip } from '../ui/tooltip.js';

/** Launch the configured external editor on the branch's worktree. */
export function OpenInEditorButton({ branch }: { branch: string }) {
  const open = useOpenInEditor();
  return (
    <Tip label="Open worktree in editor">
      <Button
        variant="ghost"
        size="sm"
        disabled={open.isPending}
        onClick={() =>
          open.mutate(branch, {
            onSuccess: ({ editor }) => toast.success(`Opened in ${editor}`),
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      >
        <CodeIcon /> Editor
      </Button>
    </Tip>
  );
}

export function PrHeader({ pr }: { pr: PullRequestInfo }) {
  const reviewers = pr.reviewers ?? [];
  const ci = pr.buildStatus;
  return (
    <header className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-3">
      <GitPullRequestIcon className="size-4 shrink-0 text-info" />
      <span className="flex min-w-0 shrink items-center gap-2">
        <span className="truncate font-medium">{pr.title}</span>
        <span className="shrink-0 text-sm text-muted-foreground">#{pr.id}</span>
        <Tip label="Copy branch name">
          <button
            onClick={() => {
              void navigator.clipboard.writeText(pr.sourceBranch);
              toast.success('Branch name copied');
            }}
            className="hidden min-w-0 items-center gap-1 truncate rounded px-1 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground sm:flex"
          >
            <span className="truncate">
              {pr.sourceBranch} → {pr.targetBranch}
            </span>
            <CopyIcon className="size-3 shrink-0" />
          </button>
        </Tip>
      </span>

      <span className="mx-1 h-4 w-px shrink-0 bg-border" />

      <span className="flex min-w-0 items-center gap-2 text-sm">
        <Tip label={`Opened by ${pr.createdByDisplayName}`}>
          <span className="flex items-center gap-1.5">
            <Avatar name={pr.createdByDisplayName} size="xs" />
            <span className="hidden truncate text-muted-foreground md:inline">
              {pr.createdByDisplayName}
            </span>
          </span>
        </Tip>
        {pr.isDraft && <Badge variant="outline">Draft</Badge>}
        {ci && ci !== 'none' && (
          <Badge
            variant={
              ci === 'succeeded'
                ? 'success'
                : ci === 'failed'
                ? 'destructive'
                : 'warning'
            }
          >
            {ci === 'succeeded' && <CheckCircle2Icon />}
            {ci === 'failed' && <XCircleIcon />}
            {ci === 'pending' && <CircleDotIcon />}
            CI {ci}
          </Badge>
        )}
        {reviewers.length > 0 && (
          <span className="flex items-center gap-1.5">
            {reviewers.slice(0, 6).map((r) => (
              <Tip
                key={r.identifier}
                label={`${r.displayName}: ${r.decision.replace('-', ' ')}`}
              >
                <span className="relative">
                  <Avatar name={r.displayName} size="xs" />
                  <span
                    className={cn(
                      'absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-2 ring-background',
                      r.decision === 'approved' && 'bg-success',
                      r.decision === 'changes-requested' && 'bg-destructive',
                      r.decision === 'no-response' && 'bg-muted-foreground/50',
                      r.decision === 'declined' && 'bg-muted-foreground'
                    )}
                  />
                </span>
              </Tip>
            ))}
          </span>
        )}
        {(pr.activeCommentCount ?? 0) > 0 && (
          <span className="flex items-center gap-0.5 text-muted-foreground">
            <MessageSquareIcon className="size-3.5" />
            {pr.activeCommentCount}
          </span>
        )}
      </span>

      <div className="flex-1" />

      <OpenInEditorButton branch={pr.sourceBranch} />
      <Tip label="Open on the provider">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void window.kirby.openExternal(pr.url)}
        >
          <ExternalLinkIcon /> Open
        </Button>
      </Tip>
    </header>
  );
}
