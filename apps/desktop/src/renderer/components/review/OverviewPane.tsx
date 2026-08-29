import {
  CheckCircle2Icon,
  CheckIcon,
  ClockIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  XCircleIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { PullRequestInfo, ReviewVerdict } from '@kirby/vcs-core';
import { usePrDescription } from '../../lib/queries.js';
import { useSubmitVerdict } from '../../lib/mutations.js';
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
const VERDICT_DONE: Record<ReviewVerdict, string> = {
  approve: 'Approved',
  'approve-with-suggestions': 'Approved with suggestions',
  'wait-for-author': 'Marked as waiting for author',
  reject: 'Changes requested',
};

export function OverviewPane({ pr }: { pr: PullRequestInfo }) {
  const { repo } = useRepo();
  const description = usePrDescription(repo.cwd, pr.id);
  const verdict = useSubmitVerdict(repo.cwd, repo.providerId ?? undefined);
  // Speak the provider's language: ADO has four votes; GitHub only
  // knows approve and request-changes, so the negative side collapses
  // to one red button and "wait for author" doesn't exist.
  const isGitHub = repo.providerId === 'github';

  // Which verdict is mid-flight — its button gets the spinner.
  const pendingVerdict = verdict.isPending ? verdict.variables?.verdict : null;

  const submit = (v: ReviewVerdict) =>
    verdict.mutate(
      { prId: pr.id, verdict: v },
      {
        onSuccess: () => toast.success(VERDICT_DONE[v]),
        onError: (e) => toast.error(`Review vote failed: ${errorMessage(e)}`),
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

        <div className="mt-4 flex flex-wrap items-center gap-2 border-y border-border py-3">
          <Tip label="Approve this pull request">
            <Button
              size="sm"
              onClick={() => submit('approve')}
              disabled={verdict.isPending}
              className="bg-success text-white hover:bg-success/90"
            >
              {pendingVerdict === 'approve' ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <CheckCircle2Icon />
              )}
              Approve
            </Button>
          </Tip>
          <Tip
            label={
              isGitHub
                ? 'Approve with a non-blocking note (GitHub has no separate vote for this)'
                : 'Approve, with non-blocking suggestions'
            }
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => submit('approve-with-suggestions')}
              disabled={verdict.isPending}
              className="border-success/60 text-success hover:bg-success/10 hover:text-success"
            >
              {pendingVerdict === 'approve-with-suggestions' ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <MessageSquarePlusIcon />
              )}
              Approve with suggestions
            </Button>
          </Tip>
          {!isGitHub && (
            <Tip label="Block the PR until the author responds">
              <Button
                variant="outline"
                size="sm"
                onClick={() => submit('wait-for-author')}
                disabled={verdict.isPending}
                className="border-warning/60 text-warning hover:bg-warning/10 hover:text-warning"
              >
                {pendingVerdict === 'wait-for-author' ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <ClockIcon />
                )}
                Wait for author
              </Button>
            </Tip>
          )}
          <Tip
            label={
              isGitHub
                ? 'Submit a changes-requested review'
                : 'Reject this pull request'
            }
          >
            <Button
              variant="destructive"
              size="sm"
              onClick={() => submit('reject')}
              disabled={verdict.isPending}
            >
              {pendingVerdict === 'reject' ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <XCircleIcon />
              )}
              {isGitHub ? 'Request changes' : 'Reject'}
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
