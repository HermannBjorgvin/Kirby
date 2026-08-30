import { Label } from '../ui/label.js';

/** One settings row: label and description on the left, control on the
 *  right. Every row on the page — desktop-local or host-supplied —
 *  renders through this so the columns line up across the card. */
export function RowShell({
  label,
  description,
  control,
  htmlFor,
}: {
  label: string;
  description?: string;
  control: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex items-center gap-6 px-4 py-3">
      <div className="min-w-0 flex-1">
        <Label htmlFor={htmlFor}>{label}</Label>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">{control}</div>
    </div>
  );
}
