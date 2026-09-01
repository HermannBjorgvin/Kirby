import type { SettingsField } from './fields.js';

/**
 * What has to happen after a settings field is written.
 *
 * Saving a corrected access token used to change nothing visible. The
 * sidebar kept the failure it was already showing, and the next real
 * attempt was a poll interval away — up to an hour with the default
 * sync interval — so the fix looked like it had not worked and the
 * obvious next move was to paste the token again.
 *
 * The decision lives here rather than in either shell because both
 * shells write the same fields through the same catalog, and a rule
 * that exists in one of them is a rule the other quietly lacks. The
 * shells own only the doing: the desktop restarts a host loop, the TUI
 * calls its hooks.
 */
export type SettingsEffect =
  /** Rebuild the session backend factory. */
  | 'apply-session-backend'
  /** Restart the merged-branch / conflict sync loop. */
  | 'restart-sync-loop'
  /** Drop everything the provider cached under the old credentials. */
  | 'reset-provider-cache'
  /** Fetch pull request data now rather than at the next tick. */
  | 'refresh-remote';

/**
 * A credential or project change invalidates every cached answer and
 * every conclusion drawn from one, so it triggers the lot: the cache
 * was filled as somebody else, the sidebar is showing a failure that
 * may no longer apply, and the sync loop's next pass should use the
 * new credentials rather than wait out the old cadence.
 */
const CREDENTIAL_EFFECTS: SettingsEffect[] = [
  'reset-provider-cache',
  'refresh-remote',
  'restart-sync-loop',
];

const BY_KEY: Record<string, SettingsEffect[]> = {
  // The one field whose write must rebuild the PTY backend factory —
  // and only ever at the moment the guards have established there is
  // no live session.
  terminalBackend: ['apply-session-backend'],
  // Both cadences: a new interval should take effect now, not after
  // the timer the old one armed finally fires.
  mergePollInterval: ['restart-sync-loop'],
  prPollInterval: ['refresh-remote'],
  // Selecting a different provider entirely.
  vendor: CREDENTIAL_EFFECTS,
};

export function settingsEffects(field: SettingsField): SettingsEffect[] {
  if (field.configBag === 'vendorAuth' || field.configBag === 'vendorProject') {
    return CREDENTIAL_EFFECTS;
  }
  return BY_KEY[field.key] ?? [];
}

/** Convenience for a caller that only cares about one effect. */
export function hasSettingsEffect(
  field: SettingsField,
  effect: SettingsEffect
): boolean {
  return settingsEffects(field).includes(effect);
}
