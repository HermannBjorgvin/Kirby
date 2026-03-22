import type { Key } from 'ink';
import { readConfig, autoDetectProjectConfig } from '@kirby/vcs-core';
import { handleTextInput } from './utils/handle-text-input.js';
import {
  buildSettingsFields,
  resolveValue,
} from './components/SettingsPanel.js';
import type { AppStateContextValue } from './context/AppStateContext.js';
import type { SessionActionsContextValue } from './context/SessionContext.js';
import type { ConfigContextValue } from './context/ConfigContext.js';

// ── Shared context slice types ────────────────────────────────────

export type NavValue = AppStateContextValue['nav'];
export type AsyncOpsValue = AppStateContextValue['asyncOps'];
export type SettingsValue = AppStateContextValue['settings'];
export type TerminalLayout = AppStateContextValue['terminal'];

// ── Settings input handler ────────────────────────────────────────

export interface SettingsHandlerCtx {
  settings: SettingsValue;
  config: ConfigContextValue;
  sessions: SessionActionsContextValue;
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

  if (key.escape) {
    ctx.settings.setSettingsOpen(false);
    return;
  }
  if (input === 'j' || key.downArrow) {
    ctx.settings.setSettingsFieldIndex((i) =>
      Math.min(i + 1, fields.length - 1)
    );
    return;
  }
  if (input === 'k' || key.upArrow) {
    ctx.settings.setSettingsFieldIndex((i) => Math.max(i - 1, 0));
    return;
  }
  if (key.leftArrow || key.rightArrow) {
    const field = fields[ctx.settings.settingsFieldIndex]!;
    if (field.presets) {
      const namedPresets = field.presets.filter((p) => p.value !== null);
      const currentValue = resolveValue(ctx.config.config, field) || undefined;
      const effectiveValue = currentValue || namedPresets[0]!.value;
      let idx = namedPresets.findIndex((p) => p.value === effectiveValue);
      if (idx === -1) idx = 0;
      if (key.rightArrow) {
        idx = (idx + 1) % namedPresets.length;
      } else {
        idx = (idx - 1 + namedPresets.length) % namedPresets.length;
      }
      const preset = namedPresets[idx]!;
      ctx.config.updateField(field, preset.value ?? undefined);
    }
    return;
  }
  if (key.return) {
    const field = fields[ctx.settings.settingsFieldIndex]!;
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
  if (input === 'a') {
    const { updated, detected } = autoDetectProjectConfig(
      process.cwd(),
      ctx.config.providers
    );
    if (updated) {
      ctx.config.setConfig(readConfig());
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
