import { CheckIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CommentSeverity } from '../../../../host/contract.js';
import { SEVERITIES } from '../../../lib/review/severity.js';
import { Button } from '../../ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select.js';
import { Textarea } from '../../ui/textarea.js';

/**
 * Editing form for one draft comment: its body and its severity, with
 * Cmd/Ctrl+Enter to save and Escape to back out.
 *
 * The draft is edited as a controlled pair held by the card above, so
 * cancelling is a discard of that pair rather than anything this form
 * has to undo.
 */
export function DraftEditor({
  body,
  severity,
  notice = null,
  onBodyChange,
  onSeverityChange,
  onSave,
  onCancel,
}: {
  body: string;
  severity: CommentSeverity;
  /** Freshness line from `useComposerRefresh`, shown above the input. */
  notice?: ReactNode;
  onBodyChange: (body: string) => void;
  onSeverityChange: (severity: CommentSeverity) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2 p-3">
      {notice}
      <Textarea
        autoFocus
        value={body}
        onChange={(e) => onBodyChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            onSave();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        className="min-h-28 bg-background"
      />
      <div className="flex items-center gap-2">
        <Select
          value={severity}
          onValueChange={(v) => onSeverityChange(v as CommentSeverity)}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEVERITIES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave} disabled={!body.trim()}>
          <CheckIcon /> Save
        </Button>
      </div>
    </div>
  );
}
