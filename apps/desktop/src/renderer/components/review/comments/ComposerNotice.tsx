import { Loader2Icon } from 'lucide-react';
import type { ComposerNotice as Notice } from '../../../lib/diff/thread-model.js';

/**
 * What the composer knows that the reader might not: either that the
 * pull request is being re-read from the provider, or that it grew
 * while the box was opening.
 *
 * Sits above the input so it is read before anything is typed, not
 * after — the whole point is that nobody answers a question somebody
 * has already answered. Progress is muted chrome; an arrival is news
 * and is coloured to be noticed.
 */
export function ComposerNoticeLine({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  const checking = notice.kind === 'checking';
  return (
    <p
      data-composer-notice={notice.kind}
      className={
        checking
          ? 'flex items-center gap-1.5 text-xs text-muted-foreground'
          : 'flex items-center gap-1.5 rounded-md bg-warning/10 px-2 py-1 text-xs font-medium text-warning'
      }
    >
      {checking && <Loader2Icon className="size-3 animate-spin" />}
      {notice.text}
    </p>
  );
}
