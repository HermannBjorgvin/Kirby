import {
  GitBranchIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from 'lucide-react';
import type { SidebarItem } from '../../../host/contract.js';
import { cn } from '../../lib/utils.js';

/**
 * The leading glyph of a sidebar row: what the row *is* (a branch, a
 * pull request, a draft one) with a live-agent pip overlaid on it.
 */
export function ItemIcon({
  item,
  running,
}: {
  item: SidebarItem;
  running: boolean;
}) {
  const pr = item.pr;
  let Icon = GitBranchIcon;
  let tone = 'text-muted-foreground';
  if (pr?.isDraft) {
    Icon = GitPullRequestDraftIcon;
  } else if (pr) {
    Icon = GitPullRequestIcon;
    tone = item.kind === 'review-pr' ? reviewTone(item.category) : 'text-info';
  }
  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      <Icon className={cn('size-4', tone)} />
      {running && (
        <span className="absolute -right-0.5 -bottom-0.5 flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-success ring-2 ring-sidebar" />
        </span>
      )}
    </span>
  );
}

function reviewTone(category: 'needs-review' | 'waiting' | 'approved'): string {
  if (category === 'needs-review') return 'text-warning';
  if (category === 'approved') return 'text-success';
  return 'text-muted-foreground';
}
