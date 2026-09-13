import { test, expect } from './fixtures/kirby.js';
import { wtermHost } from './setup/constants.js';

// GET /output exposes the wterm host's raw PTY ring buffer (base64).
// The browser terminal renders character cells only — it can't paint
// kitty graphics or synthesise mouse reports — so tests that need to
// assert on those escape sequences read the bytes here. This offline
// test pins the endpoint's contract.

test.describe('Raw output endpoint', () => {
  test('returns the PTY byte stream', async ({ kirby, baseURL }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    const res = await fetch(`${wtermHost(baseURL)}/output`);
    expect(res.ok).toBe(true);
    const { base64 } = (await res.json()) as { base64: string };
    const raw = Buffer.from(base64, 'base64').toString('latin1');
    expect(raw).toContain('Kirby');
    // Raw ANSI, not the rendered DOM text.
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
