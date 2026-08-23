import { useMemo } from 'react';
import { parseUnifiedDiff, type DiffLine } from '@kirby/diff';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { useHostQuery } from '../hooks/useHostQuery.js';
import { CommentThreadCard } from './CommentThread.js';

const LINE_CLASS: Record<DiffLine['type'], string> = {
  add: 'bg-emerald-950/60 text-emerald-200',
  remove: 'bg-red-950/60 text-red-200',
  context: 'text-slate-400',
  'hunk-header': 'bg-slate-800/80 text-cyan-300',
};

/**
 * PR review view: the whole-PR diff (parsed with @kirby/diff, colored
 * DOM lines) followed by comment threads (markdown, reply, resolve).
 * Reused by the content pane for any item backed by a pull request.
 */
export function PrReview({ pr }: { pr: PullRequestInfo }) {
  const diff = useHostQuery(
    () => window.kirby.fetchDiffText(pr.sourceBranch, pr.targetBranch),
    [pr.id]
  );
  const comments = useHostQuery(
    () => window.kirby.fetchCommentThreads(pr.id),
    [pr.id]
  );

  const files = useMemo(() => {
    if (!diff.data) return null;
    return [...parseUnifiedDiff(diff.data).entries()];
  }, [diff.data]);

  const threadCount =
    (comments.data?.threads.length ?? 0) +
    (comments.data?.generalComments.length ?? 0);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {diff.loading && (
        <p className="font-mono text-sm text-slate-500">Loading diff…</p>
      )}
      {diff.error && (
        <p className="rounded border border-red-900 bg-red-950/50 px-3 py-2 font-mono text-xs text-red-300">
          {diff.error}
        </p>
      )}

      {files?.map(([filename, lines]) => (
        <section key={filename} className="mb-5">
          <h4 className="mb-1 truncate rounded-t bg-slate-800 px-3 py-1.5 font-mono text-xs text-slate-200">
            {filename}
          </h4>
          <pre className="overflow-x-auto pb-1 font-mono text-xs leading-5">
            {lines.map((line, i) => (
              <div key={i} className={`px-3 ${LINE_CLASS[line.type]}`}>
                {line.content || ' '}
              </div>
            ))}
          </pre>
        </section>
      ))}

      {threadCount > 0 && (
        <section className="mt-2 border-t border-slate-800 pt-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Comments ({threadCount})
          </h3>
          <div className="space-y-3">
            {comments.data!.generalComments.map((t) => (
              <CommentThreadCard
                key={t.id}
                thread={t}
                prId={pr.id}
                onReplied={comments.reload}
              />
            ))}
            {comments.data!.threads.map((t) => (
              <CommentThreadCard
                key={t.id}
                thread={t}
                prId={pr.id}
                onReplied={comments.reload}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
