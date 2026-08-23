import {
  CheckCircle2Icon,
  CircleDotIcon,
  MessageSquareIcon,
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
import type { RemoteCommentThread } from '../../../host/contract.js';
import { useDiff, useThreads } from '../../lib/queries.js';
import { useRepo } from '../../lib/repo-context.js';
import { cn } from '../../lib/utils.js';
import { Avatar } from '../ui/avatar.js';
import { Badge } from '../ui/badge.js';
import { Skeleton } from '../ui/skeleton.js';
import { Tip } from '../ui/tooltip.js';
import { DiffView } from './DiffView.js';
import { FileTree, type FileEntry } from './FileTree.js';
import { ConversationPanel } from './ConversationPanel.js';

/**
 * PR review tab: meta strip up top, then a resizable file tree beside
 * the full diff. Inline review threads render at their line; general
 * PR comments live in a collapsible "Conversation" block at the top
 * of the diff column.
 */
export function PrReview({ pr }: { pr: PullRequestInfo }) {
  const { repo } = useRepo();
  const diff = useDiff(repo.cwd, pr.sourceBranch, pr.targetBranch);
  const comments = useThreads(repo.cwd, pr.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const files = useMemo<[string, DiffLine[]][]>(() => {
    if (!diff.data) return [];
    return [...parseUnifiedDiff(diff.data).entries()];
  }, [diff.data]);

  const threadsByFile = useMemo(() => {
    const map = new Map<string, RemoteCommentThread[]>();
    for (const t of comments.data?.threads ?? []) {
      if (t.file == null) continue;
      const arr = map.get(t.file) ?? [];
      arr.push(t);
      map.set(t.file, arr);
    }
    return map;
  }, [comments.data]);

  const entries = useMemo<FileEntry[]>(
    () =>
      files.map(([filename, lines]) => ({
        path: filename,
        additions: lines.filter((l) => l.type === 'add').length,
        deletions: lines.filter((l) => l.type === 'remove').length,
        comments: (threadsByFile.get(filename) ?? []).filter(
          (t) => !t.isResolved
        ).length,
      })),
    [files, threadsByFile]
  );

  const jumpTo = useCallback((path: string) => {
    setSelectedFile(path);
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-file="${CSS.escape(path)}"]`
    );
    el?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, []);

  const general = comments.data?.generalComments ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MetaStrip pr={pr} fileCount={files.length} />
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel
          defaultSize="260px"
          minSize="160px"
          maxSize="50%"
          className="min-w-0"
        >
          <FileTree
            entries={entries}
            loading={diff.isLoading}
            selected={selectedFile}
            onSelect={jumpTo}
          />
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
                threads={general}
                loading={comments.isLoading}
                prId={pr.id}
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
                prId={pr.id}
              />
            ))}
          </div>
        </Panel>
      </Group>
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
