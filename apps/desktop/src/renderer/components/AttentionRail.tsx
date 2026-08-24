import {
  EyeIcon,
  MessageSquareIcon,
  MessageSquareWarningIcon,
  PanelLeftOpenIcon,
  XCircleIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import type { SidebarItem } from '../../host/contract.js';
import {
  buildAttentionModel,
  type AttentionCategory,
} from '../lib/attention.js';
import { useTabs } from '../lib/tabs.js';
import { cn } from '../lib/utils.js';
import { Button } from './ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.js';
import { Tip } from './ui/tooltip.js';

/**
 * The collapsed-sidebar strip: reveal button on top, then compact
 * attention chips — things that need the developer and are NOT already
 * open as a tab (open tabs carry their own state). Chips with a count
 * of zero are hidden; clicking a chip pops a list of the matching PRs
 * and clicking one opens its tab.
 */
export function AttentionRail({
  items,
  onReveal,
}: {
  items: SidebarItem[];
  onReveal: () => void;
}) {
  const tabs = useTabs();
  const openKeys = useMemo(
    () =>
      new Set(tabs.tabs.flatMap((t) => (t.kind === 'item' ? [t.itemKey] : []))),
    [tabs.tabs]
  );
  const model = useMemo(
    () => buildAttentionModel(items, openKeys),
    [items, openKeys]
  );

  return (
    <div className="flex w-9 shrink-0 flex-col items-center gap-1 border-r border-border bg-sidebar pt-1">
      <Tip label="Show sidebar (Ctrl B)" side="right">
        <Button
          variant="ghost"
          size="icon"
          onClick={onReveal}
          aria-label="Show sidebar"
        >
          <PanelLeftOpenIcon />
        </Button>
      </Tip>
      <div className="my-1 h-px w-5 shrink-0 bg-border" />
      <AttentionChip
        category={model.needsReview}
        icon={<EyeIcon className="size-4" />}
        tone="text-warning"
        label="Needs your review"
        reason="waiting for your review"
        onOpen={(key) => tabs.openItem(key)}
      />
      <AttentionChip
        category={model.ciFailing}
        icon={<XCircleIcon className="size-4" />}
        tone="text-destructive"
        label="CI failing on your PRs"
        reason="CI failed"
        onOpen={(key) => tabs.openItem(key)}
      />
      <AttentionChip
        category={model.changesRequested}
        icon={<MessageSquareWarningIcon className="size-4" />}
        tone="text-warning"
        label="Changes requested on your PRs"
        reason="changes requested"
        onOpen={(key) => tabs.openItem(key)}
      />
      <AttentionChip
        category={model.unresolvedComments}
        icon={<MessageSquareIcon className="size-4" />}
        tone="text-info"
        label="Unresolved comments on your PRs"
        reason="unresolved comments"
        count={model.unresolvedCommentTotal}
        onOpen={(key) => tabs.openItem(key)}
      />
    </div>
  );
}

function AttentionChip({
  category,
  icon,
  tone,
  label,
  reason,
  count,
  onOpen,
}: {
  category: AttentionCategory;
  icon: React.ReactNode;
  tone: string;
  label: string;
  reason: string;
  /** Override the badge number (defaults to the entry count). */
  count?: number;
  onOpen: (key: string) => void;
}) {
  const n = count ?? category.entries.length;
  if (category.entries.length === 0) return null;
  const tipExtra =
    category.openInTabs > 0 ? ` (+${category.openInTabs} already open)` : '';

  return (
    <DropdownMenu>
      <Tip label={`${label}${tipExtra}`} side="right">
        <DropdownMenuTrigger asChild>
          <button
            aria-label={label}
            className={cn(
              'relative flex size-7 items-center justify-center rounded-md transition-colors hover:bg-sidebar-accent',
              tone
            )}
          >
            {icon}
            <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-semibold leading-none text-primary-foreground tabular-nums">
              {n > 99 ? '99+' : n}
            </span>
          </button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent side="right" align="start" className="max-w-96">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {category.entries.map(({ pr, key }) => (
          <DropdownMenuItem key={key} onSelect={() => onOpen(key)}>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-medium">{pr.title}</span>
                <span className="shrink-0 text-muted-foreground">#{pr.id}</span>
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {reason}
                {pr.activeCommentCount && reason === 'unresolved comments'
                  ? ` (${pr.activeCommentCount})`
                  : ''}{' '}
                · {pr.sourceBranch}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
