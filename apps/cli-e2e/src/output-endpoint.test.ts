import { test, expect } from './fixtures/n10.js';
import { wtermHost } from './setup/constants.js';

// GET /output exposes the wterm host's raw PTY ring buffer (base64).
// The browser terminal renders character cells only — it can't paint
// kitty graphics or synthesise mouse reports — so tests that need to
// assert on those escape sequences read the bytes here. This offline
// test pins the endpoint's contract.

test.describe('Raw output endpoint', () => {
  test('returns the PTY byte stream', async ({ n10, baseURL }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    const res = await fetch(`${wtermHost(baseURL)}/output`);
    expect(res.ok).toBe(true);
    const { base64 } = (await res.json()) as { base64: string };
    const raw = Buffer.from(base64, 'base64').toString('latin1');
    expect(raw).toContain('n10');
    // Raw ANSI, not the rendered DOM text.
    expect(raw).toContain('\x1b[');
  });
});

test.describe('Forced kitty image mode', () => {
  test.use({ n10Env: { N10_IMAGES: 'kitty' } });

  test('boots normally with N10_IMAGES=kitty', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(n10.term.getByText('(no sessions)').first()).toBeVisible();
  });
});
