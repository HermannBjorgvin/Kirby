import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Branch picker mirroring the TUI: type to filter existing branches,
 * arrow keys to move, Enter to check out the highlighted branch — or,
 * when the query matches nothing, create a new branch by that name.
 * Both paths go through createWorktree host-side, which checks out an
 * existing branch or creates a new one as needed.
 */
export function BranchPicker({ onPick }: { onPick: (branch: string) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.kirby
      .listAllBranches()
      .then(setBranches)
      .catch(() => setBranches([]));
  }, []);

  // Close the dropdown on outside click.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? branches.filter((b) => b.toLowerCase().includes(q))
      : branches;
    return list.slice(0, 50);
  }, [branches, query]);

  const exact = matches.some((b) => b === query.trim());
  const canCreate = query.trim().length > 0 && !exact;

  const pick = (branch: string) => {
    onPick(branch);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = matches[highlight];
      if (
        chosen &&
        query.trim() &&
        chosen.toLowerCase().includes(query.trim().toLowerCase())
      ) {
        pick(chosen);
      } else if (canCreate) {
        pick(query.trim());
      } else if (chosen) {
        pick(chosen);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative border-b border-slate-800 px-3 py-2">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="check out or create branch…"
        spellCheck={false}
        className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-500"
      />

      {open && (matches.length > 0 || canCreate) && (
        <div className="absolute left-3 right-3 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-md border border-slate-700 bg-slate-900 shadow-xl">
          {canCreate && (
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                pick(query.trim());
              }}
              className="flex w-full items-center gap-2 border-b border-slate-800 px-3 py-1.5 text-left hover:bg-slate-800"
            >
              <span className="text-cyan-400">+</span>
              <span className="font-mono text-xs text-slate-200">
                Create <span className="text-cyan-300">{query.trim()}</span>
              </span>
            </button>
          )}
          {matches.map((b, i) => (
            <button
              key={b}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(b);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`block w-full truncate px-3 py-1.5 text-left font-mono text-xs ${
                i === highlight
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-300 hover:bg-slate-800/60'
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
