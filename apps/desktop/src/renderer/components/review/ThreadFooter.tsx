import { CheckIcon, CornerDownRightIcon, RotateCcwIcon } from 'lucide-react';
import { Button } from '../ui/button.js';
import { Textarea } from '../ui/textarea.js';

/** The card's reply box and resolve button. */
export function ThreadFooter({
  canResolve,
  isResolved,
  composing,
  setComposing,
  draft,
  setDraft,
  sending,
  resolving,
  onSend,
  onToggleResolved,
}: {
  canResolve: boolean;
  isResolved: boolean;
  composing: boolean;
  setComposing: (composing: boolean) => void;
  draft: string;
  setDraft: (draft: string) => void;
  sending: boolean;
  resolving: boolean;
  onSend: (alsoResolve?: boolean) => void;
  onToggleResolved: () => void;
}) {
  return (
    <div className="flex items-start gap-2 border-t border-border bg-muted/20 px-3 py-2">
      {composing ? (
        <div className="flex flex-1 flex-col gap-2">
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                onSend();
              }
              if (e.key === 'Escape') setComposing(false);
            }}
            placeholder="Write a reply… Markdown supported. ⌘/Ctrl+Enter to send."
            className="min-h-20 bg-background"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setComposing(false)}
            >
              Cancel
            </Button>
            {canResolve && !isResolved && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSend(true)}
                disabled={sending || !draft.trim()}
              >
                <CheckIcon /> Reply & resolve
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => onSend()}
              disabled={sending || !draft.trim()}
            >
              {sending ? 'Sending…' : 'Reply'}
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setComposing(true)}
          className="flex h-7 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-left text-sm text-muted-foreground hover:border-ring"
        >
          <CornerDownRightIcon className="size-3.5" />
          Reply…
        </button>
      )}
      {canResolve && !composing && (
        <Button
          variant={isResolved ? 'ghost' : 'outline'}
          size="sm"
          onClick={onToggleResolved}
          disabled={resolving}
        >
          {isResolved ? (
            <>
              <RotateCcwIcon /> Reopen
            </>
          ) : (
            <>
              <CheckIcon /> Resolve
            </>
          )}
        </Button>
      )}
    </div>
  );
}
