import {
  CheckCircle2Icon,
  CheckIcon,
  ClockIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  XCircleIcon,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { toast } from 'sonner';
import type { PullRequestInfo, ReviewVerdict } from '@kirby/vcs-core';
import { usePrDescription } from '../../lib/data/queries.js';
import { useSubmitVerdict } from '../../lib/data/mutations.js';
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

/** One vote. Its own icon is swapped for a spinner while it is in flight. */
function VerdictButton({
  tip,
  icon,
  pending,
  disabled,
  onClick,
  variant,
  className,
  children,
}: {
  tip: string;
  icon: ReactNode;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
  variant?: ComponentProps<typeof Button>['variant'];
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tip label={tip}>
      <Button
        variant={variant}
        size="sm"
        onClick={onClick}
        disabled={disabled}
        className={className}
      >
        {pending ? <Loader2Icon className="animate-spin" /> : icon}
        {children}
      </Button>
    </Tip>
  );
}

/**
 * The vote row. Azure DevOps has four votes; GitHub knows only approve
 * and request-changes, so the negative side collapses to one red
 * button and "wait for author" is not offered at all.
 */
function VerdictBar({
  pr,
  isGitHub,
  submitting,
  pendingVerdict,
  onSubmit,
}: {
  pr: PullRequestInfo;
  isGitHub: boolean;
  submitting: boolean;
  pendingVerdict: ReviewVerdict | null | undefined;
  onSubmit: (v: ReviewVerdict) => void;
}) {
  const reviewers = pr.reviewers ?? [];
  const approvals = reviewers.filter((r) => r.decision === 'approved').length;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-y border-border py-3">
      <VerdictButton
        tip="Approve this pull request"
        icon={<CheckCircle2Icon />}
        pending={pendingVerdict === 'approve'}
        disabled={submitting}
        onClick={() => onSubmit('approve')}
        className="bg-success text-white hover:bg-success/90"
      >
        Approve
      </VerdictButton>
      <VerdictButton
        tip={
          isGitHub
            ? 'Approve with a non-blocking note (GitHub has no separate vote for this)'
            : 'Approve, with non-blocking suggestions'
        }
        icon={<MessageSquarePlusIcon />}
        pending={pendingVerdict === 'approve-with-suggestions'}
        disabled={submitting}
        onClick={() => onSubmit('approve-with-suggestions')}
        variant="outline"
        className="border-success/60 text-success hover:bg-success/10 hover:text-success"
      >
        Approve with suggestions
      </VerdictButton>
      {!isGitHub && (
        <VerdictButton
          tip="Block the PR until the author responds"
          icon={<ClockIcon />}
          pending={pendingVerdict === 'wait-for-author'}
          disabled={submitting}
          onClick={() => onSubmit('wait-for-author')}
          variant="outline"
          className="border-warning/60 text-warning hover:bg-warning/10 hover:text-warning"
        >
          Wait for author
        </VerdictButton>
      )}
      <VerdictButton
        tip={
          isGitHub
            ? 'Submit a changes-requested review'
            : 'Reject this pull request'
        }
        icon={<XCircleIcon />}
        pending={pendingVerdict === 'reject'}
        disabled={submitting}
        onClick={() => onSubmit('reject')}
        variant="destructive"
      >
        {isGitHub ? 'Request changes' : 'Reject'}
      </VerdictButton>
      {approvals > 0 && (
        <span className="ml-auto flex items-center gap-1 text-xs text-success">
          <CheckIcon className="size-3.5" />
          {approvals} approved
        </span>
      )}
    </div>
  );
}

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

        <VerdictBar
          pr={pr}
          isGitHub={isGitHub}
          submitting={verdict.isPending}
          pendingVerdict={pendingVerdict}
          onSubmit={submit}
        />

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
