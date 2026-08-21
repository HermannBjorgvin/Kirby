import { test, expect } from './fixtures/kirby.js';
import { HOST } from './setup/host.js';

// GET /output exposes the wterm host's raw PTY ring buffer (base64).
// It exists so tests can assert on escape sequences the browser
// terminal can't render — kitty graphics APC payloads, DECSET mouse
// toggles. This offline test pins the endpoint's contract.

test.describe('Raw output endpoint', () => {
  test('returns the PTY byte stream', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    const res = await fetch(`${HOST}/output`);
    expect(res.ok).toBe(true);
    const { base64 } = (await res.json()) as { base64: string };
    const raw = Buffer.from(base64, 'base64').toString('latin1');
    expect(raw).toContain('Kirby');
    // The stream is raw ANSI, not rendered text.
    expect(raw).toContain('\x1b[');
  });
});

test.describe('Forced kitty image mode', () => {
  test.use({ kirbyEnv: { KIRBY_IMAGES: 'kitty' } });

  test('boots normally with KIRBY_IMAGES=kitty', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await expect(kirby.term.getByText('(no sessions)').first()).toBeVisible();
  });
});
