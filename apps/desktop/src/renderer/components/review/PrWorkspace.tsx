import { PanelLeftOpenIcon } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Group,
  Panel,
  Separator as PanelSeparator,
} from 'react-resizable-panels';
import { toast } from 'sonner';
import { type DiffLine } from '@kirby/diff';
import type { PullRequestInfo } from '@kirby/vcs-core';
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
import {
  buildCommentRows,
  buildFileEntries,
  diffIsPending,
  groupDraftsByFile,
  groupThreadsByFile,
  navIndexOf,
  resolveMode,
  stepComment,
  unpostedDrafts,
  visibleComments,
  type Mode,
} from '../../lib/review-model.js';
import { errorMessage } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { Tip } from '../ui/tooltip.js';
import { ContentPane } from './ContentPane.js';
import { type CommentListItem } from './CommentsList.js';
import { type DiffJumpHandle } from './VirtualDiffList.js';
import { type FileEntry } from './FileTree.js';
import { BranchHeader, PrHeader } from './PrHeader.js';
import { ReviewRail } from './ReviewRail.js';

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
 *
 * What to show is decided in `lib/review-model.ts`; this component
 * wires that to the queries, the refs and the markup.
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
  const diffPending = diffIsPending(diff.isLoading, diff.data, parsed.data);
  const inlineThreads = useMemo(
    () => comments.data?.threads ?? [],
    [comments.data]
  );
  const general = useMemo(
    () => comments.data?.generalComments ?? [],
    [comments.data]
  );
  const drafts = useMemo(
    () => unpostedDrafts(draftsQuery.data ?? []),
    [draftsQuery.data]
  );
  const draftsByFile = useMemo(() => groupDraftsByFile(drafts), [drafts]);
  const threadsByFile = useMemo(
    () => groupThreadsByFile(inlineThreads),
    [inlineThreads]
  );

  const fileOrder = useMemo(
    () => new Map(files.map(([f], i) => [f, i])),
    [files]
  );
  const filesByName = useMemo(() => new Map(files), [files]);

  const hasDrafts = drafts.length > 0;
  const effMode = resolveMode(mode, {
    hasSession: Boolean(sessionName),
    hasDrafts,
    hasPr: pr != null,
  });

  const entries = useMemo<FileEntry[]>(
    () => buildFileEntries(files, threadsByFile, draftsByFile),
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
  const allCommentItems = useMemo(
    () => buildCommentRows(files, general, inlineThreads, drafts),
    [files, general, inlineThreads, drafts]
  );

  // One filtered list for everything that walks comments: the rail's
  // Comments list, and the toolbar's prev/next. Hiding resolved threads
  // in the diff while still listing them in the rail — and letting nav
  // jump to one that is not rendered — was the inconsistency here.
  const commentItems = visibleComments(allCommentItems, options.hideResolved);
  const navIndex = navIndexOf(commentItems, focusThreadId);

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
      jumpToId(item.id, row?.file ?? null);
    },
    [commentItems, jumpToId]
  );
  const step = (delta: number) => {
    const target = stepComment(commentItems, navIndex, delta);
    if (!target) return;
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
            <ContentPane
              effMode={effMode}
              pr={pr}
              prId={prId}
              branch={branch}
              baseBranch={baseBranch}
              sessionName={sessionName}
              active={active}
              files={files}
              filesByName={filesByName}
              fileOrder={fileOrder}
              threadsByFile={threadsByFile}
              draftsByFile={draftsByFile}
              general={general}
              hideResolved={options.hideResolved}
              drafts={drafts}
              hasDrafts={hasDrafts}
              commentsLoading={comments.isLoading}
              diffPending={diffPending}
              diffError={diff.error}
              focusThreadId={focusThreadId}
              scrollRef={scrollRef}
              jumpRef={diffJumpRef}
              navCount={commentItems.length}
              navIndex={navIndex}
              onPrev={() => step(-1)}
              onNext={() => step(1)}
              onExitReview={() => setMode('diff')}
              onOpenInDiff={(file) => jumpToFile(file)}
            />
          </Panel>
        </Group>
      </div>
    </div>
  );
}
