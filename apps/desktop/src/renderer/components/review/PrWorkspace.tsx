import { GitBranchIcon, PanelLeftOpenIcon } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Group,
  Panel,
  Separator as PanelSeparator,
} from 'react-resizable-panels';
import { toast } from 'sonner';
import { type DiffLine } from '@kirby/diff';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../host/contract.js';
import { useDiffOptions } from '../../lib/diff-options.js';
import {
  useDiff,
  useDraftComments,
  useParsedDiff,
  usePostDrafts,
  useThreads,
  useWorktreeDiff,
} from '../../lib/queries.js';
import { useRepo } from '../../lib/repo-context.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { SessionTerminal } from '../terminal/SessionTerminal.js';
import { Button } from '../ui/button.js';
import { Tip } from '../ui/tooltip.js';
import { type CommentListItem } from './CommentsList.js';
import { DiffPane } from './DiffPane.js';
import { type DiffJumpHandle } from './VirtualDiffList.js';
import { type FileEntry } from './FileTree.js';
import { OverviewPane } from './OverviewPane.js';
import { OpenInEditorButton, PrHeader } from './PrHeader.js';
import { ReviewRail } from './ReviewRail.js';
import { ReviewStepper } from './ReviewStepper.js';

type Mode = 'diff' | 'agent' | 'review' | 'overview';

/** Shared empty parse, so "no files yet" keeps a stable identity and
 *  the derived lists below are not rebuilt on every render. */
const NO_FILES: [string, DiffLine[]][] = [];

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
  branch,
  baseBranch,
  sessionName,
  running,
  active,
  busy,
  onLaunch,
  onStop,
}: {
  /** Absent for a worktree without a PR: the rail degrades gracefully
   *  (no comments, drafts or review walkthrough — just Agent + Files). */
  pr?: PullRequestInfo;
  branch: string;
  baseBranch: string;
  /** PTY session for this branch, if one exists (running or its final frame). */
  sessionName?: string;
  running: boolean;
  active: boolean;
  busy: boolean;
  onLaunch: () => void;
  onStop: () => void;
}) {
  const { repo } = useRepo();
  const prId = pr?.id ?? 0;
  // A pull request is reviewed against its commits — that is what the
  // comment threads anchor to. A worktree without one has nothing to
  // anchor, so it shows the working tree instead and follows the agent
  // as it edits, which is the whole reason to have the pane open while
  // one is running.
  const isWorktreeOnly = pr == null;
  const commitDiff = useDiff(repo.cwd, branch, baseBranch, {
    enabled: !isWorktreeOnly,
  });
  const workingDiff = useWorktreeDiff(repo.cwd, branch, baseBranch, {
    enabled: isWorktreeOnly,
    live: running,
  });
  const diff = isWorktreeOnly ? workingDiff : commitDiff;
  const comments = useThreads(repo.cwd, prId);
  const draftsQuery = useDraftComments(repo.cwd, prId);
  const postAll = usePostDrafts(repo.cwd);
  const options = useDiffOptions();
  const scrollRef = useRef<HTMLDivElement>(null);
  const diffJumpRef = useRef<DiffJumpHandle | null>(null);

  const [mode, setMode] = useState<Mode>(running ? 'agent' : 'diff');
  const [railHidden, setRailHidden] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [focusThreadId, setFocusThreadId] = useState<string | null>(null);

  // Jump to the terminal the moment an agent starts running.
  const [prevRunning, setPrevRunning] = useState(running);
  if (running !== prevRunning) {
    setPrevRunning(running);
    if (running) setMode('agent');
  }
  // Coming (back) to a tab with a running agent shows the agent, not
  // the diff — the agent is what the user is working in.
  const [prevActive, setPrevActive] = useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    if (active && running) setMode('agent');
  }
  // Whole-file diffs can be megabytes; the parse runs in the diff
  // worker so opening a tab never blocks the UI thread on it. The query
  // is keyed on the patch content, so what it hands back always belongs
  // to the text on screen — while a newer patch is parsing there is no
  // data for its key and the viewer shows no files, never the old ones.
  const parsed = useParsedDiff(diff.data);
  const files = parsed.data ?? NO_FILES;
  const diffPending =
    diff.isLoading || (diff.data != null && parsed.data === undefined);
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
      : mode === 'overview' && pr
      ? 'overview'
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
    requestAnimationFrame(() => diffJumpRef.current?.jumpToFile(path));
  }, []);

  // Unified, document-ordered comment list: general (Conversation)
  // first, then per file [threads + drafts] by line. Powers both the
  // sidebar Comments list and the diff toolbar's prev/next nav, so both
  // move between remote comments AND agent drafts.
  const allCommentItems = useMemo<CommentListItem[]>(() => {
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

  // One filtered list for everything that walks comments: the rail's
  // Comments list, and the toolbar's prev/next. Hiding resolved threads
  // in the diff while still listing them in the rail — and letting nav
  // jump to one that is not rendered — was the inconsistency here.
  const commentItems = options.hideResolved
    ? allCommentItems.filter((i) => !i.resolved)
    : allCommentItems;
  const navIndex = commentItems.findIndex((i) => i.id === focusThreadId);

  // Scroll to any comment or draft by id; falls back to the file. Goes
  // through the virtual list's imperative handle — the target row may
  // not be materialized as DOM yet.
  const jumpToId = useCallback((id: string, file: string | null) => {
    setFocusThreadId(id);
    setMode('diff');
    if (file) setSelectedFile(file);
    requestAnimationFrame(() => {
      const jump = diffJumpRef.current;
      if (jump?.jumpToId(id)) return;
      if (file && jump?.jumpToFile(file)) return;
      scrollRef.current?.scrollTo({ top: 0 });
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
    if (commentItems.length === 0) return;
    const next =
      navIndex < 0
        ? 0
        : (navIndex + delta + commentItems.length) % commentItems.length;
    const target = commentItems[next] as { id: string; file?: string | null };
    jumpToId(target.id, target.file ?? null);
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {pr ? (
        <PrHeader pr={pr} />
      ) : (
        <BranchHeader
          branch={branch}
          baseBranch={baseBranch}
          fileCount={files.length}
        />
      )}
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
                  hasPr={Boolean(pr)}
                  overviewActive={effMode === 'overview'}
                  onOverview={() => setMode('overview')}
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
                      { prId, headSha: pr?.headSha },
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
                  diffLoading={diffPending}
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
                      prId={prId}
                      headSha={pr?.headSha}
                      drafts={drafts}
                      filesByName={filesByName}
                      fileOrder={fileOrder}
                      active={active}
                      onExit={() => setMode('diff')}
                      onOpenInDiff={(file) => jumpToFile(file)}
                    />
                  )}
                </div>
              )}
              {pr && effMode === 'overview' && (
                <div className="absolute inset-0">
                  <OverviewPane pr={pr} />
                </div>
              )}
              <div
                className={cn(
                  'absolute inset-0',
                  effMode !== 'diff' && 'invisible'
                )}
              >
                <DiffPane
                  prId={prId}
                  headSha={pr?.headSha}
                  sourceBranch={branch}
                  targetBranch={baseBranch}
                  files={files}
                  threadsByFile={threadsByFile}
                  draftsByFile={draftsByFile}
                  generalThreads={
                    options.hideResolved
                      ? general.filter((t) => !t.isResolved)
                      : general
                  }
                  commentsLoading={comments.isLoading}
                  diffLoading={diffPending}
                  diffError={diff.error ? String(diff.error.message) : null}
                  focusThreadId={focusThreadId}
                  scrollRef={scrollRef}
                  jumpRef={diffJumpRef}
                  navCount={commentItems.length}
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

/** Header for a worktree tab without a PR: branch → base + files count. */
function BranchHeader({
  branch,
  baseBranch,
  fileCount,
}: {
  branch: string;
  baseBranch: string;
  fileCount: number;
}) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-3">
      <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 shrink items-center gap-2">
        <span className="truncate font-medium">{branch}</span>
        <span className="hidden truncate font-mono text-xs text-muted-foreground sm:inline">
          diff vs {baseBranch}
        </span>
      </span>
      <div className="flex-1" />
      <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline">
        {fileCount} file{fileCount === 1 ? '' : 's'} changed
      </span>
      <OpenInEditorButton branch={branch} />
    </header>
  );
}
