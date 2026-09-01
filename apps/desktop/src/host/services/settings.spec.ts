import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsField } from '@kirby/core';
import { SECRET_PLACEHOLDER } from '../contract.js';

/**
 * The settings write path is the desktop's only "the renderer asks the
 * host to change persistent state" surface, and three of its rules are
 * load-bearing:
 *
 *   • the client names a field, it does not name a config bag — a
 *     lookup miss must refuse rather than write somewhere;
 *   • swapping the terminal backend under live sessions strands them on
 *     a stale factory, so it is refused (the TUI refuses it too);
 *   • a secret the renderer never saw must survive being "saved".
 */

const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  fields: [] as SettingsField[],
  hasSession: false,
  tmux: null as { available: boolean; installHint?: string } | null,
  /** What this project's own config pins the backend to, if anything. */
  projectBackend: undefined as 'pty' | 'tmux' | undefined,
  persisted: [] as { key: string; value: string | undefined }[],
  backendApplied: 0,
  syncRestarts: 0,
  resolved: {} as Record<string, string>,
}));

vi.mock('./repo.js', () => ({
  requireRepo: () => '/repo',
  PROVIDERS: [{ id: 'azure-devops' }],
}));

vi.mock('./remote-sync.js', () => ({
  startRemoteSyncLoop: () => {
    state.syncRestarts += 1;
  },
}));

vi.mock('@kirby/vcs-core', () => ({
  readConfig: () => state.config,
}));

vi.mock('@kirby/core', () => ({
  buildSettingsFields: () => state.fields,
  hasAnySession: () => state.hasSession,
  getTmuxAvailability: () => state.tmux,
  projectTerminalBackendOverride: () => state.projectBackend,
  resolveValue: (_config: unknown, field: SettingsField) =>
    state.resolved[field.key] ?? '',
  applySessionBackend: () => {
    state.backendApplied += 1;
  },
}));

// updateConfigField/persistConfigField are pure, but they live in
// ConfigContext.tsx and so ship from @kirby/app-core.
vi.mock('@kirby/app-core', () => ({
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

const backendField = field({
  label: 'Terminal backend',
  key: 'terminalBackend',
  presets: [
    { name: 'PTY', value: 'pty' },
    { name: 'Tmux', value: 'tmux' },
  ],
});

beforeEach(() => {
  state.config = { vendor: 'azure-devops' };
  state.fields = [field(), backendField];
  state.hasSession = false;
  state.tmux = { available: true };
  state.projectBackend = undefined;
  state.persisted = [];
  state.backendApplied = 0;
  state.syncRestarts = 0;
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
      updateSettingsFromView({ label: 'Editor', key: 'terminalBackend' }, 'x')
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

  describe('terminal backend guard', () => {
    it('refuses to switch while any session is alive', () => {
      state.hasSession = true;
      expect(() =>
        updateSettingsFromView(
          { label: 'Terminal backend', key: 'terminalBackend' },
          'tmux'
        )
      ).toThrow('Close all sessions');
      // Nothing persisted and no factory swapped: a live session must
      // not be left pointing at a backend that no longer runs it.
      expect(state.persisted).toEqual([]);
      expect(state.backendApplied).toBe(0);
    });

    it('refuses tmux when tmux is not installed, with the install hint', () => {
      state.tmux = { available: false, installHint: 'apt install tmux' };
      expect(() =>
        updateSettingsFromView(
          { label: 'Terminal backend', key: 'terminalBackend' },
          'tmux'
        )
      ).toThrow('tmux not installed — try `apt install tmux`');
      expect(state.persisted).toEqual([]);
    });

    it('allows tmux when the probe has not answered yet', () => {
      // An unfinished probe is "unknown", not "unavailable" — the TUI
      // treats it the same way rather than blocking on startup timing.
      state.tmux = null;
      updateSettingsFromView(
        { label: 'Terminal backend', key: 'terminalBackend' },
        'tmux'
      );
      expect(state.persisted).toEqual([
        { key: 'terminalBackend', value: 'tmux' },
      ]);
    });

    it('still allows switching back to pty when tmux is missing', () => {
      state.tmux = { available: false };
      updateSettingsFromView(
        { label: 'Terminal backend', key: 'terminalBackend' },
        'pty'
      );
      expect(state.persisted).toEqual([
        { key: 'terminalBackend', value: 'pty' },
      ]);
    });

    it('rebinds the session factory after a successful switch', () => {
      updateSettingsFromView(
        { label: 'Terminal backend', key: 'terminalBackend' },
        'tmux'
      );
      expect(state.backendApplied).toBe(1);
    });

    it('leaves the factory alone for unrelated fields', () => {
      updateSettingsFromView({ label: 'Editor', key: 'editor' }, 'vim');
      expect(state.backendApplied).toBe(0);
    });
  });

  it('restarts the sync loop when its interval changes', () => {
    state.fields = [field({ label: 'Merge poll', key: 'mergePollInterval' })];
    updateSettingsFromView(
      { label: 'Merge poll', key: 'mergePollInterval' },
      '60'
    );
    // Otherwise a new cadence only takes effect after the old timer fires.
    expect(state.syncRestarts).toBe(1);
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

  // The page renders the default marker off this, and picks which
  // preset to show while nothing is stored. Dropping it would show the
  // first preset — PTY — on a machine that is actually running tmux.
  it('passes the resolved default through, leaving the value empty', () => {
    state.fields = [field({ ...backendField, defaultValue: 'tmux' })];
    const view = getSettingsView();
    expect(view[0].defaultValue).toBe('tmux');
    expect(view[0].value).toBe('');
  });

  it('carries no default for a field that has none', () => {
    expect(getSettingsView()[0].defaultValue).toBeUndefined();
  });

  it('grays out the backend switch while a session is alive', () => {
    state.hasSession = true;
    const view = getSettingsView();
    const backend = view.find((f) => f.key === 'terminalBackend');
    // Surfacing the same gate the write path enforces, so the control
    // is disabled rather than erroring after the click.
    expect(backend?.disabled).toMatch(/close all sessions/i);
    expect(view.find((f) => f.key === 'editor')?.disabled).toBeUndefined();
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

// readConfig gives the per-project value precedence, but this row
// writes the global key — so an edit here would appear to save and then
// revert on the next read, while this run used the value the user
// picked and the next used the project's.
describe('per-project backend override', () => {
  beforeEach(() => {
    state.fields = [backendField];
    state.projectBackend = 'pty';
  });

  it('grays the control out and names the reason', () => {
    expect(getSettingsView()[0].disabled).toMatch(/pins the terminal backend/i);
  });

  it('refuses the write rather than saving somewhere that loses it', () => {
    expect(() =>
      updateSettingsFromView(
        { label: 'Terminal backend', key: 'terminalBackend' },
        'tmux'
      )
    ).toThrow(/pins terminalBackend/i);
    expect(state.persisted).toEqual([]);
  });
});
