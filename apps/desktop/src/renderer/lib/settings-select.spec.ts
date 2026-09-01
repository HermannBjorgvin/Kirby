import { describe, expect, it } from 'vitest';
import type { SettingsFieldView } from '../../host/contract.js';
import {
  CUSTOM,
  isDefaultedPreset,
  selectedPreset,
} from './settings-select.js';

function view(over: Partial<SettingsFieldView> = {}): SettingsFieldView {
  return {
    label: 'Terminal Backend',
    key: 'terminalBackend',
    value: '',
    group: 'terminal',
    kind: 'select',
    presets: [
      { name: 'PTY', value: 'pty' },
      { name: 'Tmux', value: 'tmux' },
    ],
    ...over,
  };
}

describe('selectedPreset', () => {
  it('shows the stored value when it names a preset', () => {
    expect(selectedPreset(view({ value: 'pty' }))).toBe('pty');
  });

  // The terminal backend's reason for existing: nothing is stored, and
  // the host has said this machine will run tmux.
  it('shows the host-supplied default while nothing is stored', () => {
    expect(selectedPreset(view({ defaultValue: 'tmux' }))).toBe('tmux');
    expect(selectedPreset(view({ defaultValue: 'pty' }))).toBe('pty');
  });

  it('falls back to the first concrete preset with no default', () => {
    expect(selectedPreset(view())).toBe('pty');
  });

  it('falls back to the first concrete preset when the default is unknown', () => {
    expect(selectedPreset(view({ defaultValue: 'ssh' }))).toBe('pty');
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
  // The terminal backend: nothing stored, and the host resolved tmux
  // from the probe. That is the row that has to say so.
  it('marks the host-supplied default while nothing is stored', () => {
    const field = view({ defaultValue: 'tmux' });
    expect(isDefaultedPreset(field, 'tmux')).toBe(true);
    expect(isDefaultedPreset(field, 'pty')).toBe(false);
  });

  it('marks nothing once a value is stored', () => {
    const field = view({ value: 'pty', defaultValue: 'tmux' });
    expect(isDefaultedPreset(field, 'tmux')).toBe(false);
    expect(isDefaultedPreset(field, 'pty')).toBe(false);
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
    expect(isDefaultedPreset(view({ defaultValue: 'ssh' }), 'pty')).toBe(false);
  });
});
