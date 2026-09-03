import {
  BotIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
  SquareTerminalIcon,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { TerminalKind } from '../../../host/contract.js';
import { useRecentRepos } from '../../lib/data/queries.js';
import { useRepo } from '../../lib/repo-context.js';
import { basename, cn, errorMessage } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.js';

/** Where the terminal opens, once the user has said. */
type Where =
  | { kind: 'current'; cwd: string }
  | { kind: 'repo'; cwd: string }
  | { kind: 'folder'; cwd: string };

/**
 * "New terminal": where, then what.
 *
 * Where is one of the open repository's root, another repository from
 * the recents list, or any folder through the OS picker. What is a
 * plain shell or the configured agent. The host decides which group
 * the resulting tab belongs to from the directory itself.
 */
export function NewTerminalDialog({
  onLaunch,
  onClose,
  busy,
}: {
  onLaunch: (kind: TerminalKind, cwd: string) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const { repo } = useRepo();
  const [where, setWhere] = useState<Where | null>({
    kind: 'current',
    cwd: repo.cwd,
  });
  const [what, setWhat] = useState<TerminalKind>('shell');
  const [pickingRepo, setPickingRepo] = useState(false);

  const pickFolder = async () => {
    try {
      const dir = await window.kirby.selectFolder();
      if (dir) {
        setPickingRepo(false);
        setWhere({ kind: 'folder', cwd: dir });
      }
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    }
  };

  const go = () => {
    if (where) onLaunch(what, where.cwd);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-lg"
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !where) return;
          e.preventDefault();
          go();
        }}
      >
        <DialogHeader>
          <DialogTitle>New terminal</DialogTitle>
          <DialogDescription>
            A shell or an agent, in any directory — without leaving Kirby.
          </DialogDescription>
        </DialogHeader>

        <p className="text-base">Where?</p>
        <div className="space-y-2">
          <Choice
            selected={where?.kind === 'current'}
            onSelect={() => {
              setPickingRepo(false);
              setWhere({ kind: 'current', cwd: repo.cwd });
            }}
            icon={GitBranchIcon}
            title="Current repository"
            description={repo.cwd}
          />
          <Choice
            selected={where?.kind === 'repo'}
            onSelect={() => setPickingRepo(true)}
            icon={FolderIcon}
            title="Other repository"
            description={
              where?.kind === 'repo' ? where.cwd : 'One you have opened before'
            }
          />
          {pickingRepo && (
            <RepoList
              exclude={repo.cwd}
              onPick={(cwd) => {
                setPickingRepo(false);
                setWhere({ kind: 'repo', cwd });
              }}
            />
          )}
          <Choice
            selected={where?.kind === 'folder'}
            onSelect={() => void pickFolder()}
            icon={FolderOpenIcon}
            title="Other folder…"
            description={
              where?.kind === 'folder'
                ? where.cwd
                : 'Any directory, repository or not'
            }
          />
        </div>

        <p className="text-base">What?</p>
        <div className="grid grid-cols-2 gap-2">
          <Choice
            selected={what === 'shell'}
            onSelect={() => setWhat('shell')}
            icon={SquareTerminalIcon}
            title="Shell"
            description="Your login shell"
          />
          <Choice
            selected={what === 'agent'}
            onSelect={() => setWhat('agent')}
            icon={BotIcon}
            title="Agent"
            description="The configured agent, no task"
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={go} disabled={!where || busy}>
            Open terminal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The recents list, minus the repository already on offer. */
function RepoList({
  exclude,
  onPick,
}: {
  exclude: string;
  onPick: (cwd: string) => void;
}) {
  const recents = useRecentRepos();
  const list = (recents.data ?? []).filter((r) => r.valid && r.cwd !== exclude);
  if (list.length === 0) {
    return (
      <p className="px-3 py-1 text-sm text-muted-foreground">
        No other repositories opened yet.
      </p>
    );
  }
  return (
    <div
      role="listbox"
      aria-label="Repositories"
      className="max-h-40 overflow-y-auto rounded-md border border-border"
    >
      {list.map((r) => (
        <button
          key={r.cwd}
          type="button"
          role="option"
          aria-selected={false}
          onClick={() => onPick(r.cwd)}
          className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-accent"
        >
          <span className="font-medium">{basename(r.cwd)}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {r.cwd}
          </span>
        </button>
      ))}
    </div>
  );
}

function Choice({
  selected,
  onSelect,
  icon: Icon,
  title,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: typeof FolderIcon;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/10'
          : 'border-border hover:bg-accent'
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          selected ? 'text-primary' : 'text-muted-foreground'
        )}
      />
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="block truncate text-sm text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}
