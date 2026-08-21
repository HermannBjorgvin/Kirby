import { test, expect } from './fixtures/kirby.js';

// Each press is followed by a polling visibility assertion (not
// pressUntil — cycling is not idempotent, a re-delivered arrow would
// land on the wrong agent).
test.describe('Branch picker agent selector', () => {
  test('shows the default agent and cycles with arrow keys', async ({
    kirby,
  }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await kirby.term.type('c');
    await expect(kirby.term.getByText('Branch Picker')).toBeVisible();

    // No agentId/aiCommand in the fixture config → registry default.
    await expect(kirby.term.getByText('Claude (default)')).toBeVisible();

    await kirby.term.press('ArrowRight');
    await expect(kirby.term.getByText('Codex')).toBeVisible();

    // Left twice from Codex wraps past the default to the end of the list.
    await kirby.term.press('ArrowLeft');
    await expect(kirby.term.getByText('Claude (default)')).toBeVisible();
    await kirby.term.press('ArrowLeft');
    await expect(kirby.term.getByText('OpenCode')).toBeVisible();
  });

  test('resets to the default agent when the picker is reopened', async ({
    kirby,
  }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await kirby.term.type('c');
    await expect(kirby.term.getByText('Branch Picker')).toBeVisible();

    await kirby.term.press('ArrowRight');
    await expect(kirby.term.getByText('Codex')).toBeVisible();

    await kirby.term.press('Escape');
    await expect(kirby.term.getByText('Branch Picker')).not.toBeVisible({
      timeout: 5_000,
    });

    await kirby.term.type('c');
    await expect(kirby.term.getByText('Branch Picker')).toBeVisible();
    await expect(kirby.term.getByText('Claude (default)')).toBeVisible();
  });
});
