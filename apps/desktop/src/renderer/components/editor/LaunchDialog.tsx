import { MessageSquareTextIcon, PlayIcon, SearchCodeIcon } from 'lucide-react';
import { useState } from 'react';
import type { PullRequestInfo } from '@kirby/vcs-core';
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
import { Textarea } from '../ui/textarea.js';

export type LaunchChoice =
  | { kind: 'session' }
  | { kind: 'review'; instruction?: string };

/**
 * The TUI's "What would you like to do?" menu for starting an agent on
 * a pull request: plain session, review, review with instructions.
 */
export function LaunchDialog({
  pr,
  hasWorktree,
  onChoose,
  onClose,
}: {
  pr: PullRequestInfo;
  hasWorktree: boolean;
  onChoose: (choice: LaunchChoice) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>('session');
  const [instruction, setInstruction] = useState('');

  const go = () => {
    if (mode === 'session') onChoose({ kind: 'session' });
    else if (mode === 'review') onChoose({ kind: 'review' });
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
          if (
            e.key === 'Enter' &&
            !(mode === 'instruct' && !(e.metaKey || e.ctrlKey))
          ) {
            e.preventDefault();
            go();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-muted-foreground">#{pr.id}</span>
            <span className="truncate">{pr.title || pr.sourceBranch}</span>
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono">{pr.sourceBranch}</span> →{' '}
            <span className="font-mono">{pr.targetBranch}</span> by{' '}
            {pr.createdByDisplayName}
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

type Mode = 'session' | 'review' | 'instruct';

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
