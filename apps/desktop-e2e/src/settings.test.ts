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
    kirbyConfig: { vendorAuth: { 'azure-devops': { pat: PAT } } },
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

  test('the settings page renders the secret as dots', async ({ desktop }) => {
    const { page } = desktop;
    await clickAppMenuItem(desktop.app, 'Settings…');
    await expect(tab(page, /Settings/)).toBeVisible();

    await page.getByRole('button', { name: 'Provider' }).click();
    const secretInput = page.locator('input[type="password"]').first();
    await expect(secretInput).toHaveValue(PLACEHOLDER);
  });
});
