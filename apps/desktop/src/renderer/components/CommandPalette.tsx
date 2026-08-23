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
    create.mutate(branch, {
      onSuccess: () => {
        toast.success(`Worktree ready: ${branch}`, { id });
        // The sidebar model refetches; open the tab optimistically by
        // its future key (session name is derived from the branch on
        // the host, so we wait for the item to show up instead).
      },
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

        {items.length > 0 && (
          <CommandGroup heading="Open">
            {items.map((item) => (
              <CommandItem
                key={itemKey(item)}
                value={`open ${itemTitle(item)} ${itemBranch(item)} ${
                  item.pr ? `#${item.pr.id}` : ''
                }`}
                onSelect={() => {
                  close();
                  tabs.openItem(itemKey(item));
                }}
              >
                {item.pr ? <GitPullRequestIcon /> : <GitBranchIcon />}
                <span className="truncate">{itemTitle(item)}</span>
                {item.pr && (
                  <span className="text-muted-foreground">#{item.pr.id}</span>
                )}
              </CommandItem>
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

        <CommandSeparator />
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
      </CommandList>
    </CommandDialog>
  );
}
