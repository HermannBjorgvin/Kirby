import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  FilesIcon,
  FolderIcon,
  MessageSquareIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '../../lib/utils.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { Skeleton } from '../ui/skeleton.js';

export interface FileEntry {
  path: string;
  additions: number;
  deletions: number;
  comments: number;
  /** Unposted agent drafts in this file. */
  drafts?: number;
}

interface DirNode {
  kind: 'dir';
  name: string;
  path: string;
  children: TreeNode[];
}
interface FileNode {
  kind: 'file';
  name: string;
  entry: FileEntry;
}
type TreeNode = DirNode | FileNode;

/** Build a directory tree and collapse single-child directory chains
 *  (`src/lib/utils` as one row) the way VS Code's compact folders do. */
function buildTree(entries: FileEntry[]): TreeNode[] {
  const root: DirNode = { kind: 'dir', name: '', path: '', children: [] };
  for (const entry of entries) {
    const parts = entry.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      let next = node.children.find(
        (c): c is DirNode => c.kind === 'dir' && c.name === name
      );
      if (!next) {
        next = {
          kind: 'dir',
          name,
          path: parts.slice(0, i + 1).join('/'),
          children: [],
        };
        node.children.push(next);
      }
      node = next;
    }
    node.children.push({ kind: 'file', name: parts[parts.length - 1], entry });
  }
  const compact = (node: DirNode): DirNode => {
    let cur = node;
    while (cur.children.length === 1 && cur.children[0].kind === 'dir') {
      const only = cur.children[0];
      cur = {
        kind: 'dir',
        name: cur.name ? `${cur.name}/${only.name}` : only.name,
        path: only.path,
        children: only.children,
      };
    }
    return {
      ...cur,
      children: cur.children
        .map((c) => (c.kind === 'dir' ? compact(c) : c))
        .sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
    };
  };
  return compact(root).children;
}

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

  return (
    <div className={cn('flex flex-col', open ? 'h-full' : 'shrink-0')}>
      <button
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
  selected,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const pad = { paddingLeft: 8 + depth * 12 };

  if (node.kind === 'dir') {
    return (
      <div>
        <button
          onClick={() => setOpen((o) => !o)}
          style={pad}
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
