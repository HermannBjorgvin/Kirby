import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import { tab } from './setup/app.js';
import { clickAppMenuItem } from './setup/menu.js';

const PAT = 'ado_e2e_super_secret_value';
const PLACEHOLDER = '••••••••';

function storedPat(homeDir: string): string | undefined {
  const raw = readFileSync(join(homeDir, '.kirby', 'config.json'), 'utf8');
  const parsed = JSON.parse(raw) as {
    vendorAuth?: Record<string, Record<string, string>>;
  };
  return parsed.vendorAuth?.['azure-devops']?.pat;
}

test.describe('Settings', () => {
  test.use({
    kirbyConfig: {
      vendorAuth: { 'azure-devops': { pat: PAT } },
      // Long enough that nothing in these tests can be explained by a
      // poll happening to fire: a refetch inside them is one something
      // asked for.
      prPollInterval: 3_600_000,
      mergePollInterval: 3_600_000,
    },
    // A provider's auth fields only appear in the settings model once a
    // vendor is selected, and the vendor is per-project config.
    projectConfig: {
      vendor: 'azure-devops',
      org: 'acme',
      project: 'widgets',
      repo: 'widgets',
    },
  });

  test('a stored secret never reaches the renderer', async ({ desktop }) => {
    const { page, homeDir } = desktop;
    expect(storedPat(homeDir)).toBe(PAT);

    const view = await page.evaluate(() => window.kirby.getSettingsView());
    const masked = view.filter((f) => f.masked);
    expect(masked.length).toBeGreaterThan(0);

    // The whole payload, not just the field: the renderer displays
    // provider-hosted markdown and images, so a secret anywhere in its
    // memory is one script-execution foothold from being read.
    expect(JSON.stringify(view)).not.toContain(PAT);
    for (const field of masked) {
      expect(field.value).toBe(PLACEHOLDER);
    }
  });

  test('saving an untouched secret field keeps the real credential', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;

    // Exactly what the form does when the user saves a field they never
    // edited: it sends back the placeholder it was given.
    await page.evaluate(async (placeholder) => {
      const view = await window.kirby.getSettingsView();
      const field = view.find((f) => f.masked);
      if (!field) throw new Error('no masked field in the settings view');
      await window.kirby.updateSettingsField(
        { label: field.label, key: field.key },
        placeholder
      );
    }, PLACEHOLDER);

    expect(storedPat(homeDir)).toBe(PAT);
  });

  test('a real edit replaces the secret', async ({ desktop }) => {
    const { page, homeDir } = desktop;

    await page.evaluate(async () => {
      const view = await window.kirby.getSettingsView();
      const field = view.find((f) => f.masked);
      if (!field) throw new Error('no masked field in the settings view');
      await window.kirby.updateSettingsField(
        { label: field.label, key: field.key },
        'ado_rotated'
      );
    });

    expect(storedPat(homeDir)).toBe('ado_rotated');
  });

  /**
   * Replacing a rejected access token has to take effect now.
   *
   * There is no Azure organization behind `acme/widgets`, so the
   * provider fails here exactly as it does against a revoked token —
   * which is the situation being tested. What the assertion turns on
   * is not whether the fetch succeeds but whether one was *started*:
   * `remoteFetches` is monotonic, and with the poll interval set to an
   * hour nothing else in the test can move it.
   */
  test('saving a token refetches immediately instead of waiting for the poll', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const syncState = () => page.evaluate(() => window.kirby.getSyncState());

    // Let the launch fetch finish and record a failure, so there is a
    // stale error to clear.
    await expect
      .poll(async () => (await syncState()).remoteError, { timeout: 20_000 })
      .not.toBeNull();
    const before = (await syncState()).remoteFetches;

    const after = await page.evaluate(async () => {
      const view = await window.kirby.getSettingsView();
      const field = view.find((f) => f.masked);
      if (!field) throw new Error('no masked field in the settings view');
      await window.kirby.updateSettingsField(
        { label: field.label, key: field.key },
        'ado_rotated'
      );
      // Read straight after the save. What is asserted below is that
      // a fetch was *started* — the clearing of the stale error is a
      // unit-level concern (host/services/sidebar.spec.ts), because
      // the new attempt may already have failed again by the time this
      // second round trip lands.
      return window.kirby.getSyncState();
    });

    expect(after.remoteFetches).toBeGreaterThan(before);
    // A poll is an hour away, so the fetch above came from the write.
    expect(after.remoteIntervalMs).toBe(3_600_000);
  });

  test('the settings page renders the secret as dots', async ({ desktop }) => {
    const { page } = desktop;
    await clickAppMenuItem(desktop.app, 'Settings…');
    await expect(tab(page, /Settings/)).toBeVisible();

    await page.getByRole('button', { name: 'Provider' }).click();
    const secretInput = page.locator('input[type="password"]').first();
    await expect(secretInput).toHaveValue(PLACEHOLDER);
  });
});
