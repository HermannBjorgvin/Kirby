import { describe, expect, it } from 'vitest';
import type { SettingsFieldView } from '../../host/contract.js';
import {
  CUSTOM,
  isDefaultedPreset,
  selectedPreset,
} from './settings-select.js';

function view(over: Partial<SettingsFieldView> = {}): SettingsFieldView {
  return {
    label: 'Editor',
    key: 'editor',
    value: '',
    group: 'general',
    kind: 'select',
    presets: [
      { name: 'VS Code', value: 'code' },
      { name: 'Vim', value: 'vim' },
    ],
    ...over,
  };
}

describe('selectedPreset', () => {
  it('shows the stored value when it names a preset', () => {
    expect(selectedPreset(view({ value: 'code' }))).toBe('code');
  });

  it('shows the host-supplied default while nothing is stored', () => {
    expect(selectedPreset(view({ defaultValue: 'vim' }))).toBe('vim');
    expect(selectedPreset(view({ defaultValue: 'code' }))).toBe('code');
  });

  it('falls back to the first concrete preset with no default', () => {
    expect(selectedPreset(view())).toBe('code');
  });

  it('falls back to the first concrete preset when the default is unknown', () => {
    expect(selectedPreset(view({ defaultValue: 'ssh' }))).toBe('code');
  });

  it('skips the custom escape hatch when picking the fallback', () => {
    const field = view({
      presets: [
        { name: 'Custom', value: null },
        { name: 'VS Code', value: 'code' },
      ],
    });
    expect(selectedPreset(field)).toBe('code');
  });

  it('reports a hand-typed value as custom', () => {
    expect(selectedPreset(view({ value: 'screen' }))).toBe(CUSTOM);
  });

  it('reports an empty select with nothing to fall back on', () => {
    expect(selectedPreset(view({ presets: [] }))).toBe('');
  });
});

describe('isDefaultedPreset', () => {
  it('marks the host-supplied default while nothing is stored', () => {
    const field = view({ defaultValue: 'vim' });
    expect(isDefaultedPreset(field, 'vim')).toBe(true);
    expect(isDefaultedPreset(field, 'code')).toBe(false);
  });

  it('marks nothing once a value is stored', () => {
    const field = view({ value: 'code', defaultValue: 'vim' });
    expect(isDefaultedPreset(field, 'vim')).toBe(false);
    expect(isDefaultedPreset(field, 'code')).toBe(false);
  });

  // The first preset is a rendering fallback, not a resolved default.
  // Marking it would claim an unset Editor means VS Code, when it
  // actually means the EDITOR/VISUAL fallback.
  it('marks nothing for a field the host named no default for', () => {
    const field = view({
      key: 'editor',
      presets: [
        { name: 'VS Code', value: 'code' },
        { name: 'Custom', value: null },
      ],
    });
    expect(isDefaultedPreset(field, 'code')).toBe(false);
    expect(isDefaultedPreset(field, null)).toBe(false);
  });

  it('marks nothing when the default names no preset', () => {
    expect(isDefaultedPreset(view({ defaultValue: 'ssh' }), 'code')).toBe(
      false
    );
  });
});
