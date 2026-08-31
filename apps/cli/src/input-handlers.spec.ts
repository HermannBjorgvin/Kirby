import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KeyPress } from '@kirby/core';
import type { AppConfig } from '@kirby/vcs-core';
import type { TmuxStatus } from '@kirby/terminal-tmux';

// The guard under test (`canApplyFieldChange`) is module-private, so we
// drive it through the public `handleSettingsInput`. That's the more
// useful shape anyway: it proves the guard is actually wired into BOTH
// write paths (cycle-left/right and edit-toggle), which a direct unit
// test of the predicate would miss.
const {
  hasAnySessionMock,
  getTmuxAvailabilityMock,
  applyBackendMock,
  isTmuxAvailableMock,
} = vi.hoisted(() => ({
  hasAnySessionMock: vi.fn<() => boolean>(),
  getTmuxAvailabilityMock: vi.fn<() => TmuxStatus | null>(),
  applyBackendMock: vi.fn<(config: AppConfig) => void>(),
  isTmuxAvailableMock: vi.fn<() => Promise<TmuxStatus>>(),
}));

// The field catalog derives the backend default from core's own probe
// cache, which the barrel mock below cannot reach — `buildSettingsFields`
// calls it through a module-internal import. Faking the probe at its
// source is what lets a test say "this machine has tmux".
vi.mock('@kirby/terminal-tmux', () => ({
  createTmuxBackendFactory: () => ({}),
  isTmuxAvailable: () => isTmuxAvailableMock(),
  sanitizeTmuxSessionName: (n: string) => n,
  tmuxHasSession: () => false,
  tmuxKillSession: () => undefined,
}));

// `updateConfigField` is deliberately left real: the assertions below
// check the config handed to applySessionBackend actually carries the
// newly selected backend, which a stubbed updater would hide.
vi.mock('@kirby/core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  hasAnySession: () => hasAnySessionMock(),
  getTmuxAvailability: () => getTmuxAvailabilityMock(),
  applySessionBackend: (config: AppConfig) => applyBackendMock(config),
}));

import { handleSettingsInput } from './input-handlers.js';
import { buildSettingsFields, probeTmuxAvailability } from '@kirby/core';

const fieldIndexOf = (key: string) =>
  buildSettingsFields(null).findIndex((f) => f.key === key);

const BACKEND_FIELD_INDEX = fieldIndexOf('terminalBackend');

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
  fieldIndex: number = BACKEND_FIELD_INDEX
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

// Both paths that can write a preset-backed field. If a future refactor
// adds a third, it needs its own guard call — and this table is where
// the omission should become obvious.
const WRITE_ACTIONS = [
  'settings.cycle-right',
  'settings.cycle-left',
  'settings.edit-toggle',
] as const;

beforeEach(() => {
  hasAnySessionMock.mockReset();
  getTmuxAvailabilityMock.mockReset();
  applyBackendMock.mockReset();
  isTmuxAvailableMock.mockReset();
  hasAnySessionMock.mockReturnValue(false);
  getTmuxAvailabilityMock.mockReturnValue({ available: true, version: '3.4' });
});

/** Re-run core's probe with a fixed answer, so `buildSettingsFields`
 *  reports the backend default this machine would resolve to. */
async function setProbedTmux(available: boolean): Promise<void> {
  isTmuxAvailableMock.mockResolvedValueOnce(
    available
      ? { available: true, version: '3.4' }
      : { available: false, reason: 'tmux binary not found on PATH' }
  );
  await probeTmuxAvailability();
}

describe('settings guard — terminalBackend', () => {
  it('finds the Terminal Backend field (guards the index the tests rely on)', () => {
    expect(BACKEND_FIELD_INDEX).toBeGreaterThanOrEqual(0);
  });

  describe.each(WRITE_ACTIONS)('via %s', (action) => {
    it('applies the change when no sessions are active and tmux is available', () => {
      const h = harness(action);
      handleSettingsInput('', NO_KEY, h.ctx);
      expect(h.updateField).toHaveBeenCalledTimes(1);
      expect(h.flashStatus).not.toHaveBeenCalled();
    });

    // The registry's factory has to follow the setting on the same
    // keystroke that wrote it — and it has to be rebuilt from the NEW
    // selection, not the config still in state.
    it('rebuilds the backend factory from the newly written value', () => {
      const h = harness(action, { terminalBackend: 'pty' });

      handleSettingsInput('', NO_KEY, h.ctx);

      expect(applyBackendMock).toHaveBeenCalledTimes(1);
      expect(applyBackendMock).toHaveBeenCalledWith(
        expect.objectContaining({ terminalBackend: 'tmux' })
      );
    });

    // Switching mid-session would strand the live sessions on a stale
    // factory — they'd keep running on the old backend while every new
    // spawn used the new one.
    it('blocks the change while a session is active, and says why', () => {
      hasAnySessionMock.mockReturnValue(true);
      const h = harness(action);

      handleSettingsInput('', NO_KEY, h.ctx);

      expect(h.updateField).not.toHaveBeenCalled();
      expect(h.flashStatus).toHaveBeenCalledWith(
        expect.stringMatching(/close all sessions/i)
      );
      // The whole point of the gate: the live session must keep the
      // factory it was spawned with.
      expect(applyBackendMock).not.toHaveBeenCalled();
    });

    // Surfacing the install hint here beats letting the spawn fail with
    // a bare ENOENT later.
    it('blocks a switch to tmux when tmux is unavailable, surfacing the hint', () => {
      getTmuxAvailabilityMock.mockReturnValue({
        available: false,
        reason: 'tmux binary not found on PATH',
        installHint: 'brew install tmux',
      });
      // Current value 'pty' → cycling lands on 'tmux'.
      const h = harness(action, { terminalBackend: 'pty' });

      handleSettingsInput('', NO_KEY, h.ctx);

      expect(h.updateField).not.toHaveBeenCalled();
      expect(h.flashStatus).toHaveBeenCalledWith(
        expect.stringContaining('brew install tmux')
      );
      expect(applyBackendMock).not.toHaveBeenCalled();
    });

    // The probe not having resolved yet must not be read as "missing".
    it('allows the switch when the probe has not resolved yet', () => {
      getTmuxAvailabilityMock.mockReturnValue(null);
      const h = harness(action, { terminalBackend: 'pty' });

      handleSettingsInput('', NO_KEY, h.ctx);

      expect(h.updateField).toHaveBeenCalledTimes(1);
      expect(h.flashStatus).not.toHaveBeenCalled();
    });

    // Leaving tmux must never be blocked by tmux being missing — that
    // would trap a user whose tmux disappeared on the broken backend.
    it('allows switching away from tmux even when tmux is unavailable', () => {
      getTmuxAvailabilityMock.mockReturnValue({
        available: false,
        reason: 'tmux binary not found on PATH',
        installHint: 'brew install tmux',
      });
      // Current value 'tmux' → cycling lands on 'pty'.
      const h = harness(action, { terminalBackend: 'tmux' });

      handleSettingsInput('', NO_KEY, h.ctx);

      expect(h.updateField).toHaveBeenCalledTimes(1);
      expect(h.flashStatus).not.toHaveBeenCalled();
      expect(applyBackendMock).toHaveBeenCalledWith(
        expect.objectContaining({ terminalBackend: 'pty' })
      );
    });
  });

  // With nothing stored, the panel already displays the resolved
  // default, so the cursor has to start there: stepping off tmux must
  // land on pty. Starting from the first preset instead would make the
  // first keypress write the value already in force and look inert.
  it('steps off the resolved default rather than re-selecting it', async () => {
    await setProbedTmux(true);
    const h = harness('settings.cycle-right');

    handleSettingsInput('', NO_KEY, h.ctx);

    expect(applyBackendMock).toHaveBeenCalledWith(
      expect.objectContaining({ terminalBackend: 'pty' })
    );
  });

  it('steps off pty when tmux is not installed', async () => {
    await setProbedTmux(false);
    const h = harness('settings.cycle-right');

    handleSettingsInput('', NO_KEY, h.ctx);

    expect(applyBackendMock).toHaveBeenCalledWith(
      expect.objectContaining({ terminalBackend: 'tmux' })
    );
  });

  // The gate is scoped to terminalBackend only — an active session must
  // not freeze the rest of Settings.
  it('does not gate unrelated fields while a session is active', () => {
    hasAnySessionMock.mockReturnValue(true);
    const fields = buildSettingsFields(null);
    const otherIndex = fields.findIndex(
      (f) => f.key !== 'terminalBackend' && f.presets && !f.action
    );
    expect(otherIndex).toBeGreaterThanOrEqual(0);

    const h = harness('settings.cycle-right', {}, otherIndex);
    handleSettingsInput('', NO_KEY, h.ctx);

    // Either written through updateField or, for keybindPreset, routed to
    // setPreset — the point is that it is not blocked.
    expect(
      h.updateField.mock.calls.length + h.setPreset.mock.calls.length
    ).toBe(1);
    expect(h.flashStatus).not.toHaveBeenCalled();
  });

  // Rebuilding the factory is scoped to the backend setting. Any other
  // settings write leaving the registry alone is what makes it safe to
  // do this on the write path at all.
  it('does not rebuild the backend factory when another field is written', () => {
    const otherIndex = fieldIndexOf('diffFileListTree');
    expect(otherIndex).toBeGreaterThanOrEqual(0);

    const h = harness('settings.cycle-right', {}, otherIndex);
    handleSettingsInput('', NO_KEY, h.ctx);

    expect(h.updateField).toHaveBeenCalledTimes(1);
    expect(applyBackendMock).not.toHaveBeenCalled();
  });
});
