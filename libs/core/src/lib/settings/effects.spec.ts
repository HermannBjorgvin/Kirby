import { describe, expect, it } from 'vitest';
import type { SettingsField } from './fields.js';
import { hasSettingsEffect, settingsEffects } from './effects.js';

/**
 * The table both shells read after a settings write.
 *
 * The case that motivated it: a user pastes a replacement access
 * token, and nothing happens. The sidebar goes on showing the failure
 * the old token caused, because the cached answer is still there and
 * the next real attempt is a poll interval away.
 */

function field(over: Partial<SettingsField>): SettingsField {
  return { label: 'F', key: 'k', configBag: 'global', ...over };
}

describe('settingsEffects', () => {
  it('refreshes, resets the cache and restarts the loop for a credential', () => {
    const effects = settingsEffects(
      field({ key: 'pat', configBag: 'vendorAuth' })
    );
    expect(effects).toEqual([
      'reset-provider-cache',
      'refresh-remote',
      'restart-sync-loop',
    ]);
  });

  it('drops the cache before it refetches', () => {
    // Order is load-bearing: refetching first would be answered by the
    // very entries the old credentials filled.
    const effects = settingsEffects(
      field({ key: 'pat', configBag: 'vendorAuth' })
    );
    expect(effects.indexOf('reset-provider-cache')).toBeLessThan(
      effects.indexOf('refresh-remote')
    );
  });

  it('treats a project coordinate the same as a credential', () => {
    // Pointing at another organization makes every cached answer about
    // the wrong repository, which is worse than making it stale.
    expect(
      settingsEffects(field({ key: 'org', configBag: 'vendorProject' }))
    ).toContain('reset-provider-cache');
  });

  it('rebuilds the session backend, and nothing else, for the backend switch', () => {
    expect(settingsEffects(field({ key: 'terminalBackend' }))).toEqual([
      'apply-session-backend',
    ]);
  });

  it('restarts the loop when its cadence changes', () => {
    expect(settingsEffects(field({ key: 'mergePollInterval' }))).toEqual([
      'restart-sync-loop',
    ]);
  });

  it('does nothing for a field with no side effect', () => {
    // An editor or an email must not cost a provider round trip.
    expect(settingsEffects(field({ key: 'editor' }))).toEqual([]);
    expect(
      settingsEffects(field({ key: 'email', configBag: 'project' }))
    ).toEqual([]);
    expect(settingsEffects(field({ key: 'autoHideSidebar' }))).toEqual([]);
  });

  it('answers a single-effect question directly', () => {
    expect(
      hasSettingsEffect(
        field({ key: 'pat', configBag: 'vendorAuth' }),
        'refresh-remote'
      )
    ).toBe(true);
    expect(hasSettingsEffect(field({ key: 'editor' }), 'refresh-remote')).toBe(
      false
    );
  });
});
