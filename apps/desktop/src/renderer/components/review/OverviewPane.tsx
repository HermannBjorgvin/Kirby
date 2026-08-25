import {
  CheckCircle2Icon,
  CheckIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { usePrDescription, useSubmitVerdict } from '../../lib/queries.js';
import { useRepo } from '../../lib/repo-context.js';
import { errorMessage } from '../../lib/utils.js';
import { Avatar } from '../ui/avatar.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Skeleton } from '../ui/skeleton.js';
import { Tip } from '../ui/tooltip.js';
import { CommentMarkdown } from './CommentMarkdown.js';

/**
 * The PR overview: title, meta, full description, and the review
 * verdict actions (Approve / Approve with suggestions).
 */
export function OverviewPane({ pr }: { pr: PullRequestInfo }) {
  const { repo } = useRepo();
  const description = usePrDescription(repo.cwd, pr.id);
  const verdict = useSubmitVerdict(repo.cwd);

  const submit = (v: 'approve' | 'approve-with-suggestions') =>
    verdict.mutate(
      { prId: pr.id, verdict: v },
      {
        onSuccess: () =>
          toast.success(
            v === 'approve' ? 'Approved' : 'Approved with suggestions'
          ),
        onError: (e) => toast.error(`Approval failed: ${errorMessage(e)}`),
      }
    );

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[860px] px-6 py-6">
        <h1 className="text-xl font-semibold leading-snug">
          {pr.title}{' '}
          <span className="font-normal text-muted-foreground">#{pr.id}</span>
        </h1>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Avatar name={pr.createdByDisplayName} size="xs" />
            {pr.createdByDisplayName}
          </span>
          <span className="font-mono text-xs">
            {pr.sourceBranch} → {pr.targetBranch}
          </span>
          {pr.isDraft && <Badge variant="outline">Draft</Badge>}
        </div>

        <div className="mt-4 flex items-center gap-2 border-y border-border py-3">
          <Tip label="Approve this pull request">
            <Button
              size="sm"
              onClick={() => submit('approve')}
              disabled={verdict.isPending}
            >
              {verdict.isPending ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <CheckCircle2Icon />
              )}
              Approve
            </Button>
          </Tip>
          <Tip label="Approve, with non-blocking suggestions">
            <Button
              variant="outline"
              size="sm"
              onClick={() => submit('approve-with-suggestions')}
              disabled={verdict.isPending}
            >
              <MessageSquarePlusIcon /> Approve with suggestions
            </Button>
          </Tip>
          {(pr.reviewers ?? []).some((r) => r.decision === 'approved') && (
            <span className="ml-auto flex items-center gap-1 text-xs text-success">
              <CheckIcon className="size-3.5" />
              {
                (pr.reviewers ?? []).filter((r) => r.decision === 'approved')
                  .length
              }{' '}
              approved
            </span>
          )}
        </div>

        <div className="mt-4">
          {description.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ) : description.data ? (
            <CommentMarkdown markdown={description.data} />
          ) : (
            <p className="text-sm text-muted-foreground">
              This pull request has no description.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
