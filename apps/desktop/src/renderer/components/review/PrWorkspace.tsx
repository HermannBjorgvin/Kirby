import {
  BotIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  ExternalLinkIcon,
  GitPullRequestIcon,
  MessageSquareIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlayIcon,
  SquareIcon,
  XCircleIcon,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Group,
  Panel,
  Separator as PanelSeparator,
} from 'react-resizable-panels';
import { toast } from 'sonner';
import { parseUnifiedDiff, type DiffLine } from '@kirby/diff';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../host/contract.js';
import { useDiffOptions } from '../../lib/diff-options.js';
import {
  useDiff,
  useDraftComments,
  usePostDrafts,
  useThreads,
} from '../../lib/queries.js';
import { useRepo } from '../../lib/repo-context.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { SessionTerminal } from '../terminal/SessionTerminal.js';
import { Avatar } from '../ui/avatar.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { Tip } from '../ui/tooltip.js';
import { CommentsList, type CommentListItem } from './CommentsList.js';
import { ReviewStepper } from './ReviewStepper.js';
import { severityCounts } from '../../lib/diff-model.js';
import { ClipboardCheckIcon, Loader2Icon, SendIcon } from 'lucide-react';
import { DiffPane } from './DiffPane.js';
import { FileTree, type FileEntry } from './FileTree.js';

type Mode = 'diff' | 'agent' | 'review';

/**
 * The review workspace for a PR: a persistent left rail (Agent · Files
 * · Comments) beside a single content pane that swaps between the diff
 * and the agent terminal. Selecting a file/comment shows the diff;
 * selecting the agent shows its terminal (which stays mounted so its
 * scrollback survives). The diff's own toolbar lives inside the diff
 * pane, so it's gone while the terminal is showing.
 */
export function PrWorkspace({
  pr,
  sessionName,
  running,
  active,
  busy,
  onLaunch,
  onStop,
}: {
  pr: PullRequestInfo;
  /** PTY session for this branch, if one exists (running or its final frame). */
  sessionName?: string;
  running: boolean;
  active: boolean;
  busy: boolean;
  onLaunch: () => void;
  onStop: () => void;
}) {
  const { repo } = useRepo();
  const diff = useDiff(repo.cwd, pr.sourceBranch, pr.targetBranch);
  const comments = useThreads(repo.cwd, pr.id);
  const draftsQuery = useDraftComments(repo.cwd, pr.id);
  const postAll = usePostDrafts(repo.cwd);
  const options = useDiffOptions();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<Mode>('diff');
  const [railHidden, setRailHidden] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [focusThreadId, setFocusThreadId] = useState<string | null>(null);

  // Jump to the terminal the moment an agent starts running.
  const [prevRunning, setPrevRunning] = useState(running);
  if (running !== prevRunning) {
    setPrevRunning(running);
    if (running) setMode('agent');
  }
  const files = useMemo<[string, DiffLine[]][]>(
    () => (diff.data ? [...parseUnifiedDiff(diff.data).entries()] : []),
    [diff.data]
  );
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

  const fileOrder = useMemo(
    () => new Map(files.map(([f], i) => [f, i])),
    [files]
  );
  const filesByName = useMemo(() => new Map(files), [files]);

  const hasDrafts = drafts.length > 0;
  const effMode: Mode =
    mode === 'agent' && sessionName
      ? 'agent'
      : mode === 'review' && hasDrafts
      ? 'review'
      : 'diff';

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
    setMode('diff');
    requestAnimationFrame(() =>
      scrollRef.current
        ?.querySelector<HTMLElement>(`[data-file="${CSS.escape(path)}"]`)
        ?.scrollIntoView({ block: 'start' })
    );
  }, []);

  // Unified, document-ordered comment list: general (Conversation)
  // first, then per file [threads + drafts] by line. Powers both the
  // sidebar Comments list and the diff toolbar's prev/next nav, so both
  // move between remote comments AND agent drafts.
  const commentItems = useMemo<CommentListItem[]>(() => {
    const order = new Map(files.map(([f], i) => [f, i]));
    type Row = CommentListItem & {
      file: string | null;
      line: number;
      fileRank: number;
    };
    const rows: Row[] = [];
    for (const t of general) {
      const root = t.comments[0];
      rows.push({
        id: t.id,
        kind: 'thread',
        author: root?.author ?? '',
        where: 'Conversation',
        preview: root?.body ?? '',
        resolved: t.isResolved,
        file: null,
        line: 0,
        fileRank: -1,
      });
    }
    for (const t of inlineThreads) {
      const root = t.comments[0];
      rows.push({
        id: t.id,
        kind: 'thread',
        author: root?.author ?? '',
        where: `${t.file?.split('/').pop() ?? ''}${
          t.lineStart != null ? `:${t.lineStart}` : ''
        }`,
        preview: root?.body ?? '',
        resolved: t.isResolved,
        file: t.file,
        line: t.lineStart ?? 0,
        fileRank: order.get(t.file ?? '') ?? Number.MAX_SAFE_INTEGER,
      });
    }
    for (const d of drafts) {
      rows.push({
        id: d.id,
        kind: 'draft',
        author: 'Draft',
        where: `${d.file.split('/').pop()}:${d.lineStart}`,
        preview: d.body,
        resolved: false,
        severity: d.severity,
        file: d.file,
        line: d.lineStart,
        fileRank: order.get(d.file) ?? Number.MAX_SAFE_INTEGER,
      });
    }
    rows.sort((a, b) => {
      const ga = a.file == null ? 0 : 1;
      const gb = b.file == null ? 0 : 1;
      if (ga !== gb) return ga - gb;
      if (a.fileRank !== b.fileRank) return a.fileRank - b.fileRank;
      return a.line - b.line;
    });
    return rows;
  }, [files, general, inlineThreads, drafts]);

  const navItems = options.hideResolved
    ? commentItems.filter((i) => !i.resolved)
    : commentItems;
  const navIndex = navItems.findIndex((i) => i.id === focusThreadId);

  // Scroll to any comment or draft by id; falls back to the file.
  const jumpToId = useCallback((id: string, file: string | null) => {
    setFocusThreadId(id);
    setMode('diff');
    if (file) setSelectedFile(file);
    requestAnimationFrame(() => {
      const root = scrollRef.current;
      const el = root?.querySelector<HTMLElement>(
        `[data-thread="${CSS.escape(id)}"], [data-draft="${CSS.escape(id)}"]`
      );
      if (el) el.scrollIntoView({ block: 'center' });
      else if (file)
        root
          ?.querySelector<HTMLElement>(`[data-file="${CSS.escape(file)}"]`)
          ?.scrollIntoView({ block: 'start' });
      else root?.scrollTo({ top: 0 });
    });
  }, []);
  const jumpToItem = useCallback(
    (item: CommentListItem) => {
      const row = commentItems.find((r) => r.id === item.id);
      jumpToId(item.id, (row as { file?: string | null })?.file ?? null);
    },
    [commentItems, jumpToId]
  );
  const step = (delta: number) => {
    if (navItems.length === 0) return;
    const next =
      navIndex < 0 ? 0 : (navIndex + delta + navItems.length) % navItems.length;
    const target = navItems[next] as { id: string; file?: string | null };
    jumpToId(target.id, target.file ?? null);
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PrHeader pr={pr} fileCount={files.length} />
      <div className="flex min-h-0 min-w-0 flex-1">
        {railHidden ? (
          <div className="flex w-9 shrink-0 flex-col items-center border-r border-border bg-sidebar pt-1">
            <Tip label="Show review sidebar" side="right">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setRailHidden(false)}
                aria-label="Show review sidebar"
              >
                <PanelLeftOpenIcon />
              </Button>
            </Tip>
          </div>
        ) : null}

        <Group orientation="horizontal" className="min-h-0 min-w-0 flex-1">
          {!railHidden && (
            <>
              <Panel
                id="review-rail"
                defaultSize="270px"
                minSize="200px"
                maxSize="45%"
                className="min-w-0"
              >
                <ReviewRail
                  running={running}
                  busy={busy}
                  hasSession={Boolean(sessionName)}
                  agentActive={effMode === 'agent'}
                  onSelectAgent={() => setMode('agent')}
                  onLaunch={onLaunch}
                  onStop={onStop}
                  onHide={() => setRailHidden(true)}
                  drafts={drafts}
                  reviewActive={effMode === 'review'}
                  onReview={() => setMode('review')}
                  postingAll={postAll.isPending}
                  onPostAll={() =>
                    postAll.mutate(
                      { prId: pr.id, headSha: pr.headSha },
                      {
                        onSuccess: (n) =>
                          toast.success(
                            `Posted ${n} comment${n === 1 ? '' : 's'}`
                          ),
                        onError: (e) =>
                          toast.error(`Post failed: ${errorMessage(e)}`),
                      }
                    )
                  }
                  entries={entries}
                  diffLoading={diff.isLoading}
                  selectedFile={effMode === 'diff' ? selectedFile : null}
                  onSelectFile={jumpToFile}
                  commentItems={commentItems}
                  activeCommentId={effMode === 'diff' ? focusThreadId : null}
                  onJumpComment={jumpToItem}
                />
              </Panel>
              <PanelSeparator className="relative w-px bg-border transition-colors after:absolute after:inset-y-0 after:-left-1 after:w-2 hover:bg-primary data-[resize-handle-state=drag]:bg-primary" />
            </>
          )}

          <Panel id="review-content" minSize="30%" className="min-w-0">
            <div className="relative h-full min-h-0">
              {sessionName && (
                <div
                  className={cn(
                    'absolute inset-0',
                    effMode !== 'agent' && 'invisible'
                  )}
                >
                  <SessionTerminal
                    name={sessionName}
                    active={active && effMode === 'agent'}
                  />
                </div>
              )}
              {hasDrafts && (
                <div
                  className={cn(
                    'absolute inset-0',
                    effMode !== 'review' && 'invisible'
                  )}
                >
                  {effMode === 'review' && (
                    <ReviewStepper
                      prId={pr.id}
                      headSha={pr.headSha}
                      drafts={drafts}
                      filesByName={filesByName}
                      fileOrder={fileOrder}
                      onExit={() => setMode('diff')}
                      onOpenInDiff={(file) => jumpToFile(file)}
                    />
                  )}
                </div>
              )}
              <div
                className={cn(
                  'absolute inset-0',
                  effMode !== 'diff' && 'invisible'
                )}
              >
                <DiffPane
                  pr={pr}
                  files={files}
                  threadsByFile={threadsByFile}
                  draftsByFile={draftsByFile}
                  generalThreads={
                    options.hideResolved
                      ? general.filter((t) => !t.isResolved)
                      : general
                  }
                  commentsLoading={comments.isLoading}
                  diffLoading={diff.isLoading}
                  diffError={diff.error ? String(diff.error.message) : null}
                  focusThreadId={focusThreadId}
                  scrollRef={scrollRef}
                  navCount={navItems.length}
                  navIndex={navIndex}
                  onPrev={() => step(-1)}
                  onNext={() => step(1)}
                />
              </div>
            </div>
          </Panel>
        </Group>
      </div>
    </div>
  );
}

/** One merged header bar: PR identity + meta (author, CI, reviewers,
 *  comments, files changed) + Open. The diff *settings* live separately
 *  inside the diff pane. */
function PrHeader({
  pr,
  fileCount,
}: {
  pr: PullRequestInfo;
  fileCount: number;
}) {
  const reviewers = pr.reviewers ?? [];
  const ci = pr.buildStatus;
  return (
    <header className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-3">
      <GitPullRequestIcon className="size-4 shrink-0 text-info" />
      <span className="flex min-w-0 shrink items-center gap-2">
        <span className="truncate font-medium">{pr.title}</span>
        <span className="shrink-0 text-sm text-muted-foreground">#{pr.id}</span>
        <span className="hidden truncate font-mono text-xs text-muted-foreground sm:inline">
          {pr.sourceBranch} → {pr.targetBranch}
        </span>
      </span>

      <span className="mx-1 h-4 w-px shrink-0 bg-border" />

      <span className="flex min-w-0 items-center gap-2 text-sm">
        <Tip label={`Opened by ${pr.createdByDisplayName}`}>
          <span className="flex items-center gap-1.5">
            <Avatar name={pr.createdByDisplayName} size="xs" />
            <span className="hidden truncate text-muted-foreground md:inline">
              {pr.createdByDisplayName}
            </span>
          </span>
        </Tip>
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
          <span className="flex items-center gap-1.5">
            {reviewers.slice(0, 6).map((r) => (
              <Tip
                key={r.identifier}
                label={`${r.displayName}: ${r.decision.replace('-', ' ')}`}
              >
                <span className="relative">
                  <Avatar name={r.displayName} size="xs" />
                  <span
                    className={cn(
                      'absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-2 ring-background',
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
          <span className="flex items-center gap-0.5 text-muted-foreground">
            <MessageSquareIcon className="size-3.5" />
            {pr.activeCommentCount}
          </span>
        )}
      </span>

      <div className="flex-1" />

      <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline">
        {fileCount} file{fileCount === 1 ? '' : 's'} changed
      </span>
      <Tip label="Open on the provider">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void window.kirby.openExternal(pr.url)}
        >
          <ExternalLinkIcon /> Open
        </Button>
      </Tip>
    </header>
  );
}

function ReviewRail({
  running,
  busy,
  hasSession,
  agentActive,
  onSelectAgent,
  onLaunch,
  onStop,
  onHide,
  drafts,
  reviewActive,
  onReview,
  postingAll,
  onPostAll,
  entries,
  diffLoading,
  selectedFile,
  onSelectFile,
  commentItems,
  activeCommentId,
  onJumpComment,
}: {
  running: boolean;
  busy: boolean;
  hasSession: boolean;
  agentActive: boolean;
  onSelectAgent: () => void;
  onLaunch: () => void;
  onStop: () => void;
  onHide: () => void;
  drafts: ReviewComment[];
  reviewActive: boolean;
  onReview: () => void;
  postingAll: boolean;
  onPostAll: () => void;
  entries: FileEntry[];
  diffLoading: boolean;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  commentItems: CommentListItem[];
  activeCommentId: string | null;
  onJumpComment: (item: CommentListItem) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar/60">
      <div className="flex h-8 shrink-0 items-center justify-between pr-1 pl-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Review
        </span>
        <Tip label="Hide review sidebar">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onHide}
            aria-label="Hide review sidebar"
          >
            <PanelLeftCloseIcon />
          </Button>
        </Tip>
      </div>

      {/* Agent — a running row you can select to view the terminal, or
          a launch button (opening the session/review menu) otherwise. */}
      <div className="shrink-0 border-b border-border px-2 pb-2">
        {running ? (
          <div className="flex items-center gap-1">
            <button
              onClick={onSelectAgent}
              className={cn(
                'flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-base transition-colors',
                agentActive
                  ? 'bg-sidebar-active text-foreground'
                  : 'hover:bg-sidebar-accent'
              )}
            >
              <span className="relative flex size-4 shrink-0 items-center justify-center">
                <BotIcon className="size-4 text-muted-foreground" />
                <span className="absolute -right-0.5 -bottom-0.5 flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-success ring-2 ring-sidebar" />
                </span>
              </span>
              <span className="min-w-0 flex-1 truncate text-left">Agent</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                running
              </span>
            </button>
            <Tip label="Stop agent">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onStop}
                aria-label="Stop agent"
              >
                <SquareIcon />
              </Button>
            </Tip>
          </div>
        ) : (
          <Button
            className="w-full"
            size="sm"
            onClick={onLaunch}
            disabled={busy}
          >
            <PlayIcon />{' '}
            {busy ? 'Working…' : hasSession ? 'Relaunch agent' : 'Launch agent'}
          </Button>
        )}
      </div>

      {/* Review ready — enter the draft walkthrough */}
      {drafts.length > 0 && (
        <div className="shrink-0 border-b border-border px-2 py-2">
          <button
            onClick={onReview}
            className={cn(
              'flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors',
              reviewActive
                ? 'border-primary bg-primary/10'
                : 'border-border hover:bg-sidebar-accent'
            )}
          >
            <ClipboardCheckIcon className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-base font-medium">Review ready</span>
              <span className="block text-xs text-muted-foreground">
                {(() => {
                  const c = severityCounts(drafts);
                  return [
                    c.critical && `${c.critical} critical`,
                    c.major && `${c.major} major`,
                    c.minor && `${c.minor} minor`,
                    c.nit && `${c.nit} nit`,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                })()}
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground tabular-nums">
              {drafts.length}
            </span>
          </button>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            onClick={onPostAll}
            disabled={postingAll}
          >
            {postingAll ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <SendIcon />
            )}
            Post all {drafts.length} draft{drafts.length === 1 ? '' : 's'}
          </Button>
        </div>
      )}

      {/* Files + Comments */}
      <ScrollArea className="min-h-0 flex-1">
        <FileTree
          entries={entries}
          loading={diffLoading}
          selected={selectedFile}
          onSelect={onSelectFile}
        />
        <CommentsList
          items={commentItems}
          activeId={activeCommentId}
          onJump={onJumpComment}
        />
      </ScrollArea>
    </div>
  );
}
