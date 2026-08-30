import { MOD } from '../lib/utils.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';
import { Kbd } from './ui/kbd.js';

const ROWS: [string, string[]][] = [
  ['Search & commands', [MOD, 'K']],
  ['Command palette', [MOD, '⇧', 'P']],
  ['Toggle sidebar', [MOD, 'B']],
  ['New worktree', [MOD, 'N']],
  ['Open repository', [MOD, 'O']],
  ['Settings', [MOD, ',']],
  ['Close tab', [MOD, 'W']],
  ['Refresh pull requests', [MOD, 'R']],
  ['Send reply (in a comment box)', [MOD, '↵']],
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            The same shortcuts are available from the application menu.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 text-base">
          {ROWS.map(([label, keys]) => (
            <div key={label} className="contents">
              <span className="text-muted-foreground">{label}</span>
              <span className="flex items-center gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
