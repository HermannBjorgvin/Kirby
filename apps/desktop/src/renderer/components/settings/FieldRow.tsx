import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { SECRET_PLACEHOLDER } from '../../../host/contract.js';
import type { SettingsFieldView } from '../../../host/contract.js';
import { useRepo } from '../../lib/repo-context.js';
import { useUpdateSetting } from '../../lib/data/mutations.js';
import { persistedValue, type PendingSave } from '../../lib/settings-save.js';
import {
  CUSTOM,
  isDefaultedPreset,
  selectedPreset,
} from '../../lib/settings-select.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';
import { Switch } from '../ui/switch.js';
import { RowShell } from './RowShell.js';

/** One host-supplied setting, in whichever of the three shapes its
 *  field kind calls for: a switch, a preset select with a custom
 *  escape hatch, or a text box. */
export function FieldRow({
  field,
  updatedAt,
}: {
  field: SettingsFieldView;
  /** `dataUpdatedAt` of the settings query this `field` came from. */
  updatedAt: number;
}) {
  const { repo } = useRepo();
  const update = useUpdateSetting(repo.cwd);
  const id = `field-${field.key}-${field.label.replace(/\W+/g, '-')}`;

  // The last save made from this row, held only until the settings
  // query answers again — see `persistedValue` for why blurring an
  // untouched field cannot simply compare against `field.value`, and
  // why the record retires on the query speaking rather than on the
  // value it reports.
  const pendingRef = useRef<PendingSave | null>(null);

  const save = (value: string, label = field.label) => {
    if (value === persistedValue(field.value, updatedAt, pendingRef.current))
      return;
    pendingRef.current = { seenAt: updatedAt, base: field.value, value };
    update.mutate(
      { ref: { label: field.label, key: field.key }, value },
      {
        onSuccess: () => toast.success(`${label} saved`),
        onError: (e) => toast.error(errorMessage(e)),
      }
    );
  };

  // A host-side gate (e.g. "no backend switch with live sessions")
  // grays the control out and explains itself in the description.
  const locked = Boolean(field.disabled);
  const shown: typeof field = locked
    ? {
        ...field,
        description: field.description
          ? `${field.description} (${field.disabled})`
          : field.disabled,
      }
    : field;

  if (field.kind === 'boolean') {
    return (
      <RowShell
        htmlFor={id}
        label={shown.label}
        description={shown.description}
        control={
          <Switch
            id={id}
            checked={field.value === 'true'}
            disabled={update.isPending || locked}
            onCheckedChange={(c) => save(c ? 'true' : 'false')}
          />
        }
      />
    );
  }

  // Keyed on the persisted value so a successful save (or an external
  // edit) resets the local draft without effect-driven state syncing.
  if (field.kind === 'select') {
    return (
      <SelectRow
        key={field.value}
        field={shown}
        id={id}
        onSave={save}
        saving={update.isPending || locked}
      />
    );
  }

  return (
    <TextRow
      key={field.value}
      field={shown}
      id={id}
      onSave={save}
      saving={update.isPending || locked}
    />
  );
}

/** Handlers that fire on the ways a select item gets chosen. */
function pinOnSelect(save: () => void) {
  return {
    onPointerUp: save,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') save();
    },
  };
}

function SelectRow({
  field,
  id,
  onSave,
  saving,
}: {
  field: SettingsFieldView;
  id: string;
  onSave: (value: string) => void;
  saving: boolean;
}) {
  const presets = field.presets ?? [];
  const hasCustom = presets.some((p) => p.value === null);
  const current = selectedPreset(field);
  const [custom, setCustom] = useState(current === CUSTOM);
  const [draft, setDraft] = useState(field.value);

  return (
    <RowShell
      htmlFor={id}
      label={field.label}
      description={field.description}
      control={
        <>
          {custom && (
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={(e) => onSave(e.currentTarget.value)}
              onKeyDown={(e) =>
                e.key === 'Enter' && onSave(e.currentTarget.value)
              }
              className="w-48 font-mono"
              placeholder="custom value"
            />
          )}
          <Select
            value={custom ? CUSTOM : current}
            disabled={saving}
            onValueChange={(v) => {
              if (v === CUSTOM) {
                setCustom(true);
                return;
              }
              setCustom(false);
              onSave(v);
            }}
          >
            <SelectTrigger id={id} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {presets
                .filter((p) => p.value !== null)
                .map((p) => (
                  <SelectItem
                    key={p.name}
                    value={p.value ?? ''}
                    // The trigger already displays this entry, so
                    // selecting it is not a *value* change and the
                    // control's own change event cannot be relied on to
                    // fire — without this the default could never be
                    // pinned. A pinned value is the difference between
                    // a preference and one that flips when tmux comes
                    // or goes. Saving twice is harmless: the second is
                    // dropped as unchanged (see `persistedValue`).
                    //
                    // Pointer-up and Enter, not click: the control
                    // selects on pointer-up and closes, and a menu with
                    // no exit transition is unmounted before any click
                    // event could reach the item.
                    {...(isDefaultedPreset(field, p.value)
                      ? pinOnSelect(() => onSave(p.value ?? ''))
                      : {})}
                  >
                    {/* Marked only while nothing is stored *and* the
                        host named the default, so the row says "this was
                        decided for you" rather than labelling a choice
                        the user made — or inventing one nobody made. */}
                    {isDefaultedPreset(field, p.value)
                      ? `${p.name} (default)`
                      : p.name}
                  </SelectItem>
                ))}
              {hasCustom && <SelectItem value={CUSTOM}>Custom…</SelectItem>}
              {!hasCustom && current === CUSTOM && (
                <SelectItem value={CUSTOM}>Custom: {field.value}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </>
      }
    />
  );
}

function TextRow({
  field,
  id,
  onSave,
  saving,
}: {
  field: SettingsFieldView;
  id: string;
  onSave: (value: string) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState(field.value);
  const [reveal, setReveal] = useState(false);
  const dirty = draft !== field.value;

  return (
    <RowShell
      htmlFor={id}
      label={field.label}
      description={field.description}
      control={
        <>
          <div className="relative">
            <Input
              id={id}
              type={field.masked && !reveal ? 'password' : 'text'}
              value={draft}
              disabled={saving}
              onChange={(e) => setDraft(e.target.value)}
              // Read the value off the element rather than the render
              // closure: a keypress that lands before React has
              // re-rendered would otherwise save the value from before
              // the edit, which the unchanged-guard then drops entirely.
              onBlur={(e) => onSave(e.currentTarget.value)}
              onKeyDown={(e) =>
                e.key === 'Enter' && onSave(e.currentTarget.value)
              }
              className={cn('w-64 font-mono', field.masked && 'pr-8')}
              placeholder={field.masked ? '••••••••' : undefined}
            />
            {/* A stored secret arrives as a placeholder, never the real
                value, so there is nothing to reveal until it's edited. */}
            {field.masked && draft !== SECRET_PLACEHOLDER && (
              <button
                type="button"
                onClick={() => setReveal((r) => !r)}
                aria-label={reveal ? 'Hide' : 'Reveal'}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {reveal ? (
                  <EyeOffIcon className="size-3.5" />
                ) : (
                  <EyeIcon className="size-3.5" />
                )}
              </button>
            )}
          </div>
          {dirty && (
            <Button size="sm" onClick={() => onSave(draft)} disabled={saving}>
              Save
            </Button>
          )}
        </>
      }
    />
  );
}
