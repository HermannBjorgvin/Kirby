import { useMemo } from 'react';
import { parseUnifiedDiff, type DiffLine } from '@kirby/diff';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { RemoteCommentThread } from '../../host/contract.js';
import { useHostQuery } from '../hooks/useHostQuery.js';
import { CommentThreadCard } from './CommentThread.js';

const LINE_CLASS: Record<DiffLine['type'], string> = {
  add: 'bg-emerald-950/40',
  remove: 'bg-red-950/40',
  context: '',
  'hunk-header': 'bg-slate-800/60 text-cyan-300',
};

const SIGN: Record<DiffLine['type'], string> = {
  add: '+',
  remove: '-',
  context: ' ',
  'hunk-header': '',
};

const TEXT_CLASS: Record<DiffLine['type'], string> = {
  add: 'text-emerald-200',
  remove: 'text-red-200',
  context: 'text-slate-400',
  'hunk-header': 'text-cyan-300',
};

/**
 * PR review view: the whole-PR diff with review comment threads
 * interleaved inline at their line positions (like the TUI), plus a
 * line-number gutter. General (non-inline) comments render up top.
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

  // Inline threads keyed by `${file}:${lineStart}` for O(1) interleave.
  const inlineThreads = useMemo(() => {
    const map = new Map<string, RemoteCommentThread[]>();
    for (const t of comments.data?.threads ?? []) {
      if (t.file == null || t.lineStart == null) continue;
      const key = `${t.file}:${t.lineStart}`;
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return map;
  }, [comments.data]);

  const general = comments.data?.generalComments ?? [];

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {diff.loading && (
        <p className="p-3 font-mono text-sm text-slate-500">Loading diff…</p>
      )}
      {diff.error && (
        <p className="m-3 rounded border border-red-900 bg-red-950/50 px-3 py-2 font-mono text-xs text-red-300">
          {diff.error}
        </p>
      )}

      {/* General PR comments */}
      {general.length > 0 && (
        <div className="border-b border-slate-800 bg-slate-950/40 p-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Conversation ({general.length})
          </h3>
          <div className="space-y-2">
            {general.map((t) => (
              <CommentThreadCard
                key={t.id}
                thread={t}
                prId={pr.id}
                onReplied={comments.reload}
              />
            ))}
          </div>
        </div>
      )}

      {files?.map(([filename, lines]) => (
        <FileDiff
          key={filename}
          filename={filename}
          lines={lines}
          inlineThreads={inlineThreads}
          prId={pr.id}
          onReplied={comments.reload}
        />
      ))}
    </div>
  );
}

function FileDiff({
  filename,
  lines,
  inlineThreads,
  prId,
  onReplied,
}: {
  filename: string;
  lines: DiffLine[];
  inlineThreads: Map<string, RemoteCommentThread[]>;
  prId: number;
  onReplied: () => void;
}) {
  const adds = lines.filter((l) => l.type === 'add').length;
  const dels = lines.filter((l) => l.type === 'remove').length;

  return (
    <section className="border-b border-slate-800">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-3 py-1.5">
        <span className="truncate font-mono text-xs text-slate-200">
          {filename}
        </span>
        <span className="shrink-0 font-mono text-[10px]">
          <span className="text-emerald-400">+{adds}</span>{' '}
          <span className="text-red-400">−{dels}</span>
        </span>
      </div>

      <div className="font-mono text-xs leading-5">
        {lines.map((line, i) => {
          const threadKey =
            line.newLine != null ? `${filename}:${line.newLine}` : null;
          const threads = threadKey ? inlineThreads.get(threadKey) : undefined;
          return (
            <div key={i}>
              <div className={`flex ${LINE_CLASS[line.type]}`}>
                <span className="w-10 shrink-0 select-none pr-2 text-right text-slate-600">
                  {line.oldLine ?? ''}
                </span>
                <span className="w-10 shrink-0 select-none pr-2 text-right text-slate-600">
                  {line.newLine ?? ''}
                </span>
                <span
                  className={`w-4 shrink-0 select-none text-center ${
                    TEXT_CLASS[line.type]
                  }`}
                >
                  {SIGN[line.type]}
                </span>
                <span className={`whitespace-pre ${TEXT_CLASS[line.type]}`}>
                  {line.content || ' '}
                </span>
              </div>
              {threads?.map((t) => (
                <div
                  key={t.id}
                  className="border-y border-slate-800 bg-slate-950/60 px-3 py-2"
                >
                  <CommentThreadCard
                    thread={t}
                    prId={prId}
                    onReplied={onReplied}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
