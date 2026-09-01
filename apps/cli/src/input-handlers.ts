import type {
  ConfigContextValue,
  KeybindContextValue,
  SessionActionsContextValue,
  TerminalLayout,
  AsyncOpsValue as AsyncOpsContextValue,
  SettingsValue as SettingsModalValue,
  NavValue as NavContextValue,
} from '@kirby/app-core';
import type { KeyPress, SettingsField } from '@kirby/core';
import { updateConfigField } from '@kirby/app-core';
import {
  ACTIONS,
  PRESETS,
  applySessionBackend,
  buildControlsRows,
  buildSettingsFields,
  descriptorFromKeypress,
  findConflict,
  getBindingRows,
  handleTextInput,
  hasAnySession,
  getTmuxAvailability,
  projectTerminalBackendOverride,
  resolveValue,
} from '@kirby/core';
import { autoDetectProjectConfig } from '@kirby/vcs-core';

/** Guard for `terminalBackend` field changes. Returns true if the
 *  caller should proceed with the write; returns false (and flashes
 *  a status) if the change is blocked. Both gates live here so the
 *  cycle-left/cycle-right and edit-toggle paths share the same
 *  policy.
 *
 *  Gates:
 *  - Active sessions: switching backend mid-session would strand
 *    existing sessions on a stale factory.
 *  - Tmux availability: refusing a switch to tmux when the binary
 *    is missing surfaces the install hint instead of failing later
 *    at session-spawn time. */
function canApplyFieldChange(
  field: SettingsField,
  value: string | undefined,
  ctx: SettingsHandlerCtx
): boolean {
  if (field.key !== 'terminalBackend') return true;
  if (hasAnySession()) {
    ctx.sessions.flashStatus(
      'Close all sessions before switching terminal backend.'
    );
    return false;
  }
  // The Settings row writes the global key, which a per-project
  // override would silently win over on the next read — the edit would
  // appear to save and then revert.
  if (projectTerminalBackendOverride(process.cwd())) {
    ctx.sessions.flashStatus(
      'This project pins terminalBackend in its own config — edit that instead.'
    );
    return false;
  }
  if (value === 'tmux') {
    const status = getTmuxAvailability();
    if (status && !status.available) {
      const hint = status.installHint ? ` — try \`${status.installHint}\`` : '';
      ctx.sessions.flashStatus(`tmux not installed${hint}`);
      return false;
    }
  }
  return true;
}

/** Write a settings field, honouring its guard and running whatever
 *  side effect the write owns.
 *
 *  `terminalBackend` is the only field with such an effect: the pty
 *  registry's backend factory has to be rebuilt to match the new
 *  selection. It belongs on the write path rather than in a render
 *  effect keyed on the config value, because this is the point where
 *  {@link canApplyFieldChange} has just established there is no live
 *  session — the only moment the swap is safe. A blocked change
 *  therefore never reaches `applySessionBackend`.
 *
 *  `updateField` routes the new config through React state, so the
 *  value to apply is recomputed here with the same `updateConfigField`
 *  the context uses. */
function writeFieldChange(
  field: SettingsField,
  value: string | undefined,
  ctx: SettingsHandlerCtx
): void {
  if (!canApplyFieldChange(field, value, ctx)) return;
  ctx.config.updateField(field, value);
  if (field.key === 'terminalBackend') {
    applySessionBackend(updateConfigField(ctx.config.config, field, value));
  }
}

// ── Shared context slice types ────────────────────────────────────

export type NavValue = NavContextValue;
export type AsyncOpsValue = AsyncOpsContextValue;
export type SettingsValue = SettingsModalValue;
export type { TerminalLayout };

// ── Settings input handler ────────────────────────────────────────

export interface SettingsHandlerCtx {
  settings: SettingsValue;
  config: ConfigContextValue;
  sessions: SessionActionsContextValue;
  keybinds: KeybindContextValue;
}

/** Everything a settings action needs, computed once per keypress. */
interface SettingsActionCtx {
  ctx: SettingsHandlerCtx;
  fields: SettingsField[];
  /** The row the cursor is on. */
  field: SettingsField;
}

type SettingsAction = (a: SettingsActionCtx) => void;

/** Index of the preset holding the field's current value, or -1 when
 *  the stored value is not one of them. An unset field reads as the
 *  default it resolves to — its own `defaultValue` where it has one,
 *  the first preset otherwise — so the cursor starts on the row the
 *  panel is displaying and one press moves off it, rather than
 *  re-selecting what is already in force. */
function currentPresetIndex(
  ctx: SettingsHandlerCtx,
  field: SettingsField,
  presets: { value: string | null }[]
): number {
  const currentValue = resolveValue(ctx.config.config, field) || undefined;
  const fallback =
    presets.find((p) => p.value === field.defaultValue)?.value ??
    presets[0]!.value;
  const effectiveValue = currentValue ?? fallback;
  return presets.findIndex((p) => p.value === effectiveValue);
}

function closeSettings({ ctx }: SettingsActionCtx): void {
  ctx.settings.setSettingsOpen(false);
}

function navigateDown({ ctx, fields }: SettingsActionCtx): void {
  ctx.settings.setSettingsFieldIndex((i) => Math.min(i + 1, fields.length - 1));
}

function navigateUp({ ctx }: SettingsActionCtx): void {
  ctx.settings.setSettingsFieldIndex((i) => Math.max(i - 1, 0));
}

/** Step the field one preset in `step`'s direction, wrapping.
 *
 *  Presets whose value is `null` are the "inherit / unset" row: cycling
 *  is for picking a concrete value, so they are filtered out and the
 *  empty state stays reachable only by editing. */
function cyclePreset({ ctx, field }: SettingsActionCtx, step: 1 | -1): void {
  if (!field.presets) return;
  const presets = field.presets.filter((p) => p.value !== null);
  let idx = currentPresetIndex(ctx, field, presets);
  if (idx === -1) idx = 0;
  const preset = presets[(idx + step + presets.length) % presets.length]!;
  // The keybind preset lives in the keybind context, not the config
  // file, so it takes its own write path.
  if (field.key === 'keybindPreset' && preset.value) {
    ctx.keybinds.setPreset(preset.value);
    return;
  }
  writeFieldChange(field, preset.value ?? undefined, ctx);
}

/** Enter on a field. What that means depends on the field: open a
 *  sub-screen, advance a closed set of choices, or start typing. */
function editToggle({ ctx, field }: SettingsActionCtx): void {
  if (field.action === 'open-controls') {
    ctx.settings.setControlsOpen(true);
    ctx.settings.setControlsSelectedIndex(0);
    return;
  }
  // A field whose presets are all concrete has nothing to type into,
  // so Enter advances the choice instead of opening the editor.
  if (field.presets && field.presets.every((p) => p.value !== null)) {
    const presets = field.presets;
    const idx = (currentPresetIndex(ctx, field, presets) + 1) % presets.length;
    writeFieldChange(field, presets[idx]!.value ?? undefined, ctx);
    return;
  }
  ctx.settings.setEditingField(field.key);
  ctx.settings.setEditBuffer(resolveValue(ctx.config.config, field));
}

function autoDetect({ ctx }: SettingsActionCtx): void {
  const { updated, detected } = autoDetectProjectConfig(
    process.cwd(),
    ctx.config.providers
  );
  if (!updated) {
    ctx.sessions.flashStatus('Nothing new to detect (all fields already set)');
    return;
  }
  ctx.config.reloadFromDisk();
  ctx.sessions.flashStatus(
    `Auto-detected: ${Object.keys(detected).join(', ')}`
  );
}

const SETTINGS_ACTIONS: Record<string, SettingsAction> = {
  'settings.close': closeSettings,
  'settings.navigate-down': navigateDown,
  'settings.navigate-up': navigateUp,
  'settings.cycle-left': (a) => cyclePreset(a, -1),
  'settings.cycle-right': (a) => cyclePreset(a, 1),
  'settings.edit-toggle': editToggle,
  'settings.auto-detect': autoDetect,
};

/** Text entry for a free-form field — Esc discards, Enter commits.
 *  This sits *above* action dispatch: while the editor is open the
 *  keypress is text, never a bound action. */
function handleFieldEditMode(
  input: string,
  key: KeyPress,
  ctx: SettingsHandlerCtx,
  field: SettingsField
): void {
  if (key.escape) {
    ctx.settings.setEditingField(null);
    ctx.settings.setEditBuffer('');
    return;
  }
  if (key.return) {
    ctx.config.updateField(field, ctx.settings.editBuffer || undefined);
    ctx.settings.setEditingField(null);
    ctx.settings.setEditBuffer('');
    return;
  }
  handleTextInput(input, key, ctx.settings.setEditBuffer);
}

/** Settings panel entry point: resolve the keypress to an action ID
 *  and run it. Every action reads the same cursor row, so it is
 *  resolved once here rather than in each action. */
export function handleSettingsInput(
  input: string,
  key: KeyPress,
  ctx: SettingsHandlerCtx
): void {
  const fields = buildSettingsFields(ctx.config.provider);
  const field = fields[ctx.settings.settingsFieldIndex]!;

  if (ctx.settings.editingField) {
    handleFieldEditMode(input, key, ctx, field);
    return;
  }

  const action = ctx.keybinds.resolve(input, key, 'settings');
  if (!action) return;
  SETTINGS_ACTIONS[action]?.({ ctx, fields, field });
}

// ── Controls sub-screen input handler ─────────────────────────────

export interface ControlsHandlerCtx {
  settings: SettingsValue;
  keybinds: KeybindContextValue;
}

/**
 * Rebind mode: the next keypress becomes `actionId`'s binding, rather
 * than being resolved as a command. Esc cancels and Delete/Backspace
 * restores the preset default; anything else is captured.
 */
function captureRebind(
  input: string,
  key: KeyPress,
  ctx: ControlsHandlerCtx,
  actionId: string
): void {
  // Esc → cancel rebind
  if (key.escape) {
    ctx.settings.setControlsRebindActionId(null);
    return;
  }

  // Delete/Backspace → reset to preset default
  if (key.delete || key.backspace) {
    ctx.keybinds.resetBinding(actionId);
    ctx.settings.setControlsRebindActionId(null);
    return;
  }

  // Capture the keypress as a new binding
  const desc = descriptorFromKeypress(input, key);
  if (!desc) return;

  // Find the action's context
  const action = ACTIONS.find((a) => a.id === actionId);
  if (!action) return;

  // Check for conflicts in the same context
  const conflictId = findConflict(
    input,
    key,
    action.context,
    ctx.keybinds.bindings,
    ACTIONS,
    actionId
  );

  if (conflictId) {
    // Swap: give the conflicting action our old binding
    const oldBinding = ctx.keybinds.bindings[actionId];
    if (oldBinding) {
      ctx.keybinds.updateBinding(conflictId, oldBinding);
    }
  }

  // Set the new binding
  ctx.keybinds.updateBinding(actionId, [desc]);
  ctx.settings.setControlsRebindActionId(null);
}

export function handleControlsInput(
  input: string,
  key: KeyPress,
  ctx: ControlsHandlerCtx
): void {
  const rows = buildControlsRows(ctx.keybinds.bindings, ctx.keybinds.isCustom);
  const bindingRows = getBindingRows(rows);
  const totalBindings = bindingRows.length;

  const rebinding = ctx.settings.controlsRebindActionId;
  if (rebinding) {
    captureRebind(input, key, ctx, rebinding);
    return;
  }

  // ── Normal mode (uses keybind resolution) ──

  const action = ctx.keybinds.resolve(input, key, 'controls');

  if (action === 'controls.close') {
    ctx.settings.setControlsOpen(false);
    ctx.settings.setControlsSelectedIndex(0);
    return;
  }

  if (action === 'controls.navigate-down') {
    ctx.settings.setControlsSelectedIndex((i) =>
      Math.min(i + 1, totalBindings - 1)
    );
    return;
  }
  if (action === 'controls.navigate-up') {
    ctx.settings.setControlsSelectedIndex((i) => Math.max(i - 1, 0));
    return;
  }

  if (action === 'controls.rebind' && totalBindings > 0) {
    const selected = bindingRows[ctx.settings.controlsSelectedIndex];
    if (selected) {
      ctx.settings.setControlsRebindActionId(selected.actionId);
    }
    return;
  }

  if (action === 'controls.cycle-left' || action === 'controls.cycle-right') {
    const currentIdx = PRESETS.findIndex((p) => p.id === ctx.keybinds.presetId);
    let nextIdx: number;
    if (action === 'controls.cycle-right') {
      nextIdx = (currentIdx + 1) % PRESETS.length;
    } else {
      nextIdx = (currentIdx - 1 + PRESETS.length) % PRESETS.length;
    }
    ctx.keybinds.setPreset(PRESETS[nextIdx]!.id);
    return;
  }
}
