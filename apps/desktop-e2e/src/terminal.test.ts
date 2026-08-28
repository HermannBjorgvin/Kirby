import type { Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  focusTerminal,
  sidebarRow,
  tab,
  tabs,
  visibleText,
} from './setup/app.js';

/**
 * The terminal is the whole point of the app, and its round trip is the
 * longest path in it: a keystroke goes renderer → contextBridge → IPC →
 * main process → PTY → agent, and the reply comes all the way back and
 * is painted. Every other test here watches output the app produced for
 * itself; these are the only ones that put something *in*.
 */

const BANNER = 'kirby-fake-agent-ready';

async function launch(page: Page, branch: string) {
  await createWorktree(page, branch);
  await page
    .getByRole('button', { name: /(Re)?launch agent/i })
    .filter({ visible: true })
    .first()
    .click();
  await expect(visibleText(page, BANNER)).toBeVisible({ timeout: 30_000 });
}

/** Type a line into the on-screen agent and wait for its echo. */
async function typeAndExpectEcho(page: Page, text: string) {
  await focusTerminal(page);
  await page.keyboard.type(text);
  // The agent echoes on end-of-line; a raw PTY delivers keystrokes one
  // at a time, so without this it answers per character.
  await page.keyboard.press('Enter');
  await expect(visibleText(page, new RegExp(`echo:${text}`))).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('Terminal input', () => {
  test.use({ kirbyConfig: { aiCommand: fakeAgent({ echo: true }) } });

  test('a keystroke reaches the agent and its reply comes back', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await launch(page, 'typing');

    // The fake agent echoes what it is given, so seeing this proves the
    // whole chain — not just that the renderer drew the keystroke.
    await typeAndExpectEcho(page, 'hello');
    await expect(visibleText(page, /echo:hello/)).toBeVisible();
  });

  test('typing does not count as the agent being busy', async ({ desktop }) => {
    const { page } = desktop;
    await launch(page, 'typing');
    await typeAndExpectEcho(page, 'x');

    // The agent echoing a keystroke back is not work. If input counted,
    // every tab you typed into would claim to be working and closing it
    // would demand a confirmation.
    await expect(page.locator('.agent-spinner')).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});

test.describe('Two agents at once', () => {
  test.use({ kirbyConfig: { aiCommand: fakeAgent({ echo: true }) } });

  test('keep their own output, and switching tabs does not lose it', async ({
    desktop,
  }) => {
    const { page } = desktop;

    await launch(page, 'alpha');
    await typeAndExpectEcho(page, 'from-alpha');

    await launch(page, 'beta');
    await typeAndExpectEcho(page, 'from-beta');

    await expect(tabs(page)).toHaveCount(2);
    // Two PTYs sharing one key would cross their streams here.
    await expect(
      page.getByText(/echo:from-alpha/).filter({ visible: true })
    ).toHaveCount(0);

    // Back to the first: its scrollback survived, because the pane of a
    // tab with a live session stays mounted.
    await tab(page, /alpha/).click();
    await expect(visibleText(page, /echo:from-alpha/)).toBeVisible();
    await expect(
      page.getByText(/echo:from-beta/).filter({ visible: true })
    ).toHaveCount(0);

    const sessions = await page.evaluate(() => window.kirby.listSessions());
    expect(
      sessions
        .filter((s) => s.running)
        .map((s) => s.name)
        .sort()
    ).toEqual(['alpha', 'beta']);
  });

  test('stopping one leaves the other running', async ({ desktop }) => {
    const { page } = desktop;
    await launch(page, 'alpha');
    await launch(page, 'beta');

    // Stop beta from its rail; alpha is untouched.
    await page.getByLabel('Stop agent').filter({ visible: true }).click();
    await expect
      .poll(
        async () => {
          const s = await page.evaluate(() => window.kirby.listSessions());
          return s.filter((x) => x.running).map((x) => x.name);
        },
        { timeout: 20_000 }
      )
      .toEqual(['alpha']);

    await expect(sidebarRow(page, /alpha/)).toBeVisible();
    await expect(sidebarRow(page, /beta/)).toBeVisible();
  });
});

test.describe('Pasting an image', () => {
  test.use({ kirbyConfig: { aiCommand: fakeAgent({ echo: true }) } });

  /**
   * A PTY carries text, so an image on the clipboard has to become a
   * file the agent can open. wterm's own paste handler reads only
   * `getData('text')` and silently drops everything else, which is what
   * made pasting a screenshot look like a no-op.
   *
   * Playwright cannot put an image on the real system clipboard, so the
   * paste event is synthesised — that still exercises the whole path
   * that matters: our capture-phase listener, the bridge, the host
   * writing the file, and the path arriving at the agent through the
   * PTY.
   */
  async function pasteImage(page: Page, type = 'image/png') {
    await focusTerminal(page);
    await page.evaluate((mimeType) => {
      const target = document.querySelector('textarea') ?? document.body;
      const data = new DataTransfer();
      // A one-pixel PNG's worth of bytes — the host stores whatever it
      // is handed, so the content only has to be non-empty.
      data.items.add(
        new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'x', {
          type: mimeType,
        })
      );
      target.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        })
      );
    }, type);
  }

  test('sends the agent a path to the pasted image', async ({ desktop }) => {
    const { page } = desktop;
    await launch(page, 'pasting');

    await pasteImage(page);
    // The agent echoes on end-of-line, so the path only comes back once
    // the line is terminated.
    await page.keyboard.press('Enter');

    await expect(
      visibleText(page, /echo:.*kirby-pasted-images.*\.png/)
    ).toBeVisible({ timeout: 15_000 });
  });

  test('leaves an ordinary text paste to the terminal', async ({ desktop }) => {
    const { page } = desktop;
    await launch(page, 'pasting-text');

    await focusTerminal(page);
    await page.evaluate(() => {
      const target = document.querySelector('textarea') ?? document.body;
      const data = new DataTransfer();
      data.setData('text/plain', 'plain-text-paste');
      target.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        })
      );
    });
    await page.keyboard.press('Enter');

    await expect(visibleText(page, /echo:plain-text-paste/)).toBeVisible({
      timeout: 15_000,
    });
  });
});
