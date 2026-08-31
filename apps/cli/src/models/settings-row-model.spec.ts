import { describe, it, expect } from 'vitest';
import type { SettingsField } from '@kirby/core';
import { displayValueFor } from './settings-row-model.js';

const BACKEND: SettingsField = {
  label: 'Terminal Backend',
  key: 'terminalBackend',
  configBag: 'global',
  presets: [
    { name: 'PTY', value: 'pty' },
    { name: 'Tmux', value: 'tmux' },
  ],
  defaultValue: 'tmux',
};

const EDITOR: SettingsField = {
  label: 'Editor',
  key: 'editor',
  configBag: 'global',
  presets: [
    { name: 'VS Code', value: 'code' },
    { name: 'Custom', value: null },
  ],
};

describe('displayValueFor', () => {
  it('names the stored preset without a default marker', () => {
    expect(displayValueFor(BACKEND, 'pty')).toBe('PTY');
    expect(displayValueFor(BACKEND, 'tmux')).toBe('Tmux');
  });

  // The whole point of the row: an unset backend shows what will
  // actually run, and says it was decided for the user.
  it('names the resolved default when nothing is stored', () => {
    expect(displayValueFor(BACKEND, '')).toBe('Tmux (default)');
    expect(displayValueFor({ ...BACKEND, defaultValue: 'pty' }, '')).toBe(
      'PTY (default)'
    );
  });

  it('falls back to the first preset for a field with no default', () => {
    expect(displayValueFor(EDITOR, '')).toBe('VS Code (default)');
  });

  // A defaultValue that matches no preset must not blank the row.
  it('falls back to the first preset when the default is unknown', () => {
    expect(displayValueFor({ ...BACKEND, defaultValue: 'ssh' }, '')).toBe(
      'PTY (default)'
    );
  });

  it('marks a hand-typed value as custom', () => {
    expect(displayValueFor(EDITOR, 'nvim')).toBe('Custom: nvim');
  });

  it('stars a masked value and reports an empty free-text field', () => {
    const pat: SettingsField = {
      label: 'PAT',
      key: 'pat',
      configBag: 'vendorAuth',
      masked: true,
    };
    expect(displayValueFor(pat, 'secret')).toBe('******');
    expect(displayValueFor(pat, '')).toBe('(not set)');
  });
});
