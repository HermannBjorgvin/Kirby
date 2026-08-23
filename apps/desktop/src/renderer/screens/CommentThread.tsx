import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { RemoteCommentThread } from '../../host/contract.js';

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Markdown body styled for compact comment cards. */
function Body({ markdown }: { markdown: string }) {
  return (
    <div className="prose prose-sm prose-invert max-w-none prose-p:my-1.5 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}

/**
 * One PR comment thread (root comment + replies), rendered as
 * markdown, with reply box and resolve/reopen controls.
 */
export function CommentThreadCard({
  thread,
  prId,
  onReplied,
}: {
  thread: RemoteCommentThread;
  prId: number;
  onReplied: () => void;
}) {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = thread.comments[0];
  if (!root) return null;

  const location =
    thread.file != null
      ? `${thread.file}${
          thread.lineStart != null ? `:${thread.lineStart}` : ''
        }`
      : null;

  const sendReply = async () => {
    if (!reply.trim()) return;
    setSending(true);
    setError(null);
    try {
      await window.kirby.replyToThread({ prId, thread, body: reply });
      setReply('');
      onReplied();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const toggleResolved = async () => {
    setError(null);
    try {
      await window.kirby.setThreadResolved({
        prId,
        thread,
        resolved: !thread.isResolved,
      });
      onReplied();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      className={`rounded-md border px-3 py-2.5 ${
        thread.isResolved
          ? 'border-emerald-900/50 bg-emerald-950/20'
          : 'border-slate-800 bg-slate-900/40'
      }`}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
        <span className="font-medium text-slate-300">{root.author}</span>
        <span className="flex items-center gap-2 text-slate-500">
          {location && (
            <span className="font-mono text-[10px] text-cyan-400/80">
              {location}
            </span>
          )}
          {relativeTime(root.createdAt)}
        </span>
      </div>

      <Body markdown={root.body} />

      {/* Replies */}
      {thread.comments.length > 1 && (
        <div className="mt-2 space-y-2 border-l-2 border-slate-800 pl-3">
          {thread.comments.slice(1).map((r) => (
            <div key={r.id}>
              <p className="text-[11px] font-medium text-slate-400">
                {r.author}
                <span className="ml-1.5 font-normal text-slate-600">
                  {relativeTime(r.createdAt)}
                </span>
              </p>
              <Body markdown={r.body} />
            </div>
          ))}
        </div>
      )}

      {/* Reply + resolve */}
      <div className="mt-2 flex items-end gap-2">
        <input
          type="text"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void sendReply();
            }
          }}
          placeholder="Reply…"
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-500"
        />
        <button
          onClick={() => void sendReply()}
          disabled={sending || !reply.trim()}
          className="rounded bg-cyan-600 px-2 py-1 text-xs text-white hover:bg-cyan-500 disabled:opacity-40"
        >
          Reply
        </button>
        {thread.canResolve && (
          <button
            onClick={() => void toggleResolved()}
            className={`rounded px-2 py-1 text-xs ${
              thread.isResolved
                ? 'bg-emerald-900/60 text-emerald-300 hover:bg-emerald-900'
                : 'border border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            {thread.isResolved ? 'Resolved ✓' : 'Resolve'}
          </button>
        )}
      </div>

      {thread.isOutdated && (
        <p className="mt-1 text-[10px] italic text-slate-500">
          Outdated — the code has changed since this thread.
        </p>
      )}
      {error && (
        <p className="mt-1 font-mono text-[10px] text-red-400">{error}</p>
      )}
    </div>
  );
}
