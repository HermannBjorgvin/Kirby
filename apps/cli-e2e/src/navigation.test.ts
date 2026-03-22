import { test, expect } from '@microsoft/tui-test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestRepo, registerCleanup } from './setup/git-repo.js';

const testDir = createTestRepo();
const mainJs = resolve('../cli/dist/main.js');
registerCleanup(testDir);

// Use isolated home with vim preset to match original test expectations
const home = mkdtempSync(join(tmpdir(), 'kirby-nav-'));
registerCleanup(home);
mkdirSync(join(home, '.kirby'), { recursive: true });
writeFileSync(
  join(home, '.kirby', 'config.json'),
  JSON.stringify({ keybindPreset: 'vim' }),
  'utf-8'
);

test.use({
  program: { file: 'node', args: [mainJs, testDir] },
  env: {
    ...process.env,
    HOME: home,
    TERM: 'xterm-256color',
  },
});

test.describe('Keyboard Navigation', () => {
  test('s opens settings panel', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    terminal.write('s');
    await expect(
      terminal.getByText('Settings', { strict: false })
    ).toBeVisible();
  });

  test('Esc closes settings panel', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    terminal.write('s');
    await expect(
      terminal.getByText('Settings', { strict: false })
    ).toBeVisible();
    terminal.keyEscape();
    await expect(terminal.getByText('checkout branch')).toBeVisible();
  });

  test('c opens branch picker', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    terminal.write('c');
    // Branch picker shows in the sidebar area
    await expect(terminal.getByText(/master|main/g)).toBeVisible();
  });

  test('Esc closes branch picker', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    terminal.write('c');
    await expect(terminal.getByText(/master|main/g)).toBeVisible();
    terminal.keyEscape();
    await expect(terminal.getByText('checkout branch')).toBeVisible();
  });
});
