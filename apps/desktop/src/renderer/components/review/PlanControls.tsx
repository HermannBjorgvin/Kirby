import { CheckIcon, ListPlusIcon, NotebookPenIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { Textarea } from '../ui/textarea.js';
import { Tip } from '../ui/tooltip.js';

/**
 * Queueing one comment for the agent — the "add to cart" control, and
 * the note that can ride along with it.
 *
 * Both comment cards (a reviewer's thread and the agent's own draft)
 * render these, so the gesture is identical wherever a comment appears.
 * State lives in `usePlanControls`; this file is what it looks like.
 */

/**
 * The header control. Hidden until the card is hovered or focused
 * while the comment is not queued — a diff with a dozen comments would
 * otherwise carry a dozen buttons — and pinned open once it is, because
 * membership is state the user needs to see without hunting for it.
 */
export function PlanControls({
  inPlan,
  hasNote,
  onToggle,
  onNote,
}: {
  inPlan: boolean;
  hasNote: boolean;
  onToggle: () => void;
  onNote: () => void;
}) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 transition-opacity',
        !inPlan &&
          'opacity-0 focus-within:opacity-100 group-hover/card:opacity-100'
      )}
    >
      {inPlan ? (
        <Tip label="Remove from plan">
          <Button
            variant="secondary"
            size="sm"
            onClick={onToggle}
            aria-label="Remove from plan"
            aria-pressed
            className="border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
          >
            <CheckIcon /> In plan
          </Button>
        </Tip>
      ) : (
        <Tip label="Queue this comment for the agent">
          <Button
            variant="outline"
            size="sm"
            onClick={onToggle}
            aria-label="Add to plan"
            aria-pressed={false}
          >
            <ListPlusIcon /> Add to plan
          </Button>
        </Tip>
      )}
      <Tip label={hasNote ? 'Edit your note' : 'Add to plan with a note'}>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onNote}
          aria-label={hasNote ? 'Edit note' : 'Add to plan with a note'}
          className={cn(hasNote && 'text-primary')}
        >
          <NotebookPenIcon />
        </Button>
      </Tip>
    </span>
  );
}

/**
 * The note composer, docked under the comment it belongs to rather
 * than opened as a dialog: the note describes what the agent should do
 * about *this* code, and a dialog would take the code off screen at
 * the moment of writing it.
 *
 * Escape closes the composer and leaves the comment queued — opening it
 * already added the comment, so cancelling a note is not cancelling an
 * add. The button says "Save note" for that reason, not "Add".
 */
export function PlanNoteComposer({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // Put the caret after the existing note rather than selecting it,
    // so re-opening a note to extend it does not blank it on the first
    // keystroke.
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <div className="border-t border-primary/30 bg-primary/5 px-3 py-2">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
        <NotebookPenIcon className="size-3.5" />
        Your note to the agent
      </p>
      <Textarea
        aria-label="Your note to the agent"
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            onSave(text);
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="How should the agent approach this? ⌘/Ctrl+Enter to save."
        className="min-h-16 bg-background"
      />
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          The comment is already in the plan — a note just tells the agent how
          you want it handled.
        </span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onSave(text)}>
          Save note
        </Button>
      </div>
    </div>
  );
}

/** The saved note, shown under a queued comment when not editing. */
export function PlanNote({
  note,
  onEdit,
}: {
  note: string;
  onEdit: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="flex w-full items-start gap-2 border-t border-primary/25 bg-primary/5 px-3 py-1.5 text-left text-sm hover:bg-primary/10"
      aria-label="Edit note"
    >
      <NotebookPenIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 whitespace-pre-wrap text-foreground/90">
        {note}
      </span>
    </button>
  );
}

/**
 * What hangs under a queued comment: the note composer while it is
 * open, the saved note when there is one, nothing otherwise.
 *
 * One component rather than three conditionals in each card — both
 * cards render the same three states, and spelling them out at each
 * call site is how the two drift apart.
 */
export function PlanAttachment({
  composing,
  note,
  onSave,
  onCancel,
  onEdit,
}: {
  composing: boolean;
  note: string | undefined;
  onSave: (text: string) => void;
  onCancel: () => void;
  onEdit: () => void;
}) {
  if (composing) {
    return (
      <PlanNoteComposer
        initial={note ?? ''}
        onSave={onSave}
        onCancel={onCancel}
      />
    );
  }
  if (note === undefined) return null;
  return <PlanNote note={note} onEdit={onEdit} />;
}
