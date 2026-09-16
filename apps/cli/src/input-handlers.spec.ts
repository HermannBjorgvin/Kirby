import { describe, it, expect, vi } from 'vitest';
import type { KeyPress } from '@kirby/core';
import type { AppConfig } from '@kirby/vcs-core';

import { handleSettingsInput } from './input-handlers.js';
import { buildSettingsFields } from '@kirby/core';

const fieldIndexOf = (key: string) =>
  buildSettingsFields(null).findIndex((f) => f.key === key);

const DEFAULT_FIELD_INDEX = fieldIndexOf('diffFileListTree');

type Ctx = Parameters<typeof handleSettingsInput>[2];

interface Harness {
  ctx: Ctx;
  updateField: ReturnType<typeof vi.fn>;
  flashStatus: ReturnType<typeof vi.fn>;
  setPreset: ReturnType<typeof vi.fn>;
}

/** Minimal ctx: only the slices the settings-write paths touch. */
function harness(
  action: string,
  config: Partial<AppConfig> = {},
  fieldIndex: number = DEFAULT_FIELD_INDEX
): Harness {
  const updateField = vi.fn();
  const flashStatus = vi.fn();
  const setPreset = vi.fn();
  const ctx = {
    settings: {
      editingField: null,
      editBuffer: '',
      settingsFieldIndex: fieldIndex,
      setSettingsOpen: vi.fn(),
      setSettingsFieldIndex: vi.fn(),
      setEditingField: vi.fn(),
      setEditBuffer: vi.fn(),
      setControlsOpen: vi.fn(),
      setControlsSelectedIndex: vi.fn(),
    },
    config: {
      config: { vendorAuth: {}, vendorProject: {}, ...config } as AppConfig,
      provider: null,
      providers: [],
      updateField,
      reloadFromDisk: vi.fn(),
    },
    sessions: { flashStatus },
    keybinds: { resolve: () => action, setPreset },
  } as unknown as Ctx;
  return { ctx, updateField, flashStatus, setPreset };
}

const NO_KEY = {} as KeyPress;

// All input paths that write a preset-backed field.
const WRITE_ACTIONS = [
  'settings.cycle-right',
  'settings.cycle-left',
  'settings.edit-toggle',
] as const;

describe('settings preset navigation', () => {
  it.each(WRITE_ACTIONS)('%s updates the selected setting', (action) => {
    const h = harness(action);
    handleSettingsInput('', NO_KEY, h.ctx);
    expect(h.updateField).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'diffFileListTree' }),
      'false'
    );
    expect(h.flashStatus).not.toHaveBeenCalled();
  });

  it('routes the keybinding preset through its own context', () => {
    const h = harness(
      'settings.cycle-right',
      {},
      fieldIndexOf('keybindPreset')
    );
    handleSettingsInput('', NO_KEY, h.ctx);
    expect(h.setPreset).toHaveBeenCalledWith('vim');
    expect(h.updateField).not.toHaveBeenCalled();
  });
});
