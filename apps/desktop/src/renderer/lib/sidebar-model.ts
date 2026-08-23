import type { SidebarItem } from '../../host/contract.js';

export type SectionKey =
  | 'worktrees'
  | 'draft-pull-requests'
  | 'pull-requests'
  | 'needs-review'
  | 'waiting'
  | 'approved';

export const SECTION_ORDER: SectionKey[] = [
  'worktrees',
  'draft-pull-requests',
  'pull-requests',
  'needs-review',
  'waiting',
  'approved',
];

export const SECTION_LABEL: Record<SectionKey, string> = {
  worktrees: 'Worktrees',
  'draft-pull-requests': 'Draft Pull Requests',
  'pull-requests': 'Pull Requests',
  'needs-review': 'Needs Your Review',
  waiting: 'Waiting for Author',
  approved: 'Approved by You',
};

/** Mirror of app-core getItemKey (kept renderer-local to avoid pulling
 *  the Node-touching barrel into the browser bundle). */
export function itemKey(item: SidebarItem): string {
  if (item.kind === 'session') return `session:${item.session.name}`;
  if (item.kind === 'orphan-pr') return `orphan:${item.pr.id}`;
  return `review:${item.pr.id}`;
}

export function sectionKey(item: SidebarItem): SectionKey {
  if (item.kind === 'session') {
    if (!item.pr) return 'worktrees';
    return item.pr.isDraft ? 'draft-pull-requests' : 'pull-requests';
  }
  if (item.kind === 'orphan-pr') {
    return item.pr.isDraft ? 'draft-pull-requests' : 'pull-requests';
  }
  if (item.category === 'needs-review') return 'needs-review';
  if (item.category === 'waiting') return 'waiting';
  return 'approved';
}

export function itemRunning(item: SidebarItem): boolean {
  if (item.kind === 'session') return item.session.running;
  return item.running === true;
}

/** Display title for an item (branch for sessions, PR title otherwise). */
export function itemTitle(item: SidebarItem): string {
  if (item.kind === 'session') {
    return item.branch ?? item.session.name;
  }
  return item.pr.title;
}

/** The git branch an item corresponds to. */
export function itemBranch(item: SidebarItem): string {
  if (item.kind === 'session') return item.branch ?? item.session.name;
  return item.pr.sourceBranch;
}

/** PTY session name for an item when it has a local worktree. */
export function itemSessionName(item: SidebarItem): string | undefined {
  return item.kind === 'session' ? item.session.name : undefined;
}

export function itemHasWorktree(item: SidebarItem): boolean {
  return item.kind === 'session';
}

export interface SidebarSection {
  key: SectionKey;
  label: string;
  items: SidebarItem[];
}

/** Group the ordered flat list into its sections (TUI order preserved). */
export function groupSections(items: SidebarItem[]): SidebarSection[] {
  const map = new Map<SectionKey, SidebarItem[]>();
  for (const item of items) {
    const k = sectionKey(item);
    const arr = map.get(k);
    if (arr) arr.push(item);
    else map.set(k, [item]);
  }
  return SECTION_ORDER.filter((k) => map.has(k)).map((k) => ({
    key: k,
    label: SECTION_LABEL[k],
    items: map.get(k) ?? [],
  }));
}
