import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleDotIcon,
  ColumnsIcon,
  EyeOffIcon,
  Loader2Icon,
  MessageSquareIcon,
  RowsIcon,
  SendIcon,
  WrapTextIcon,
  XCircleIcon,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Group,
  Panel,
  Separator as PanelSeparator,
} from 'react-resizable-panels';
import { parseUnifiedDiff, type DiffLine } from '@kirby/diff';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { toast } from 'sonner';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../host/contract.js';
import { setDiffOptions, useDiffOptions } from '../../lib/diff-options.js';
import {
  useDiff,
  useDraftComments,
  usePostDrafts,
  useThreads,
} from '../../lib/queries.js';
import { useRepo } from '../../lib/repo-context.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { Avatar } from '../ui/avatar.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Skeleton } from '../ui/skeleton.js';
import { Tip } from '../ui/tooltip.js';
import { CommentsList } from './CommentsList.js';
import { ConversationPanel } from './ConversationPanel.js';
import { DiffView } from './DiffView.js';
import { FileTree, type FileEntry } from './FileTree.js';

/**
 * PR review tab: meta strip + viewer toolbar up top, then a resizable
 * left column (file tree, comment jump-list) beside the diff. Inline
 * review threads render at their line; general PR comments live in a
 * collapsible "Conversation" block at the top of the diff column.
 */
export function PrReview({ pr }: { pr: PullRequestInfo }) {
  const { repo } = useRepo();
  const diff = useDiff(repo.cwd, pr.sourceBranch, pr.targetBranch);
  const comments = useThreads(repo.cwd, pr.id);
  const draftsQuery = useDraftComments(repo.cwd, pr.id);
  const postAll = usePostDrafts(repo.cwd);
  const options = useDiffOptions();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [focusThreadId, setFocusThreadId] = useState<string | null>(null);

  const files = useMemo<[string, DiffLine[]][]>(() => {
    if (!diff.data) return [];
    return [...parseUnifiedDiff(diff.data).entries()];
  }, [diff.data]);

  const inlineThreads = useMemo(
    () => comments.data?.threads ?? [],
    [comments.data]
  );
  const general = useMemo(
    () => comments.data?.generalComments ?? [],
    [comments.data]
  );

  const drafts = useMemo(
    () => (draftsQuery.data ?? []).filter((d) => d.status !== 'posted'),
    [draftsQuery.data]
  );
  const draftsByFile = useMemo(() => {
    const map = new Map<string, ReviewComment[]>();
    for (const d of drafts)
      (map.get(d.file) ?? map.set(d.file, []).get(d.file)!).push(d);
    return map;
  }, [drafts]);

  const threadsByFile = useMemo(() => {
    const map = new Map<string, RemoteCommentThread[]>();
    for (const t of inlineThreads) {
      if (t.file == null) continue;
      (map.get(t.file) ?? map.set(t.file, []).get(t.file)!).push(t);
    }
    return map;
  }, [inlineThreads]);

  const entries = useMemo<FileEntry[]>(
    () =>
      files.map(([filename, lines]) => ({
        path: filename,
        additions: lines.filter((l) => l.type === 'add').length,
        deletions: lines.filter((l) => l.type === 'remove').length,
        comments: (threadsByFile.get(filename) ?? []).filter(
          (t) => !t.isResolved
        ).length,
        drafts: (draftsByFile.get(filename) ?? []).length,
      })),
    [files, threadsByFile, draftsByFile]
  );

  const jumpToFile = useCallback((path: string) => {
    setSelectedFile(path);
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-file="${CSS.escape(path)}"]`)
      ?.scrollIntoView({ block: 'start' });
  }, []);

  // Thread navigation: open threads in document order.
  const orderedThreads = useMemo(() => {
    const order = new Map(files.map(([f], i) => [f, i]));
    const inDiff = [...inlineThreads].sort((a, b) => {
      const fa = order.get(a.file ?? '') ?? Infinity;
      const fb = order.get(b.file ?? '') ?? Infinity;
      if (fa !== fb) return fa - fb;
      return (a.lineStart ?? 0) - (b.lineStart ?? 0);
    });
    return [...general, ...inDiff];
  }, [files, inlineThreads, general]);
  const navThreads = options.hideResolved
    ? orderedThreads.filter((t) => !t.isResolved)
    : orderedThreads;
  const navIndex = navThreads.findIndex((t) => t.id === focusThreadId);

  const jumpToThread = useCallback(
    (t: RemoteCommentThread) => {
      setFocusThreadId(t.id);
      if (t.file) setSelectedFile(t.file);
      // ThreadCard scrolls itself into view when focused; if it lives
      // in a collapsed file section the file header is the best we can do.
      const el = scrollRef.current?.querySelector<HTMLElement>(
        `[data-thread="${CSS.escape(t.id)}"]`
      );
      if (!el && t.file) jumpToFile(t.file);
    },
    [jumpToFile]
  );
  const step = (delta: number) => {
    if (navThreads.length === 0) return;
    const next =
      navIndex < 0
        ? 0
        : (navIndex + delta + navThreads.length) % navThreads.length;
    jumpToThread(navThreads[next]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MetaStrip pr={pr} fileCount={files.length} />
      <Toolbar
        navCount={navThreads.length}
        navIndex={navIndex}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        draftCount={drafts.length}
        postingAll={postAll.isPending}
        onPostAll={() =>
          postAll.mutate(
            { prId: pr.id, headSha: pr.headSha },
            {
              onSuccess: (n) =>
                toast.success(`Posted ${n} comment${n === 1 ? '' : 's'}`),
              onError: (e) => toast.error(`Post failed: ${errorMessage(e)}`),
            }
          )
        }
      />
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel
          defaultSize="280px"
          minSize="180px"
          maxSize="50%"
          className="min-w-0"
        >
          <div className="flex h-full min-h-0 flex-col bg-sidebar/60">
            <div className="min-h-0 flex-1">
              <FileTree
                entries={entries}
                loading={diff.isLoading}
                selected={selectedFile}
                onSelect={jumpToFile}
              />
            </div>
            <div className="max-h-[45%] shrink-0 overflow-hidden">
              <CommentsList
                threads={inlineThreads}
                general={general}
                activeId={focusThreadId}
                onJump={jumpToThread}
              />
            </div>
          </div>
        </Panel>
        <PanelSeparator className="relative w-px bg-border transition-colors after:absolute after:inset-y-0 after:-left-1 after:w-2 hover:bg-primary data-[resize-handle-state=drag]:bg-primary" />
        <Panel minSize="30%" className="min-w-0">
          <div ref={scrollRef} className="h-full overflow-auto">
            {diff.isLoading && (
              <div className="space-y-2 p-4">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-11/12" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            )}
            {diff.error && (
              <div className="m-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {String(diff.error.message)}
              </div>
            )}
            {(general.length > 0 || comments.isLoading) && (
              <ConversationPanel
                threads={
                  options.hideResolved
                    ? general.filter((t) => !t.isResolved)
                    : general
                }
                loading={comments.isLoading}
                prId={pr.id}
                focusThreadId={focusThreadId}
              />
            )}
            {!diff.isLoading && !diff.error && files.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No changes between{' '}
                <span className="font-mono">{pr.targetBranch}</span> and{' '}
                <span className="font-mono">{pr.sourceBranch}</span>.
              </div>
            )}
            {files.map(([filename, lines]) => (
              <DiffView
                key={filename}
                filename={filename}
                lines={lines}
                threads={threadsByFile.get(filename) ?? []}
                drafts={draftsByFile.get(filename) ?? []}
                prId={pr.id}
                headSha={pr.headSha}
                focusThreadId={focusThreadId}
              />
            ))}
          </div>
        </Panel>
      </Group>
    </div>
  );
}

function Toolbar({
  navCount,
  navIndex,
  onPrev,
  onNext,
  draftCount,
  postingAll,
  onPostAll,
}: {
  navCount: number;
  navIndex: number;
  onPrev: () => void;
  onNext: () => void;
  draftCount: number;
  postingAll: boolean;
  onPostAll: () => void;
}) {
  const o = useDiffOptions();
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2 text-sm">
      <div className="flex items-center rounded-md border border-border p-0.5">
        <Tip label="Unified view">
          <button
            onClick={() => setDiffOptions({ view: 'unified' })}
            className={cn(
              'flex h-5 items-center gap-1 rounded px-1.5 text-xs',
              o.view === 'unified'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <RowsIcon className="size-3.5" /> Unified
          </button>
        </Tip>
        <Tip label="Side-by-side view">
          <button
            onClick={() => setDiffOptions({ view: 'split' })}
            className={cn(
              'flex h-5 items-center gap-1 rounded px-1.5 text-xs',
              o.view === 'split'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <ColumnsIcon className="size-3.5" /> Split
          </button>
        </Tip>
      </div>
      <Tip label={o.wrap ? 'Disable line wrapping' : 'Wrap long lines'}>
        <Button
          variant={o.wrap ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setDiffOptions({ wrap: !o.wrap })}
          aria-pressed={o.wrap}
        >
          <WrapTextIcon /> Wrap
        </Button>
      </Tip>
      <Tip
        label={
          o.hideResolved ? 'Show resolved threads' : 'Hide resolved threads'
        }
      >
        <Button
          variant={o.hideResolved ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setDiffOptions({ hideResolved: !o.hideResolved })}
          aria-pressed={o.hideResolved}
        >
          <EyeOffIcon /> Hide resolved
        </Button>
      </Tip>
      <div className="flex-1" />
      {draftCount > 0 && (
        <Tip label="Post every draft comment written by the review agent">
          <Button size="sm" onClick={onPostAll} disabled={postingAll}>
            {postingAll ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <SendIcon />
            )}
            Post {draftCount} draft{draftCount === 1 ? '' : 's'}
          </Button>
        </Tip>
      )}
      {navCount > 0 && (
        <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
          <MessageSquareIcon className="size-3.5" />
          <span className="tabular-nums">
            {navIndex >= 0 ? navIndex + 1 : '–'}/{navCount}
          </span>
          <Tip label="Previous comment">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onPrev}
              aria-label="Previous comment"
            >
              <ChevronUpIcon />
            </Button>
          </Tip>
          <Tip label="Next comment">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onNext}
              aria-label="Next comment"
            >
              <ChevronDownIcon />
            </Button>
          </Tip>
        </div>
      )}
    </div>
  );
}

function MetaStrip({
  pr,
  fileCount,
}: {
  pr: PullRequestInfo;
  fileCount: number;
}) {
  const reviewers = pr.reviewers ?? [];
  const ci = pr.buildStatus;
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 overflow-hidden border-b border-border bg-muted/40 px-3 text-sm">
      <span className="flex min-w-0 items-center gap-1.5">
        <Avatar name={pr.createdByDisplayName} size="xs" />
        <span className="truncate text-foreground">
          {pr.createdByDisplayName}
        </span>
      </span>
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
        <span className="flex items-center gap-1">
          {reviewers.slice(0, 6).map((r) => (
            <Tip
              key={r.identifier}
              label={`${r.displayName}: ${r.decision.replace('-', ' ')}`}
            >
              <span className="relative">
                <Avatar name={r.displayName} size="xs" />
                <span
                  className={cn(
                    'absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background',
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
        <span className="flex items-center gap-1 text-muted-foreground">
          <MessageSquareIcon className="size-3.5" />
          {pr.activeCommentCount}
        </span>
      )}
      <span className="ml-auto shrink-0 text-muted-foreground">
        {fileCount} file{fileCount === 1 ? '' : 's'} changed
      </span>
    </div>
  );
}
