import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  FilesIcon,
  FolderIcon,
  MessageSquareIcon,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import {
  buildTree,
  collapseAfterRefresh,
  NO_COLLAPSE,
  toggleCollapsed,
  type TreeCollapse,
  type TreeNode,
} from '../../../lib/diff/file-tree-model.js';
import { cn } from '../../../lib/utils.js';
import { ScrollArea } from '../../ui/scroll-area.js';
import { Skeleton } from '../../ui/skeleton.js';

export interface FileEntry {
  path: string;
  /** Identity of this file's changed lines — see `fileRevision`. */
  revision: string;
  additions: number;
  deletions: number;
  comments: number;
  /** Unposted agent drafts in this file. */
  drafts?: number;
}

/**
 * The diff's files as a tree.
 *
 * Which folders are open lives here rather than in each row, and that
 * is load-bearing rather than tidy. A worktree tab re-fetches its diff
 * every two seconds while the agent runs; the parse happens off the
 * main thread, so between two patches the tree is briefly handed no
 * files at all. Row-local state dies with the row on that blank tick,
 * which is why an agent writing a file used to throw every folder in
 * the tree open. `file-tree-model.ts` owns the rule that replaces it.
 */
export function FileTree({
  entries,
  loading,
  selected,
  onSelect,
}: {
  entries: FileEntry[];
  loading: boolean;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [collapse, setCollapse] = useState<TreeCollapse>(NO_COLLAPSE);
  const tree = useMemo(() => buildTree(entries), [entries]);
  const totals = useMemo(
    () =>
      entries.reduce(
        (acc, e) => ({
          additions: acc.additions + e.additions,
          deletions: acc.deletions + e.deletions,
        }),
        { additions: 0, deletions: 0 }
      ),
    [entries]
  );

  // Adjusted during render rather than from an effect: React's own
  // "adjusting state when a prop changes" pattern. `collapseAfterRefresh`
  // hands back the state it was given when nothing moved, so a poll that
  // changed nothing settles in the same render.
  const [reconciled, setReconciled] = useState(entries);
  if (reconciled !== entries) {
    setReconciled(entries);
    setCollapse(collapseAfterRefresh(collapse, entries));
  }

  const onToggle = useCallback((path: string) => {
    setCollapse((c) => toggleCollapsed(c, path));
  }, []);

  return (
    <div
      data-file-tree
      className={cn('flex flex-col', open ? 'h-full' : 'shrink-0')}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 shrink-0 items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDownIcon className="size-3.5" />
        ) : (
          <ChevronRightIcon className="size-3.5" />
        )}
        <FilesIcon className="size-3.5" />
        Files
        {entries.length > 0 && (
          <span className="ml-auto font-mono font-normal normal-case tracking-normal tabular-nums">
            <span className="text-success">+{totals.additions}</span>{' '}
            <span className="text-destructive">−{totals.deletions}</span>
          </span>
        )}
      </button>
      {open && (
        <ScrollArea className="min-h-0 flex-1">
          {loading && (
            <div className="space-y-2 px-3 py-1">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}
          <div className="pb-2">
            {tree.map((node) => (
              <TreeRow
                key={node.kind === 'dir' ? node.path : node.entry.path}
                node={node}
                depth={0}
                collapsed={collapse.collapsed}
                onToggle={onToggle}
                selected={selected}
                onSelect={onSelect}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  collapsed,
  onToggle,
  selected,
  onSelect,
}: {
  node: TreeNode<FileEntry>;
  depth: number;
  collapsed: ReadonlySet<string>;
  onToggle: (path: string) => void;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const pad = { paddingLeft: 8 + depth * 12 };

  if (node.kind === 'dir') {
    const open = !collapsed.has(node.path);
    return (
      <div>
        <button
          type="button"
          onClick={() => onToggle(node.path)}
          style={pad}
          aria-expanded={open}
          className="flex h-[22px] w-full items-center gap-1 pr-2 text-base text-foreground/90 hover:bg-accent"
        >
          <ChevronRightIcon
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90'
            )}
          />
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{node.name}</span>
        </button>
        {open &&
          node.children.map((c) => (
            <TreeRow
              key={c.kind === 'dir' ? c.path : c.entry.path}
              node={c}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
      </div>
    );
  }

  const { entry } = node;
  const isSel = selected === entry.path;
  return (
    <button
      type="button"
      onClick={() => onSelect(entry.path)}
      style={{ paddingLeft: 8 + depth * 12 + 16 }}
      title={entry.path}
      className={cn(
        'flex h-[22px] w-full items-center gap-1.5 pr-2 text-base hover:bg-accent',
        isSel ? 'bg-sidebar-active text-foreground' : 'text-foreground/90'
      )}
    >
      <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-left">{node.name}</span>
      {(entry.drafts ?? 0) > 0 && (
        <span
          className="rounded border border-dashed border-border px-1 text-[10px] text-muted-foreground"
          title={`${entry.drafts} draft comment${
            entry.drafts === 1 ? '' : 's'
          }`}
        >
          {entry.drafts}
        </span>
      )}
      {entry.comments > 0 && (
        <span className="flex items-center gap-0.5 text-xs text-warning">
          <MessageSquareIcon className="size-3" />
          {entry.comments}
        </span>
      )}
      <span className="shrink-0 font-mono text-xs tabular-nums">
        <span className="text-success">+{entry.additions}</span>{' '}
        <span className="text-destructive">−{entry.deletions}</span>
      </span>
    </button>
  );
}
