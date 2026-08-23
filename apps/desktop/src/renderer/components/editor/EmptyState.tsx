import { KirbyMark } from '../KirbyMark.js';
import { Kbd } from '../ui/kbd.js';
import { MOD } from '../../lib/utils.js';

export function EmptyState({
  onOpenPalette,
  hasItems,
}: {
  onOpenPalette: () => void;
  hasItems: boolean;
}) {
  return (
    <div className="flex h-full select-none flex-col items-center justify-center bg-background text-muted-foreground">
      <KirbyMark className="size-14 opacity-20 grayscale" />
      <p className="mt-4 text-base">
        {hasItems
          ? 'Pick a worktree or pull request from the sidebar.'
          : 'Check out a branch to create your first worktree.'}
      </p>
      <div className="mt-6 grid grid-cols-[auto_auto] items-center gap-x-4 gap-y-2 text-sm">
        <span className="text-right">Search &amp; commands</span>
        <button
          onClick={onOpenPalette}
          className="flex items-center gap-1 hover:text-foreground"
        >
          <Kbd>{MOD}</Kbd>
          <Kbd>K</Kbd>
        </button>
        <span className="text-right">Toggle sidebar</span>
        <span className="flex items-center gap-1">
          <Kbd>{MOD}</Kbd>
          <Kbd>B</Kbd>
        </span>
        <span className="text-right">Settings</span>
        <span className="flex items-center gap-1">
          <Kbd>{MOD}</Kbd>
          <Kbd>,</Kbd>
        </span>
      </div>
    </div>
  );
}
