/**
 * The file tree's shape, and the one rule that decides what it shows
 * open after a refresh.
 *
 * A worktree tab re-fetches its diff every two seconds while the agent
 * runs, so the tree is rebuilt constantly. Collapsing a folder has to
 * survive that: the state is a function of the *previous state* and the
 * *delta between two snapshots*, never of the poll itself. Two refreshes
 * that report the same files must leave the tree exactly as the user
 * left it — which is why `collapseAfterRefresh` returns the state object
 * it was given, unchanged, whenever nothing moved.
 */

/** One row of the tree, as far as the collapse rule is concerned. */
export interface TreeFile {
  path: string;
  /** Changes identity when this file's contents change. */
  revision: string;
}

export interface DirNode<E> {
  kind: 'dir';
  name: string;
  path: string;
  children: TreeNode<E>[];
}
export interface FileNode<E> {
  kind: 'file';
  name: string;
  entry: E;
}
export type TreeNode<E> = DirNode<E> | FileNode<E>;

/**
 * Build a directory tree and collapse single-child directory chains
 * (`src/lib/utils` as one row) the way VS Code's compact folders do.
 *
 * Every `DirNode.path` is the full path from the repo root, including
 * for a compacted chain, so a directory keeps the same identity however
 * its chain is drawn — which is what lets the collapsed set below be
 * keyed by path rather than by row.
 */
export function buildTree<E extends { path: string }>(
  entries: readonly E[]
): TreeNode<E>[] {
  const root: DirNode<E> = { kind: 'dir', name: '', path: '', children: [] };
  for (const entry of entries) {
    const parts = entry.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      let next = node.children.find(
        (c): c is DirNode<E> => c.kind === 'dir' && c.name === name
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
  const compact = (node: DirNode<E>): DirNode<E> => {
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

/**
 * Which folders the user has closed, plus the snapshot those closures
 * were last reconciled against.
 *
 * `seen` is null until the first non-empty snapshot arrives. An empty
 * snapshot is never recorded: the parse of a fresh patch runs off the
 * main thread and the tree renders empty for a tick while it does, and
 * treating that blank as "every file is gone" would make the next
 * snapshot look brand new and throw the tree open.
 */
export interface TreeCollapse {
  collapsed: ReadonlySet<string>;
  seen: ReadonlyMap<string, string> | null;
}

export const NO_COLLAPSE: TreeCollapse = {
  collapsed: new Set<string>(),
  seen: null,
};

/** Every directory that contains `path`, deepest last. */
export function ancestorDirs(path: string): string[] {
  const parts = path.split('/');
  const dirs: string[] = [];
  for (let i = 1; i < parts.length; i++) dirs.push(parts.slice(0, i).join('/'));
  return dirs;
}

function snapshotOf(files: readonly TreeFile[]): Map<string, string> {
  return new Map(files.map((f) => [f.path, f.revision]));
}

/**
 * Paths that are new, or whose contents changed, since `seen`.
 *
 * A file that merely still exists is not a change — that is the whole
 * point: the agent writing `src/a.ts` must not disturb a folder the
 * user closed somewhere else, and no amount of polling may either.
 */
export function changedPaths(
  seen: ReadonlyMap<string, string> | null,
  files: readonly TreeFile[]
): string[] {
  if (seen === null) return [];
  return files
    .filter((f) => seen.get(f.path) !== f.revision)
    .map((f) => f.path);
}

/**
 * Reconcile the collapsed set with a freshly parsed snapshot: open the
 * ancestors of files this refresh actually touched, leave every other
 * folder exactly as it was.
 *
 * Returns the same object when neither the collapsed set nor the
 * snapshot moved, so a caller can drive this from an effect on every
 * poll without re-rendering.
 */
export function collapseAfterRefresh(
  state: TreeCollapse,
  files: readonly TreeFile[]
): TreeCollapse {
  // The blank tick between two parses. Recording it would make every
  // file look new next time round.
  if (files.length === 0) return state;

  const next = snapshotOf(files);
  const touched = changedPaths(state.seen, files);

  let opened: Set<string> | null = null;
  for (const path of touched) {
    for (const dir of ancestorDirs(path)) {
      if (!state.collapsed.has(dir)) continue;
      opened ??= new Set(state.collapsed);
      opened.delete(dir);
    }
  }

  if (opened === null && sameSnapshot(state.seen, next)) return state;
  return { collapsed: opened ?? state.collapsed, seen: next };
}

function sameSnapshot(
  a: ReadonlyMap<string, string> | null,
  b: ReadonlyMap<string, string>
): boolean {
  if (a === null || a.size !== b.size) return false;
  for (const [path, revision] of b) if (a.get(path) !== revision) return false;
  return true;
}

/** Open a closed folder, or close an open one. */
export function toggleCollapsed(
  state: TreeCollapse,
  path: string
): TreeCollapse {
  const collapsed = new Set(state.collapsed);
  if (!collapsed.delete(path)) collapsed.add(path);
  return { ...state, collapsed };
}
