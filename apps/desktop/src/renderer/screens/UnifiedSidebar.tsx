import { useState } from 'react';
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
  repoCwd: string;
  actionError: string | null;
}) {
  const [newBranch, setNewBranch] = useState('');

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
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-950/60">
      {/* Repo header */}
      <div className="border-b border-slate-800 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate font-mono text-[11px] text-slate-400">
            {repoCwd.split('/').filter(Boolean).pop()}
          </p>
          <button
            onClick={onSwitchRepo}
            title="Switch repository"
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-800 hover:text-slate-200"
          >
            switch
          </button>
        </div>
      </div>

      {/* New worktree */}
      <form
        className="flex items-center gap-1.5 border-b border-slate-800 px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newBranch.trim()) return;
          onCreateWorktree(newBranch.trim());
          setNewBranch('');
        }}
      >
        <input
          type="text"
          value={newBranch}
          onChange={(e) => setNewBranch(e.target.value)}
          placeholder="new branch…"
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-500"
        />
        <button
          type="submit"
          disabled={!newBranch.trim()}
          title="Create worktree"
          className="rounded bg-cyan-600 px-2 py-1 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-40"
        >
          +
        </button>
      </form>

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
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${
        selected ? 'bg-slate-800' : 'hover:bg-slate-800/60'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          running ? 'bg-emerald-500' : 'bg-transparent'
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
    </button>
  );
}
