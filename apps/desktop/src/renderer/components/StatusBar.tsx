import {
  AlertCircleIcon,
  CloudOffIcon,
  GitBranchIcon,
  Loader2Icon,
  RefreshCwIcon,
  TerminalIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SidebarItem } from '../../host/contract.js';
import { useRepo } from '../lib/repo-context.js';
import { useRefreshRemote, useSyncState, useVersion } from '../lib/queries.js';
import { itemRunning } from '../lib/sidebar-model.js';
import { basename, cn, relativeTime } from '../lib/utils.js';
import { Tip } from './ui/tooltip.js';

/**
 * Bottom status strip: repo, provider sync state, running agent count,
 * build stamp. Every segment is a quiet button; clicking sync refreshes.
 */
export function StatusBar({
  items,
  onOpenSettings,
}: {
  items: SidebarItem[];
  onOpenSettings: () => void;
}) {
  const { repo } = useRepo();
  const sync = useSyncState(repo.cwd);
  const refresh = useRefreshRemote(repo.cwd);
  const version = useVersion();
  const running = items.filter(itemRunning).length;

  // Re-render every 15s so "synced Xm ago" stays honest.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const s = sync.data;
  const syncing = refresh.isPending || s?.remoteSyncing;

  return (
    <footer className="flex h-[22px] shrink-0 select-none items-center border-t border-border bg-statusbar px-2 text-xs text-statusbar-foreground">
      <Segment label={repo.cwd}>
        <GitBranchIcon className="size-3" />
        <span className="font-medium">{basename(repo.cwd)}</span>
      </Segment>

      {s && !s.providerId && (
        <Segment
          label="No VCS provider configured — open Settings"
          onClick={onOpenSettings}
        >
          <CloudOffIcon className="size-3" />
          No provider
        </Segment>
      )}
      {s && s.providerId && !s.providerConfigured && (
        <Segment
          label={`${providerName(
            s.providerId
          )} needs credentials — open Settings`}
          onClick={onOpenSettings}
          className="text-warning"
        >
          <AlertCircleIcon className="size-3" />
          {providerName(s.providerId)} not configured
        </Segment>
      )}
      {s && s.providerId && s.providerConfigured && (
        <Segment
          label={
            s.remoteError
              ? `Last sync failed: ${s.remoteError}`
              : `Refresh pull requests (auto every ${Math.round(
                  s.remoteIntervalMs / 1000
                )}s)`
          }
          onClick={() => refresh.mutate()}
          className={cn(s.remoteError && 'text-destructive')}
        >
          {syncing ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : s.remoteError ? (
            <AlertCircleIcon className="size-3" />
          ) : (
            <RefreshCwIcon className="size-3" />
          )}
          {providerName(s.providerId)}
          <span className="text-muted-foreground">
            {syncing
              ? 'syncing…'
              : s.lastRemoteSyncAt
              ? `synced ${relativeTime(s.lastRemoteSyncAt)}`
              : 'not synced'}
          </span>
        </Segment>
      )}

      <div className="flex-1" />

      {running > 0 && (
        <Segment label={`${running} agent${running === 1 ? '' : 's'} running`}>
          <TerminalIcon className="size-3 text-success" />
          {running} running
        </Segment>
      )}
      <Segment label="kirby-desktop build">
        <span className="text-muted-foreground">
          v{version.data?.app ?? '…'}
        </span>
      </Segment>
    </footer>
  );
}

function providerName(id: string): string {
  if (id === 'github') return 'GitHub';
  if (id === 'azure-devops') return 'Azure DevOps';
  return id;
}

function Segment({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const inner = (
    <span
      role={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex h-full items-center gap-1.5 px-1.5 transition-colors',
        onClick && 'cursor-pointer hover:bg-accent',
        className
      )}
    >
      {children}
    </span>
  );
  return <Tip label={label}>{inner}</Tip>;
}
