import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  FileDiffIcon,
  Loader2Icon,
  NotebookPenIcon,
  RotateCcwIcon,
  SendIcon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';
import { composePlanPrompt, type PlanItem } from '@kirby/core/plan';
import { checkoutModel, planRows, planSummary } from '../../lib/plan/plan-model.js';
import { SEVERITY_BADGE } from '../../lib/review/severity.js';
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
  openNoteFor,
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
  /** A request to open one row's note composer, from somewhere that
   *  cannot show one itself (the rail's context menu). A fresh object
   *  each time, so asking twice for the same row still opens it. */
  openNoteFor?: { key: string } | null;
}) {
  const [editing, setEditing] = useState<string | null>(
    openNoteFor?.key ?? null
  );
  // Follow each request once: a composer the user has since closed must
  // stay closed, so only a *new* request re-opens one.
  const [prevRequest, setPrevRequest] = useState(openNoteFor);
  if (openNoteFor !== prevRequest) {
    setPrevRequest(openNoteFor);
    if (openNoteFor) setEditing(openNoteFor.key);
  }
  const [previewOpen, setPreviewOpen] = useState(false);
  const rows = planRows(items);
  const { count, noted } = planSummary(items);
  const checkout = checkoutModel({ count, agentRunning, sending });

  return (
    <section
      aria-label="Plan"
      className="flex h-full min-h-0 flex-col bg-background"
    >
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
        <ol aria-label="Queued comments" className="divide-y divide-border">
          {rows.map((row, i) => {
            // `planRows` maps one row per item in order, so the index
            // is the item — the row carries only what is displayed.
            const item = items[i]!;
            return (
              <li key={row.key} className="group/row">
                <div className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs font-medium tabular-nums text-foreground/70">
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
                      <p className="mt-1.5 flex w-fit max-w-full items-start gap-1.5 rounded-r border-l-2 border-primary/50 bg-primary/[0.06] py-0.5 pr-2 pl-2 text-sm">
                        <NotebookPenIcon className="mt-0.5 size-3.5 shrink-0 text-primary/70" />
                        <span className="min-w-0 whitespace-pre-wrap">
                          {row.note}
                        </span>
                      </p>
                    )}
                  </div>
                  {/* Always visible, unlike the controls on a diff
                      card: curating the queue is the whole purpose of
                      this screen, and hiding the remove button behind a
                      hover makes the list look uneditable. */}
                  <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground opacity-70 transition-opacity group-hover/row:opacity-100">
                    <Tip label="Show in diff">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Show ${row.location} in diff`}
                        onClick={() => onShowInDiff(item)}
                      >
                        <FileDiffIcon />
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
      </ScrollArea>

      <PromptPreview
        open={previewOpen}
        onToggle={() => setPreviewOpen((o) => !o)}
        prompt={composePlanPrompt(items)}
      />

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
    </section>
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
    <section className="shrink-0 border-t border-border">
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
