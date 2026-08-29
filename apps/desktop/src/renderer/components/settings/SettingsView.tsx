import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { SECRET_PLACEHOLDER } from '../../../host/contract.js';
import type {
  SettingsFieldView,
  SettingsGroup,
} from '../../../host/contract.js';
import {
  updateDesktopPrefs,
  useDesktopPrefs,
} from '../../lib/desktop-prefs.js';
import { useRepo } from '../../lib/repo-context.js';
import { useSettingsView, useUpdateSetting } from '../../lib/queries.js';
import { persistedValue, type PendingSave } from '../../lib/settings-save.js';
import { useTheme, type ThemePreference } from '../../lib/theme.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Label } from '../ui/label.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';
import { Skeleton } from '../ui/skeleton.js';
import { Switch } from '../ui/switch.js';

type GroupKey = 'appearance' | SettingsGroup;

const GROUPS: { key: GroupKey; label: string; blurb: string }[] = [
  { key: 'appearance', label: 'Appearance', blurb: 'How Kirby Desktop looks.' },
  {
    key: 'general',
    label: 'General',
    blurb: 'Editor, identity and worktree placement.',
  },
  {
    key: 'agent',
    label: 'Agent',
    blurb: 'Which AI coding agent Kirby launches.',
  },
  {
    key: 'sync',
    label: 'Sync',
    blurb: 'Keeping worktrees in step with merged pull requests.',
  },
  {
    key: 'terminal',
    label: 'Terminal',
    blurb: 'How agent sessions are hosted.',
  },
  {
    key: 'provider',
    label: 'Provider',
    blurb: 'Credentials and project for your VCS host.',
  },
];

/**
 * Settings page: group navigation on the left, one card per group on
 * the right. Fields come from the CLI's own catalog (host-side); only
 * the Appearance group is desktop-local.
 */
export function SettingsView() {
  const { repo } = useRepo();
  const view = useSettingsView(repo.cwd);
  const [activeGroup, setActiveGroup] = useState<GroupKey>('appearance');

  const byGroup = new Map<GroupKey, SettingsFieldView[]>();
  for (const f of view.data ?? []) {
    const arr = byGroup.get(f.group) ?? [];
    arr.push(f);
    byGroup.set(f.group, arr);
  }
  const visibleGroups = GROUPS.filter(
    (g) => g.key === 'appearance' || (byGroup.get(g.key)?.length ?? 0) > 0
  );

  const jump = (key: GroupKey) => {
    setActiveGroup(key);
    document
      .getElementById(`settings-${key}`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <div className="flex h-full min-h-0">
      <nav className="w-44 shrink-0 border-r border-border bg-sidebar/60 py-3">
        {visibleGroups.map((g) => (
          <button
            key={g.key}
            onClick={() => jump(g.key)}
            className={cn(
              'flex h-7 w-full items-center px-4 text-base transition-colors hover:bg-accent',
              activeGroup === g.key
                ? 'border-l-2 border-primary bg-sidebar-active font-medium text-foreground'
                : 'border-l-2 border-transparent text-muted-foreground'
            )}
          >
            {g.label}
          </button>
        ))}
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-6">
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Stored in <span className="font-mono">~/.kirby</span> and the
            repository's <span className="font-mono">.kirby/</span> — shared
            with the Kirby terminal UI.
          </p>

          {view.isLoading && (
            <div className="mt-6 space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}
          {view.error && (
            <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {String(view.error.message)}
            </div>
          )}

          {visibleGroups.map((g) => (
            <section
              key={g.key}
              id={`settings-${g.key}`}
              className="scroll-mt-4 pt-8"
            >
              <h2 className="text-lg font-semibold">{g.label}</h2>
              <p className="mb-3 text-sm text-muted-foreground">{g.blurb}</p>
              <div className="divide-y divide-border rounded-lg border border-border bg-card">
                {g.key === 'appearance' ? (
                  <AppearanceRows />
                ) : (
                  (byGroup.get(g.key) ?? []).map((f) => (
                    <FieldRow
                      key={`${f.key}:${f.label}`}
                      field={f}
                      updatedAt={view.dataUpdatedAt}
                    />
                  ))
                )}
              </div>
            </section>
          ))}
          <div className="h-16" />
        </div>
      </div>
    </div>
  );
}

function RowShell({
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

function AppearanceRows() {
  const { preference, setPreference } = useTheme();
  const prefs = useDesktopPrefs();
  return (
    <>
      <RowShell
        label="Theme"
        description="Follow the system, or force light / dark."
        control={
          <Select
            value={preference}
            onValueChange={(v) => setPreference(v as ThemePreference)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      <RowShell
        htmlFor="pref-native-frame"
        label="Native window frame"
        description="Use the operating system's title bar and menu bar instead of Kirby's compact header. Takes effect the next time Kirby starts."
        control={
          <Switch
            id="pref-native-frame"
            checked={prefs.nativeFrame}
            onCheckedChange={(c) =>
              void updateDesktopPrefs({ nativeFrame: c })
                .then(() =>
                  toast.success(
                    c
                      ? 'Native frame on next launch'
                      : 'Compact header on next launch'
                  )
                )
                .catch((e: unknown) => toast.error(errorMessage(e)))
            }
          />
        }
      />
    </>
  );
}

const CUSTOM = '__custom__';

function FieldRow({
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
  const matches = presets.some((p) => p.value === field.value);
  const firstValue = presets.find((p) => p.value !== null)?.value ?? '';
  // An unset field resolves to '' — show the default (first) preset.
  const current =
    field.value === '' ? firstValue : matches ? field.value : CUSTOM;
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
                  <SelectItem key={p.name} value={p.value ?? ''}>
                    {p.name}
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
