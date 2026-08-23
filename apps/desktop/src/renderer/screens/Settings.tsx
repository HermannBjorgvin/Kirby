import { useState } from 'react';
import type { SettingsFieldView } from '../../host/contract.js';
import { useHostQuery } from '../hooks/useHostQuery.js';

/**
 * Settings: the same field catalog the CLI's settings panel uses,
 * computed host-side. Preset-backed fields render as selects; plain
 * fields as text inputs (password when masked). Changes persist on
 * commit using the CLI's own config-bag semantics.
 */
export function Settings({ repoCwd }: { repoCwd: string }) {
  const view = useHostQuery(() => window.kirby.getSettingsView(), [repoCwd]);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (field: SettingsFieldView, value: string) => {
    if (value === field.value) return;
    setSaving(field.label);
    setError(null);
    try {
      await window.kirby.updateSettingsField(
        { label: field.label, key: field.key },
        value
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
      setSaved(field.label);
      setTimeout(() => setSaved((s) => (s === field.label ? null : s)), 2000);
      view.reload();
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-6">
        <h2 className="mb-1 text-lg font-semibold text-slate-100">Settings</h2>
        <p className="mb-5 text-xs text-slate-500">
          Stored in ~/.kirby — shared with the Kirby TUI.
        </p>

        {view.loading && <p className="text-sm text-slate-500">Loading…</p>}
        {view.error && (
          <p className="font-mono text-sm text-red-400">{view.error}</p>
        )}

        {error && (
          <p className="mb-3 rounded-md border border-red-900 bg-red-950/50 px-3 py-2 font-mono text-xs text-red-300">
            {error}
          </p>
        )}

        {view.data && (
          <div className="space-y-3 pb-16">
            {view.data.map((f, i) => (
              <FieldRow
                key={`${i}-${f.label}-${f.key}`}
                field={f}
                saving={saving === f.label}
                savedNow={saved === f.label}
                onSave={(value) => void save(f, value)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FieldRow({
  field,
  saving,
  savedNow,
  onSave,
}: {
  field: SettingsFieldView;
  saving: boolean;
  savedNow: boolean;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(field.value);

  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/40 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-slate-200">
          {field.label}
        </label>
        {field.presets && field.presets.length > 0 ? (
          <select
            value={(() => {
              if (field.presets!.some((p) => p.value === draft)) return draft;
              // An unset field resolves to '' — show the default (first)
              // preset rather than a misleading "Custom".
              if (draft === '') return field.presets![0]?.value ?? '';
              return '__custom__';
            })()}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__custom__') return; // switch to text editing
              setDraft(v ?? '');
              onSave(v ?? '');
            }}
            className="w-56 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-cyan-500"
          >
            {draft !== '' && !field.presets!.some((p) => p.value === draft) && (
              <option value="__custom__">Custom: {draft}</option>
            )}
            {field.presets.map((preset) => (
              <option key={preset.name} value={preset.value ?? ''}>
                {preset.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={field.masked ? 'password' : 'text'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave(draft);
            }}
            onBlur={() => onSave(draft)}
            spellCheck={false}
            className="w-56 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-sm text-slate-200 outline-none focus:border-cyan-500"
          />
        )}
      </div>
      {field.description && (
        <p className="mt-1 text-[11px] leading-snug text-slate-500">
          {field.description}
        </p>
      )}
      <div className="h-3">
        {saving && (
          <span className="animate-pulse font-mono text-[10px] text-slate-500">
            saving…
          </span>
        )}
        {savedNow && !saving && (
          <span className="font-mono text-[10px] text-emerald-500">saved</span>
        )}
        {/* preset selects commit immediately; text fields save on
            blur/enter, so surface uncommitted drafts */}
        {!saving && !savedNow && draft !== field.value && (
          <button
            onClick={() => onSave(draft)}
            className="font-mono text-[10px] text-cyan-400 hover:text-cyan-300"
          >
            save changed value…
          </button>
        )}
      </div>
    </div>
  );
}
