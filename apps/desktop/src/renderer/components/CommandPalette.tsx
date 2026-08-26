import {
  FolderOpenIcon,
  GitBranchIcon,
  GitBranchPlusIcon,
  GitPullRequestIcon,
  MoonIcon,
  PanelLeftIcon,
  RefreshCwIcon,
  SettingsIcon,
  SunIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { SidebarItem } from '../../host/contract.js';
import {
  useAllBranches,
  useCreateWorktree,
  useRefreshRemote,
} from '../lib/queries.js';
import { useRepo } from '../lib/repo-context.js';
import { itemBranch, itemKey, itemTitle } from '../lib/sidebar-model.js';
import { useTabs } from '../lib/tabs.js';
import { useTheme } from '../lib/theme.js';
import { errorMessage, MOD } from '../lib/utils.js';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './ui/command.js';

/**
 * ⌘K palette. Three jobs in one box, mirroring the TUI branch picker:
 *   • jump to an open worktree / PR
 *   • check out any branch as a new worktree (or create a branch)
 *   • run app commands (settings, refresh, theme, sidebar)
 */
export function CommandPalette({
  open,
  onOpenChange,
  items,
  onToggleSidebar,
  onSwitchRepo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: SidebarItem[];
  onToggleSidebar: () => void;
  onSwitchRepo: () => void;
}) {
  const { repo } = useRepo();
  const tabs = useTabs();
  const { resolved, setPreference } = useTheme();
  const branches = useAllBranches(repo.cwd, open);
  const create = useCreateWorktree(repo.cwd);
  const refresh = useRefreshRemote(repo.cwd);
  const [query, setQuery] = useState('');

  const worktreeBranches = useMemo(
    () =>
      new Set(
        items.filter((i) => i.kind === 'session').map((i) => itemBranch(i))
      ),
    [items]
  );
  const plainWorktrees = useMemo(() => items.filter((i) => !i.pr), [items]);
  const prItems = useMemo(() => items.filter((i) => Boolean(i.pr)), [items]);

  const openItem = (item: SidebarItem) => {
    close();
    tabs.openItem(itemKey(item));
  };

  const q = query.trim();
  const exact = (branches.data ?? []).some((b) => b === q);
  const canCreate = q.length > 0 && !exact && !/\s/.test(q);

  const close = () => {
    onOpenChange(false);
    setQuery('');
  };

  const checkout = (branch: string) => {
    close();
    const id = toast.loading(`Checking out ${branch}…`);
    // Open the tab optimistically: worktree tabs are keyed by branch
    // (PR-backed ones by PR id — those already exist as sidebar items
    // and go through tabs.openItem above). The pane shows its loading
    // state until the sidebar model catches up.
    const existing = items.find((i) => itemBranch(i) === branch);
    tabs.openItem(existing ? itemKey(existing) : `branch:${branch}`);
    create.mutate(branch, {
      onSuccess: () => toast.success(`Worktree ready: ${branch}`, { id }),
      onError: (err) => toast.error(errorMessage(err), { id }),
    });
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title="Command palette"
      description="Jump to a worktree or pull request, check out a branch, or run a command"
    >
      <CommandInput
        placeholder="Branch name, pull request, or command…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        {canCreate && (
          <CommandGroup heading="Create">
            <CommandItem value={`create ${q}`} onSelect={() => checkout(q)}>
              <GitBranchPlusIcon />
              Create branch <span className="font-mono">{q}</span> and open a
              worktree
            </CommandItem>
          </CommandGroup>
        )}

        <CommandGroup heading="Commands">
          <CommandItem
            value="command settings preferences"
            onSelect={() => {
              close();
              tabs.openSettings();
            }}
          >
            <SettingsIcon />
            Open settings
            <CommandShortcut>{MOD} ,</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="command refresh pull requests sync"
            onSelect={() => {
              close();
              refresh.mutate(undefined, {
                onError: (err) => toast.error(errorMessage(err)),
              });
            }}
          >
            <RefreshCwIcon />
            Refresh pull requests
          </CommandItem>
          <CommandItem
            value="command toggle sidebar"
            onSelect={() => {
              close();
              onToggleSidebar();
            }}
          >
            <PanelLeftIcon />
            Toggle sidebar
            <CommandShortcut>{MOD} B</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="command toggle theme dark light"
            onSelect={() => {
              close();
              setPreference(resolved === 'dark' ? 'light' : 'dark');
            }}
          >
            {resolved === 'dark' ? <SunIcon /> : <MoonIcon />}
            Switch to {resolved === 'dark' ? 'light' : 'dark'} theme
          </CommandItem>
          <CommandItem
            value="command switch open repository"
            onSelect={() => {
              close();
              onSwitchRepo();
            }}
          >
            <FolderOpenIcon />
            Open another repository…
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />
        {plainWorktrees.length > 0 && (
          <CommandGroup heading="Worktrees">
            {plainWorktrees.map((item) => (
              <OpenItem key={itemKey(item)} item={item} onOpen={openItem} />
            ))}
          </CommandGroup>
        )}
        {prItems.length > 0 && (
          <CommandGroup heading="Worktrees w/ pull request">
            {prItems.map((item) => (
              <OpenItem key={itemKey(item)} item={item} onOpen={openItem} />
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Check out branch">
          {branches.isLoading && (
            <CommandItem disabled value="__loading">
              Loading branches…
            </CommandItem>
          )}
          {(branches.data ?? [])
            .filter((b) => !worktreeBranches.has(b))
            .slice(0, 200)
            .map((b) => (
              <CommandItem
                key={b}
                value={`branch ${b}`}
                onSelect={() => checkout(b)}
              >
                <GitBranchIcon />
                <span className="truncate font-mono">{b}</span>
              </CommandItem>
            ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

function OpenItem({
  item,
  onOpen,
}: {
  item: SidebarItem;
  onOpen: (item: SidebarItem) => void;
}) {
  return (
    <CommandItem
      value={`open ${itemTitle(item)} ${itemBranch(item)} ${
        item.pr ? `#${item.pr.id}` : ''
      }`}
      onSelect={() => onOpen(item)}
    >
      {item.pr ? <GitPullRequestIcon /> : <GitBranchIcon />}
      <span className="truncate">{itemTitle(item)}</span>
      {item.pr && <span className="text-muted-foreground">#{item.pr.id}</span>}
    </CommandItem>
  );
}
