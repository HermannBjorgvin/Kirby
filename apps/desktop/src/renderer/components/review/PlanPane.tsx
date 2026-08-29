import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  CornerUpRightIcon,
  Loader2Icon,
  NotebookPenIcon,
  RotateCcwIcon,
  SendIcon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';
import { composePlanPrompt, type PlanItem } from '@kirby/core/plan';
import { checkoutModel, planRows, planSummary } from '../../lib/plan-model.js';
import { SEVERITY_BADGE } from '../../lib/severity.js';
import { cn } from '../../lib/utils.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { Tip } from '../ui/tooltip.js';
import { PlanNoteComposer } from './PlanControls.js';

/**
 * The plan, laid out for checkout: the queued comments in the order the
 * agent will be given them, the note on each, the exact prompt that
 * will be sent, and the send itself.
 *
 * Ordering is the order the comments were added, which is also how
 * `composePlanPrompt` numbers them — sorting the list here would
 * silently renumber the prompt against what the user is reading (see
 * plan-model.ts).
 */
export function PlanPane({
  items,
  branch,
  agentRunning,
  sending,
  onRemove,
  onAnnotate,
  onShowInDiff,
  onClear,
  onSend,
}: {
  items: PlanItem[];
  branch: string;
  agentRunning: boolean;
  sending: boolean;
  onRemove: (item: PlanItem) => void;
  onAnnotate: (item: PlanItem, note: string) => void;
  onShowInDiff: (item: PlanItem) => void;
  onClear: () => void;
  onSend: (mode: 'inject' | 'new-session') => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const rows = planRows(items);
  const { count, noted } = planSummary(items);
  const checkout = checkoutModel({ count, agentRunning, sending });

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border px-4 py-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <ClipboardListIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold leading-tight">
            Plan
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {count} comment{count === 1 ? '' : 's'}
            {noted > 0 && ` · ${noted} with a note`} · for the agent on{' '}
            <span className="font-mono">{branch}</span>
          </span>
        </span>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <ol className="divide-y divide-border">
          {rows.map((row) => {
            const item = items[row.index - 1]!;
            return (
              <li key={row.key} className="group/row">
                <div className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums text-muted-foreground">
                    {row.index}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {row.location}
                      </span>
                      {row.severity && (
                        <Badge variant={SEVERITY_BADGE[row.severity]}>
                          {row.severity}
                        </Badge>
                      )}
                      {row.author && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          @{row.author}
                        </span>
                      )}
                      {row.replyCount > 0 && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          +{row.replyCount}{' '}
                          {row.replyCount === 1 ? 'reply' : 'replies'}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-sm leading-snug">
                      {row.body}
                    </p>
                    {row.note !== undefined && editing !== row.key && (
                      <p className="mt-1.5 flex items-start gap-1.5 rounded border border-primary/25 bg-primary/5 px-2 py-1 text-sm">
                        <NotebookPenIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
                        <span className="min-w-0 whitespace-pre-wrap">
                          {row.note}
                        </span>
                      </p>
                    )}
                  </div>
                  <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
                    <Tip label="Show in diff">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Show ${row.location} in diff`}
                        onClick={() => onShowInDiff(item)}
                      >
                        <CornerUpRightIcon />
                      </Button>
                    </Tip>
                    <Tip label={row.note ? 'Edit note' : 'Add a note'}>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${row.note ? 'Edit' : 'Add'} note for ${
                          row.location
                        }`}
                        className={cn(row.note && 'text-primary opacity-100')}
                        onClick={() =>
                          setEditing((k) => (k === row.key ? null : row.key))
                        }
                      >
                        <NotebookPenIcon />
                      </Button>
                    </Tip>
                    <Tip label="Remove from plan">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${row.location} from plan`}
                        onClick={() => onRemove(item)}
                      >
                        <XIcon />
                      </Button>
                    </Tip>
                  </span>
                </div>
                {editing === row.key && (
                  <PlanNoteComposer
                    initial={row.note ?? ''}
                    onSave={(text) => {
                      onAnnotate(item, text);
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                )}
              </li>
            );
          })}
        </ol>

        <PromptPreview
          open={previewOpen}
          onToggle={() => setPreviewOpen((o) => !o)}
          prompt={composePlanPrompt(items)}
        />
      </ScrollArea>

      <footer className="shrink-0 border-t border-border bg-muted/20 px-4 py-2.5">
        {agentRunning && (
          <p className="mb-2 text-xs text-muted-foreground">
            An agent is already running on{' '}
            <span className="font-mono">{branch}</span>. Sending adds the plan
            to the conversation it is already having.
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear plan
          </Button>
          <div className="flex-1" />
          {checkout.choices.includes('inject') && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSend('new-session')}
              disabled={!checkout.canSend}
            >
              <RotateCcwIcon /> Restart with plan
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => onSend(checkout.primary)}
            disabled={!checkout.canSend}
          >
            {sending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
            {sending
              ? 'Sending…'
              : checkout.primary === 'inject'
              ? 'Send to agent'
              : 'Start agent with plan'}
          </Button>
        </div>
      </footer>
    </div>
  );
}

/**
 * The exact text the agent will receive. Collapsed by default — it is
 * reassurance, not the point of the screen — but present, because
 * "what did it actually send?" is otherwise unanswerable from the UI.
 */
function PromptPreview({
  open,
  onToggle,
  prompt,
}: {
  open: boolean;
  onToggle: () => void;
  prompt: string;
}) {
  return (
    <section className="border-t border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex h-8 w-full items-center gap-1.5 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <ChevronDownIcon className="size-3.5" />
        ) : (
          <ChevronRightIcon className="size-3.5" />
        )}
        Prompt preview
      </button>
      {open && (
        <pre className="mx-4 mb-3 max-h-72 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground/90">
          {prompt}
        </pre>
      )}
    </section>
  );
}
