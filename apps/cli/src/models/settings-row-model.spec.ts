import { describe, it, expect } from 'vitest';
import type { SettingsField } from '@n10/core';
import { displayValueFor } from './settings-row-model.js';

const CHOICE: SettingsField = {
  label: 'Editor',
  key: 'editor',
  configBag: 'global',
  presets: [
    { name: 'VS Code', value: 'code' },
    { name: 'Vim', value: 'vim' },
  ],
  defaultValue: 'vim',
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
    expect(displayValueFor(CHOICE, 'code')).toBe('VS Code');
    expect(displayValueFor(CHOICE, 'vim')).toBe('Vim');
  });

  it('names the resolved default when nothing is stored', () => {
    expect(displayValueFor(CHOICE, '')).toBe('Vim (default)');
    expect(displayValueFor({ ...CHOICE, defaultValue: 'code' }, '')).toBe(
      'VS Code (default)'
    );
  });

  it('falls back to the first preset for a field with no default', () => {
    expect(displayValueFor(EDITOR, '')).toBe('VS Code (default)');
  });

  // A defaultValue that matches no preset must not blank the row.
  it('falls back to the first preset when the default is unknown', () => {
    expect(displayValueFor({ ...CHOICE, defaultValue: 'ssh' }, '')).toBe(
      'VS Code (default)'
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
