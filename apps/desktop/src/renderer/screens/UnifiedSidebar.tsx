import { BranchPicker } from './BranchPicker.js';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { SidebarItem } from '../../host/contract.js';
import {
  SECTION_LABEL,
  itemKey,
  itemPrId,
  itemRunning,
  itemTitle,
  sectionKey,
  type SectionKey,
} from '../lib/sidebar-model.js';

/**
 * The unified, sectioned sidebar — the same information architecture
 * as the TUI: Worktrees, Draft Pull Requests, Pull Requests, then the
 * three review buckets, all in one scrolling list. Selecting a row
 * drives the content pane.
 */
export function UnifiedSidebar({
  items,
  loading,
  selectedKey,
  onSelect,
  onCreateWorktree,
  onOpenSettings,
  onSwitchRepo,
  onToggleHide,
  width,
  repoCwd,
  actionError,
}: {
  items: SidebarItem[];
  loading: boolean;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onCreateWorktree: (branch: string) => void;
  onOpenSettings: () => void;
  onSwitchRepo: () => void;
  onToggleHide: () => void;
  width: number;
  repoCwd: string;
  actionError: string | null;
}) {
  // Group into rows with section headers at each transition.
  const rows: (
    | { type: 'header'; section: SectionKey; count: number }
    | { type: 'item'; item: SidebarItem }
  )[] = [];
  let current: SectionKey | null = null;
  const counts = new Map<SectionKey, number>();
  for (const item of items)
    counts.set(sectionKey(item), (counts.get(sectionKey(item)) ?? 0) + 1);
  for (const item of items) {
    const sk = sectionKey(item);
    if (sk !== current) {
      rows.push({ type: 'header', section: sk, count: counts.get(sk) ?? 0 });
      current = sk;
    }
    rows.push({ type: 'item', item });
  }

  return (
    <aside
      style={{ width }}
      className="flex h-full shrink-0 flex-col border-r border-slate-800 bg-slate-950/60"
    >
      {/* Repo header */}
      <div className="border-b border-slate-800 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate font-mono text-[11px] text-slate-400">
            {repoCwd.split('/').filter(Boolean).pop()}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={onSwitchRepo}
              title="Switch repository"
              className="rounded px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-800 hover:text-slate-200"
            >
              switch
            </button>
            <button
              onClick={onToggleHide}
              title="Hide sidebar"
              className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
            >
              «
            </button>
          </div>
        </div>
      </div>

      {/* Branch picker: check out existing or create new */}
      <BranchPicker onPick={onCreateWorktree} />

      {/* Item list */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {loading && items.length === 0 && (
          <p className="px-3 py-2 text-sm text-slate-500">Loading…</p>
        )}
        {!loading && items.length === 0 && (
          <p className="px-3 py-2 text-sm text-slate-500">
            No worktrees or pull requests.
          </p>
        )}
        {rows.map((row, i) =>
          row.type === 'header' ? (
            <div
              key={`h-${row.section}-${i}`}
              className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600"
            >
              {SECTION_LABEL[row.section]}{' '}
              <span className="text-slate-700">({row.count})</span>
            </div>
          ) : (
            <SidebarRow
              key={itemKey(row.item)}
              item={row.item}
              selected={itemKey(row.item) === selectedKey}
              onSelect={() => onSelect(itemKey(row.item))}
            />
          )
        )}
      </div>

      {actionError && (
        <p className="border-t border-red-900/60 px-3 py-2 font-mono text-[10px] text-red-400">
          {actionError}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-slate-800 px-3 py-2">
        <button
          onClick={onOpenSettings}
          className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          ⚙ Settings
        </button>
      </div>
    </aside>
  );
}

function SidebarRow({
  item,
  selected,
  onSelect,
}: {
  item: SidebarItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const prId = itemPrId(item);
  const running = itemRunning(item);
  const pr = item.pr;
  return (
    <button
      onClick={onSelect}
      className={`block w-full px-3 py-1.5 text-left ${
        selected ? 'bg-slate-800' : 'hover:bg-slate-800/60'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            running ? 'bg-emerald-500' : 'border border-slate-600'
          }`}
        />
        <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
          {itemTitle(item)}
        </span>
        {prId != null && (
          <span className="shrink-0 font-mono text-[10px] text-cyan-400">
            #{prId}
          </span>
        )}
      </div>
      {pr && <PrBadge pr={pr} />}
    </button>
  );
}

function PrBadge({ pr }: { pr: PullRequestInfo }) {
  const reviewers = pr.reviewers ?? [];
  const approved = reviewers.filter((r) => r.decision === 'approved').length;
  const rejected = reviewers.some((r) => r.decision === 'changes-requested');
  const total = reviewers.length;
  const comments = pr.activeCommentCount ?? 0;

  const ci = pr.buildStatus;
  const ciMeta =
    ci === 'succeeded'
      ? { dot: 'bg-emerald-500', label: 'CI' }
      : ci === 'failed'
      ? { dot: 'bg-red-500', label: 'CI' }
      : ci === 'pending'
      ? { dot: 'bg-amber-400', label: 'CI' }
      : null;

  const reviewColor = rejected
    ? 'text-red-400'
    : total > 0 && approved === total
    ? 'text-emerald-400'
    : 'text-slate-500';

  return (
    <div className="ml-4 mt-0.5 flex items-center gap-2 text-[10px] text-slate-500">
      {total > 0 && (
        <span className={reviewColor}>
          {approved}/{total} ✓
        </span>
      )}
      {comments > 0 && <span className="text-amber-400/80">{comments} 💬</span>}
      {ciMeta && (
        <span className="flex items-center gap-1">
          <span className={`h-1.5 w-1.5 rounded-full ${ciMeta.dot}`} />
          {ciMeta.label}
        </span>
      )}
      <span className="ml-auto truncate text-slate-600">
        {pr.createdByDisplayName}
      </span>
    </div>
  );
}
