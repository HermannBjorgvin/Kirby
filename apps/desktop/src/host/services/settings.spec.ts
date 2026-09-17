import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsEffect, SettingsField } from '@n10/core';
import { SECRET_PLACEHOLDER } from '../contract.js';

/**
 * The settings write path is the desktop's only "the renderer asks the
 * host to change persistent state" surface, and two of its rules are
 * load-bearing:
 *
 *   • the client names a field, it does not name a config bag — a
 *     lookup miss must refuse rather than write somewhere;
 *   • a secret the renderer never saw must survive being "saved".
 */

const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  fields: [] as SettingsField[],
  persisted: [] as { key: string; value: string | undefined }[],
  syncRestarts: 0,
  cacheResets: 0,
  otherCacheResets: 0,
  remoteRefreshes: 0,
  effects: [] as SettingsEffect[],
  effectsAskedFor: [] as string[],
  resolved: {} as Record<string, string>,
}));

vi.mock('./repo.js', () => ({
  requireRepo: () => '/repo',
  PROVIDERS: [
    {
      id: 'azure-devops',
      resetCaches: () => {
        state.cacheResets += 1;
      },
    },
    // A second provider, and one with nothing to forget: switching
    // vendors has to clear the one being *left*, and must not assume
    // every provider implements the hook.
    {
      id: 'github',
      resetCaches: () => {
        state.otherCacheResets += 1;
      },
    },
    { id: 'nothing-to-forget' },
  ],
}));

vi.mock('./sidebar.js', () => ({
  onCredentialsChanged: () => {
    state.remoteRefreshes += 1;
  },
}));

vi.mock('./remote-sync.js', () => ({
  startRemoteSyncLoop: () => {
    state.syncRestarts += 1;
  },
}));

vi.mock('@n10/vcs-core', () => ({
  readConfig: () => state.config,
}));

vi.mock('@n10/core', () => ({
  buildSettingsFields: () => state.fields,
  resolveValue: (_config: unknown, field: SettingsField) =>
    state.resolved[field.key] ?? '',
  // Which effects a field has is decided in @n10/core and asserted
  // there (settings/effects.spec.ts). What matters here is that the
  // host asks, and then does what it is told.
  settingsEffects: (field: SettingsField) => {
    state.effectsAskedFor.push(field.key);
    return state.effects;
  },
}));

// updateConfigField/persistConfigField are pure, but they live in
// ConfigContext.tsx and so ship from @n10/app-core.
vi.mock('@n10/app-core', () => ({
  updateConfigField: (
    config: Record<string, unknown>,
    field: SettingsField,
    value: string | undefined
  ) => ({ ...config, [field.key]: value }),
  persistConfigField: (field: SettingsField, value: string | undefined) => {
    state.persisted.push({ key: field.key, value });
  },
}));

const { getSettingsView, updateSettingsFromView } = await import(
  './settings.js'
);

function field(over: Partial<SettingsField> = {}): SettingsField {
  return {
    label: 'Editor',
    key: 'editor',
    configBag: 'global',
    ...over,
  } as SettingsField;
}

beforeEach(() => {
  state.config = { vendor: 'azure-devops' };
  state.fields = [field()];
  state.persisted = [];
  state.syncRestarts = 0;
  state.cacheResets = 0;
  state.otherCacheResets = 0;
  state.remoteRefreshes = 0;
  state.effects = [];
  state.effectsAskedFor = [];
  state.resolved = {};
});

describe('updateSettingsFromView', () => {
  it('refuses a field it does not know rather than writing it somewhere', () => {
    expect(() =>
      updateSettingsFromView({ label: 'Made up', key: 'evil' }, 'x')
    ).toThrow('Unknown settings field');
    expect(state.persisted).toEqual([]);
  });

  it('requires the label and key to match the same field', () => {
    // Half-matching a real field must not be enough to reach its bag.
    expect(() =>
      updateSettingsFromView({ label: 'Editor', key: 'agentId' }, 'x')
    ).toThrow('Unknown settings field');
    expect(state.persisted).toEqual([]);
  });

  it('writes a plain field through', () => {
    updateSettingsFromView({ label: 'Editor', key: 'editor' }, 'vim');
    expect(state.persisted).toEqual([{ key: 'editor', value: 'vim' }]);
  });

  it('persists a cleared field as undefined, not an empty string', () => {
    // An empty string would shadow a global value at project level
    // instead of falling back to it.
    updateSettingsFromView({ label: 'Editor', key: 'editor' }, '');
    expect(state.persisted).toEqual([{ key: 'editor', value: undefined }]);
  });

  describe('masked fields', () => {
    beforeEach(() => {
      state.fields = [
        field({ label: 'Personal Access Token', key: 'pat', masked: true }),
      ];
    });

    it('ignores a save that returns the placeholder unchanged', () => {
      updateSettingsFromView(
        { label: 'Personal Access Token', key: 'pat' },
        SECRET_PLACEHOLDER
      );
      // Writing here would replace the real credential with dots.
      expect(state.persisted).toEqual([]);
    });

    it('writes a genuinely edited secret', () => {
      updateSettingsFromView(
        { label: 'Personal Access Token', key: 'pat' },
        'new-token'
      );
      expect(state.persisted).toEqual([{ key: 'pat', value: 'new-token' }]);
    });
  });

  /**
   * A replacement access token used to change nothing the user could
   * see: the sidebar kept the failure the old one caused, and the next
   * real attempt was a poll interval — up to an hour — away. The host
   * asks @n10/core what a write implies and then carries it out; the
   * shared table is what stops the TUI and the desktop drifting.
   */
  describe('effects of a write', () => {
    it('asks about the field it just wrote', () => {
      updateSettingsFromView({ label: 'Editor', key: 'editor' }, 'vim');
      expect(state.effectsAskedFor).toEqual(['editor']);
    });

    it('restarts the sync loop when told to', () => {
      // Otherwise a new cadence only takes effect after the old timer fires.
      state.effects = ['restart-sync-loop'];
      updateSettingsFromView({ label: 'Editor', key: 'editor' }, 'vim');
      expect(state.syncRestarts).toBe(1);
    });

    it('clears every provider, not just the selected one', () => {
      // On a `vendor` change the stale entries belong to the provider
      // being left. Clearing only the incoming one leaves the outgoing
      // provider's cache intact, and switching back inside its TTL
      // serves answers fetched under the old configuration.
      state.effects = ['reset-provider-cache'];
      state.fields = [field({ label: 'Vendor', key: 'vendor' })];
      updateSettingsFromView({ label: 'Vendor', key: 'vendor' }, 'github');
      expect(state.cacheResets).toBe(1);
      expect(state.otherCacheResets).toBe(1);
    });

    it('drops the provider cache and fetches now for a credential change', () => {
      state.effects = [
        'reset-provider-cache',
        'refresh-remote',
        'restart-sync-loop',
      ];
      state.fields = [
        field({
          label: 'Personal Access Token',
          key: 'pat',
          masked: true,
          configBag: 'vendorAuth',
        }),
      ];
      updateSettingsFromView(
        { label: 'Personal Access Token', key: 'pat' },
        'ado_rotated'
      );
      expect(state.cacheResets).toBe(1);
      expect(state.remoteRefreshes).toBe(1);
      expect(state.syncRestarts).toBe(1);
    });

    it('runs nothing at all when the untouched placeholder comes back', () => {
      state.effects = ['reset-provider-cache', 'refresh-remote'];
      state.fields = [
        field({
          label: 'Personal Access Token',
          key: 'pat',
          masked: true,
          configBag: 'vendorAuth',
        }),
      ];
      updateSettingsFromView(
        { label: 'Personal Access Token', key: 'pat' },
        SECRET_PLACEHOLDER
      );
      // Nothing was written, so there is nothing to invalidate — and a
      // refetch here would fire on every visit to the settings page.
      expect(state.effectsAskedFor).toEqual([]);
      expect(state.cacheResets).toBe(0);
      expect(state.remoteRefreshes).toBe(0);
    });
  });
});

describe('getSettingsView', () => {
  it('sends a placeholder for a stored secret and never the secret', () => {
    state.fields = [
      field({ label: 'Personal Access Token', key: 'pat', masked: true }),
    ];
    state.resolved = { pat: 'the-real-token' };

    const view = getSettingsView();
    expect(view[0].value).toBe(SECRET_PLACEHOLDER);
    expect(JSON.stringify(view)).not.toContain('the-real-token');
  });

  it('sends an empty string for a secret that is not set', () => {
    // A placeholder here would look like "something is configured".
    state.fields = [
      field({ label: 'Personal Access Token', key: 'pat', masked: true }),
    ];
    expect(getSettingsView()[0].value).toBe('');
  });

  it('hides fields that only make sense in the terminal UI', () => {
    state.fields = [
      field(),
      field({ label: 'Keybinds', key: 'keybindPreset' }),
    ];
    expect(getSettingsView().map((f) => f.key)).toEqual(['editor']);
  });

  // The page renders the host-supplied default marker.
  it('passes the resolved default through, leaving the value empty', () => {
    state.fields = [field({ defaultValue: 'code' })];
    const view = getSettingsView();
    expect(view[0].defaultValue).toBe('code');
    expect(view[0].value).toBe('');
  });

  it('carries no default for a field that has none', () => {
    expect(getSettingsView()[0].defaultValue).toBeUndefined();
  });

  it('reads a two-value true/false preset as a boolean control', () => {
    state.fields = [
      field({
        label: 'Auto rebase',
        key: 'autoRebase',
        presets: [
          { name: 'On', value: 'true' },
          { name: 'Off', value: 'false' },
        ],
      }),
    ];
    expect(getSettingsView()[0].kind).toBe('boolean');
  });

  it('files provider credentials under the provider group', () => {
    state.fields = [
      field({ label: 'PAT', key: 'pat', configBag: 'vendorAuth' }),
      field({ label: 'Org', key: 'org', configBag: 'vendorProject' }),
      field(),
    ];
    expect(getSettingsView().map((f) => f.group)).toEqual([
      'provider',
      'provider',
      'general',
    ]);
  });
});
