import { useCallback, useMemo, useState } from 'react';
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
 * Reviews pane: the PR list for the active repo plus a whole-PR diff
 * view. Comment threads ride on this screen in a later slice.
 */
export function Reviews({
  repoCwd,
  vcsConfigured,
}: {
  repoCwd: string;
  vcsConfigured?: boolean;
}) {
  const prs = useHostQuery(() => window.kirby.fetchPullRequests(), [repoCwd]);
  const [selected, setSelected] = useState<PullRequestInfo | null>(null);

  const prList = useMemo(
    () =>
      Object.entries(prs.data ?? {})
        .map(([, pr]) => ({ pr }))
        .filter((e): e is { pr: PullRequestInfo } => !!e.pr),
    [prs.data]
  );

  if (prs.loading) {
    return <PaneMessage message="Loading pull requests…" />;
  }
  if (prs.error) {
    return <PaneMessage message={prs.error} error />;
  }
  if (prList.length === 0) {
    return (
      <PaneMessage
        message={
          vcsConfigured === false
            ? 'No VCS provider configured — reviews are unavailable for this repo, but worktrees and sessions work normally.'
            : 'No open pull requests.'
        }
      />
    );
  }

  return (
    <div className="flex h-full min-w-0">
      {/* PR list */}
      <div className="w-72 shrink-0 overflow-y-auto border-r border-slate-800">
        <h2 className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Pull Requests ({prList.length})
        </h2>
        {prList.map(({ pr }) => (
          <button
            key={pr.id}
            onClick={() => setSelected(pr)}
            className={`block w-full px-4 py-2 text-left hover:bg-slate-800/70 ${
              selected?.id === pr.id ? 'bg-slate-800' : ''
            }`}
          >
            <p className="truncate text-sm text-slate-200">
              <span className="mr-1.5 font-mono text-xs text-cyan-400">
                #{pr.id}
              </span>
              {pr.title}
            </p>
            <p className="truncate font-mono text-[10px] text-slate-500">
              {pr.sourceBranch} → {pr.targetBranch}
            </p>
          </button>
        ))}
      </div>

      {/* Diff view */}
      <div className="min-w-0 flex-1">
        {selected ? (
          <PrDiff key={selected.id} pr={selected} />
        ) : (
          <PaneMessage message="Select a pull request to view its diff." />
        )}
      </div>
    </div>
  );
}

function PrDiff({ pr }: { pr: PullRequestInfo }) {
  const diff = useHostQuery(
    () => window.kirby.fetchDiffText(pr.sourceBranch, pr.targetBranch),
    [pr.id]
  );
  const [showComments, setShowComments] = useState(true);
  const comments = useHostQuery(
    () => window.kirby.fetchCommentThreads(pr.id),
    [pr.id]
  );

  const reloadComments = useCallback(() => comments.reload(), [comments]);

  const files = useMemo(() => {
    if (!diff.data) return null;
    return [...parseUnifiedDiff(diff.data).entries()];
  }, [diff.data]);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-800 px-4 py-3">
        <h3 className="truncate text-sm font-medium text-slate-100">
          <span className="mr-1.5 font-mono text-cyan-400">#{pr.id}</span>
          {pr.title}
        </h3>
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[10px] text-slate-500 hover:text-cyan-400"
        >
          {pr.url}
        </a>
      </header>

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

        {/* ── Comment threads ─────────────────────────────── */}
        {(comments.data?.threads.length ?? 0) +
          (comments.data?.generalComments.length ?? 0) >
          0 && (
          <section className="mt-2 border-t border-slate-800 pt-4">
            <button
              onClick={() => setShowComments((v) => !v)}
              className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300"
            >
              {showComments ? '▾' : '▸'} Comments (
              {(comments.data?.threads.length ?? 0) +
                (comments.data?.generalComments.length ?? 0)}
              )
            </button>
            {showComments && (
              <div className="space-y-3">
                {comments.data!.generalComments.map((t) => (
                  <CommentThreadCard
                    key={t.id}
                    thread={t}
                    prId={pr.id}
                    onReplied={reloadComments}
                  />
                ))}
                {comments.data!.threads.map((t) => (
                  <CommentThreadCard
                    key={t.id}
                    thread={t}
                    prId={pr.id}
                    onReplied={reloadComments}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function PaneMessage({ message, error }: { message: string; error?: boolean }) {
  return (
    <div className="flex h-full items-center justify-center px-8">
      <p
        className={`max-w-lg text-center font-mono text-sm ${
          error ? 'text-red-400' : 'text-slate-500'
        }`}
      >
        {message}
      </p>
    </div>
  );
}
