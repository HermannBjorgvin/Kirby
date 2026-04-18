import type { Key } from 'ink';
import { autoDetectProjectConfig } from '@kirby/vcs-core';
import { handleTextInput } from './utils/handle-text-input.js';
import {
  buildSettingsFields,
  resolveValue,
} from './components/SettingsPanel.js';
import type { AppStateContextValue } from './context/AppStateContext.js';
import type { SessionActionsContextValue } from './context/SessionContext.js';
import type { ConfigContextValue } from './context/ConfigContext.js';
import type { TerminalLayout } from './context/LayoutContext.js';
import type { KeybindContextValue } from './context/KeybindContext.js';
import {
  PRESETS,
  ACTIONS,
  findConflict,
  descriptorFromKeypress,
} from './keybindings/index.js';
import {
  buildControlsRows,
  getBindingRows,
} from './keybindings/controls-data.js';

// ── Shared context slice types ────────────────────────────────────

export type NavValue = AppStateContextValue['nav'];
export type AsyncOpsValue = AppStateContextValue['asyncOps'];
export type SettingsValue = AppStateContextValue['settings'];
export type { TerminalLayout };

// ── Settings input handler ────────────────────────────────────────

export interface SettingsHandlerCtx {
  settings: SettingsValue;
  config: ConfigContextValue;
  sessions: SessionActionsContextValue;
  keybinds: KeybindContextValue;
}

export function handleSettingsInput(
  input: string,
  key: Key,
  ctx: SettingsHandlerCtx
): void {
  const fields = buildSettingsFields(ctx.config.provider);

  if (ctx.settings.editingField) {
    if (key.escape) {
      ctx.settings.setEditingField(null);
      ctx.settings.setEditBuffer('');
      return;
    }
    if (key.return) {
      const field = fields[ctx.settings.settingsFieldIndex]!;
      const value = ctx.settings.editBuffer || undefined;
      ctx.config.updateField(field, value);
      ctx.settings.setEditingField(null);
      ctx.settings.setEditBuffer('');
      return;
    }
    handleTextInput(input, key, ctx.settings.setEditBuffer);
    return;
  }

  const action = ctx.keybinds.resolve(input, key, 'settings');

  if (action === 'settings.close') {
    ctx.settings.setSettingsOpen(false);
    return;
  }
  if (action === 'settings.navigate-down') {
    ctx.settings.setSettingsFieldIndex((i) =>
      Math.min(i + 1, fields.length - 1)
    );
    return;
  }
  if (action === 'settings.navigate-up') {
    ctx.settings.setSettingsFieldIndex((i) => Math.max(i - 1, 0));
    return;
  }
  if (action === 'settings.cycle-left' || action === 'settings.cycle-right') {
    const field = fields[ctx.settings.settingsFieldIndex]!;
    if (field.presets) {
      const namedPresets = field.presets.filter((p) => p.value !== null);
      const currentValue = resolveValue(ctx.config.config, field) || undefined;
      const effectiveValue = currentValue || namedPresets[0]!.value;
      let idx = namedPresets.findIndex((p) => p.value === effectiveValue);
      if (idx === -1) idx = 0;
      if (action === 'settings.cycle-right') {
        idx = (idx + 1) % namedPresets.length;
      } else {
        idx = (idx - 1 + namedPresets.length) % namedPresets.length;
      }
      const preset = namedPresets[idx]!;
      // Use unified write path for keybind preset
      if (field.key === 'keybindPreset' && preset.value) {
        ctx.keybinds.setPreset(preset.value);
      } else {
        ctx.config.updateField(field, preset.value ?? undefined);
      }
    }
    return;
  }
  if (action === 'settings.edit-toggle') {
    const field = fields[ctx.settings.settingsFieldIndex]!;

    // Special action fields — open sub-screens
    if (field.action === 'open-controls') {
      ctx.settings.setControlsOpen(true);
      ctx.settings.setControlsSelectedIndex(0);
      return;
    }

    if (field.presets && field.presets.every((p) => p.value !== null)) {
      const namedPresets = field.presets;
      const currentValue = resolveValue(ctx.config.config, field) || undefined;
      const effectiveValue = currentValue || namedPresets[0]!.value;
      let idx = namedPresets.findIndex((p) => p.value === effectiveValue);
      idx = (idx + 1) % namedPresets.length;
      ctx.config.updateField(field, namedPresets[idx]!.value ?? undefined);
      return;
    }
    ctx.settings.setEditingField(field.key);
    ctx.settings.setEditBuffer(resolveValue(ctx.config.config, field));
    return;
  }
  if (action === 'settings.auto-detect') {
    const { updated, detected } = autoDetectProjectConfig(
      process.cwd(),
      ctx.config.providers
    );
    if (updated) {
      ctx.config.reloadFromDisk();
      const fields = Object.keys(detected).join(', ');
      ctx.sessions.flashStatus(`Auto-detected: ${fields}`);
    } else {
      ctx.sessions.flashStatus(
        'Nothing new to detect (all fields already set)'
      );
    }
    return;
  }
}

// ── Controls sub-screen input handler ─────────────────────────────

export interface ControlsHandlerCtx {
  settings: SettingsValue;
  keybinds: KeybindContextValue;
}

export function handleControlsInput(
  input: string,
  key: Key,
  ctx: ControlsHandlerCtx
): void {
  const rows = buildControlsRows(ctx.keybinds.bindings, ctx.keybinds.isCustom);
  const bindingRows = getBindingRows(rows);
  const totalBindings = bindingRows.length;

  // ── Rebind mode: capture any keypress ──
  if (ctx.settings.controlsRebindActionId) {
    const actionId = ctx.settings.controlsRebindActionId;

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
