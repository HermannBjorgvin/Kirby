import { MessageSquareTextIcon, PlayIcon, SearchCodeIcon } from 'lucide-react';
import { useState } from 'react';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { AgentId, AgentOptionView } from '../../../host/contract.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';
import { Textarea } from '../ui/textarea.js';

export type LaunchChoice =
  | { kind: 'session'; agentId?: AgentId }
  | { kind: 'review'; instruction?: string };

type Mode = 'session' | 'review' | 'instruct';

/** Enter inside the agent picker opens or picks — never submits the dialog. */
function insidePicker(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[role="combobox"], [role="listbox"]') !== null
  );
}

/**
 * The TUI's "What would you like to do?" session menu: start or
 * continue a session with an agent chosen for this launch, and — for
 * a row backed by a pull request — review, or review with
 * instructions.
 */
export function LaunchDialog({
  pr,
  branch,
  hasWorktree,
  agents,
  onChoose,
  onClose,
}: {
  pr?: PullRequestInfo;
  branch: string;
  hasWorktree: boolean;
  /** Picker rows, configured default first (`useAgentOptions`). */
  agents: AgentOptionView[];
  onChoose: (choice: LaunchChoice) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>('session');
  const [instruction, setInstruction] = useState('');
  // The first row is the configured default: launching without
  // touching the picker reproduces the configured behaviour, custom
  // `aiCommand` included, so only a non-default pick carries an id.
  const [agentIdx, setAgentIdx] = useState(0);

  const go = () => {
    if (mode === 'session') {
      const picked = agents[agentIdx];
      const agentId =
        agentIdx > 0 && picked && picked.id !== 'test' ? picked.id : undefined;
      onChoose({ kind: 'session', agentId });
    } else if (mode === 'review') onChoose({ kind: 'review' });
    else
      onChoose({
        kind: 'review',
        instruction: instruction.trim() || undefined,
      });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-lg"
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || insidePicker(e.target)) return;
          if (mode === 'instruct' && !(e.metaKey || e.ctrlKey)) return;
          e.preventDefault();
          go();
        }}
      >
        <DialogHeader>
          {pr ? <PrTitle pr={pr} /> : <DialogTitle>{branch}</DialogTitle>}
          <DialogDescription>
            {pr ? (
              <>
                <span className="font-mono">{pr.sourceBranch}</span> →{' '}
                <span className="font-mono">{pr.targetBranch}</span> by{' '}
                {pr.createdByDisplayName}
              </>
            ) : (
              'Worktree'
            )}
            {!hasWorktree && ' · a worktree will be created first'}
          </DialogDescription>
        </DialogHeader>

        <p className="text-base">What would you like to do?</p>
        <div className="space-y-2">
          <LaunchOption
            mode={mode}
            setMode={setMode}
            go={go}
            value="session"
            icon={PlayIcon}
            title="Start / continue session"
            description="Open the agent in this worktree with no task. Resumes a prior conversation when the agent supports it."
          />
          {mode === 'session' && (
            <AgentPicker
              agents={agents}
              index={agentIdx}
              onChange={setAgentIdx}
            />
          )}
          {pr && (
            <>
              <LaunchOption
                mode={mode}
                setMode={setMode}
                go={go}
                value="review"
                icon={SearchCodeIcon}
                title="Start / continue review"
                description="Ask the agent to review the pull request. Its comments appear as drafts in the diff for you to edit and post."
              />
              <LaunchOption
                mode={mode}
                setMode={setMode}
                go={go}
                value="instruct"
                icon={MessageSquareTextIcon}
                title="Review with instructions…"
                description="Same as a review, with extra guidance for the agent."
              />
            </>
          )}
          {mode === 'instruct' && (
            <Textarea
              autoFocus
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. Focus on error handling and the public API surface. ⌘/Ctrl+Enter to start."
              className="min-h-20"
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={go}
            disabled={mode === 'instruct' && !instruction.trim()}
          >
            <PlayIcon />
            {mode === 'session' ? 'Start session' : 'Start review'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PrTitle({ pr }: { pr: PullRequestInfo }) {
  return (
    <DialogTitle className="flex items-center gap-2">
      <span className="text-muted-foreground">#{pr.id}</span>
      <span className="truncate">{pr.title || pr.sourceBranch}</span>
    </DialogTitle>
  );
}

/**
 * Which agent this launch uses. Indexed rather than by id because the
 * default row and a registry row can share an id (Claude configured →
 * "Claude (default)" is row 0 and there is no second Claude row, but a
 * custom command shows as "Custom (default)" with id `test`).
 */
function AgentPicker({
  agents,
  index,
  onChange,
}: {
  agents: AgentOptionView[];
  index: number;
  onChange: (index: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 pl-10">
      <span className="text-sm text-muted-foreground">Agent</span>
      <Select
        value={agents.length > 0 ? String(index) : ''}
        onValueChange={(v) => onChange(Number(v))}
        disabled={agents.length === 0}
      >
        <SelectTrigger className="w-48" aria-label="Agent">
          <SelectValue placeholder="Loading…" />
        </SelectTrigger>
        <SelectContent>
          {agents.map((a, i) => (
            <SelectItem key={a.id} value={String(i)}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function LaunchOption({
  mode,
  setMode,
  go,
  value,
  icon: Icon,
  title,
  description,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  go: () => void;
  value: Mode;
  icon: typeof PlayIcon;
  title: string;
  description: string;
}) {
  const selected = mode === value;
  return (
    <button
      type="button"
      onClick={() => setMode(value)}
      onDoubleClick={() => {
        setMode(value);
        if (value !== 'instruct') go();
      }}
      className={cn(
        'flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/10'
          : 'border-border hover:bg-accent'
      )}
      aria-pressed={selected}
    >
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          selected ? 'text-primary' : 'text-muted-foreground'
        )}
      />
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}
