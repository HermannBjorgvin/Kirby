import {
  ChevronDownIcon,
  FolderOpenIcon,
  MonitorIcon,
  MoonIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
} from 'lucide-react';
import type { RepoInfo } from '../../host/contract.js';
import { useRecentRepos } from '../lib/queries.js';
import { useTheme, type ThemePreference } from '../lib/theme.js';
import { basename, MOD } from '../lib/utils.js';
import { Button } from './ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from './ui/dropdown-menu.js';
import { Kbd } from './ui/kbd.js';
import { Tip } from './ui/tooltip.js';
import { KirbyMark } from './KirbyMark.js';

/**
 * Custom title bar (Electron `titleBarStyle: 'hidden'`). Sized and
 * positioned with the Window Controls Overlay env() values so the
 * native minimise/maximise/close buttons never overlap our controls.
 */
export function TitleBar({
  repo,
  onSwitchRepo,
  onOpenRepo,
  onOpenPalette,
  onOpenSettings,
}: {
  repo: RepoInfo | null;
  onSwitchRepo: () => void;
  onOpenRepo?: (cwd: string) => void;
  onOpenPalette?: () => void;
  onOpenSettings?: () => void;
}) {
  return (
    <header
      className="app-drag relative z-20 flex h-9 shrink-0 select-none items-center border-b border-border bg-titlebar text-sidebar-foreground"
      style={{
        paddingLeft: 'env(titlebar-area-x, 0px)',
        width: 'env(titlebar-area-width, 100%)',
      }}
    >
      <div className="flex h-full min-w-0 flex-1 items-center gap-1 pl-2">
        <div className="app-no-drag flex items-center">
          <KirbyMark className="size-5" />
        </div>
        {repo ? (
          <RepoMenu
            repo={repo}
            onSwitchRepo={onSwitchRepo}
            onOpenRepo={onOpenRepo}
          />
        ) : (
          <span className="px-2 text-base font-medium">Kirby</span>
        )}
      </div>

      {repo && onOpenPalette && (
        <div className="app-no-drag flex shrink-0 justify-center">
          <button
            onClick={onOpenPalette}
            className="flex h-6 w-[min(34rem,40vw)] items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          >
            <SearchIcon className="size-3.5" />
            <span className="flex-1 truncate text-left">
              Search branches, pull requests, commands…
            </span>
            <Kbd>{MOD} K</Kbd>
          </button>
        </div>
      )}

      <div className="app-no-drag flex h-full flex-1 items-center justify-end gap-0.5 pr-2">
        <ThemeMenu />
        {repo && onOpenSettings && (
          <Tip label={`Settings (${MOD} ,)`}>
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenSettings}
              aria-label="Settings"
            >
              <SettingsIcon />
            </Button>
          </Tip>
        )}
      </div>
    </header>
  );
}

function RepoMenu({
  repo,
  onSwitchRepo,
  onOpenRepo,
}: {
  repo: RepoInfo;
  onSwitchRepo: () => void;
  onOpenRepo?: (cwd: string) => void;
}) {
  const recents = useRecentRepos();
  const others = (recents.data ?? []).filter(
    (r) => r.cwd !== repo.cwd && r.valid
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="app-no-drag flex h-6 max-w-72 items-center gap-1 rounded-md px-2 text-base font-medium transition-colors hover:bg-accent">
          <span className="truncate">{basename(repo.cwd)}</span>
          <ChevronDownIcon className="size-3.5 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-64">
        <DropdownMenuLabel>Repository</DropdownMenuLabel>
        <div className="truncate px-2 pb-1.5 font-mono text-xs text-muted-foreground">
          {repo.cwd}
        </div>
        <DropdownMenuSeparator />
        {others.length > 0 && (
          <>
            <DropdownMenuLabel>Recent</DropdownMenuLabel>
            {others.slice(0, 6).map((r) => (
              <DropdownMenuItem
                key={r.cwd}
                onSelect={() => onOpenRepo?.(r.cwd)}
                className="flex-col items-start gap-0"
              >
                <span>{basename(r.cwd)}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {r.cwd}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={onSwitchRepo}>
          <FolderOpenIcon />
          Open another repository…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeMenu() {
  const { preference, resolved, setPreference } = useTheme();
  const Icon = resolved === 'dark' ? MoonIcon : SunIcon;
  const options: {
    value: ThemePreference;
    label: string;
    icon: typeof SunIcon;
  }[] = [
    { value: 'system', label: 'System', icon: MonitorIcon },
    { value: 'light', label: 'Light', icon: SunIcon },
    { value: 'dark', label: 'Dark', icon: MoonIcon },
  ];
  return (
    <DropdownMenu>
      <Tip label="Theme">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Theme">
            <Icon />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={preference === o.value}
            onCheckedChange={() => setPreference(o.value)}
          >
            <o.icon className="mr-1 size-3.5 text-muted-foreground" />
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
