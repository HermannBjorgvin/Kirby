import type { Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  UNSET_BACKEND,
  killKirbySessions,
  tmuxAvailable,
} from './setup/tmux.js';
import {
  agentSpinner,
  createWorktree,
  focusTerminal,
  launchAgentFromRail,
  sidebarRow,
  startSessionFromMenu,
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
  await launchAgentFromRail(page);
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

  test('coming back to a tab does not replay its scrollback on top of itself', async ({
    desktop,
  }) => {
    const { page } = desktop;

    await launch(page, 'alpha');
    await typeAndExpectEcho(page, 'from-alpha');
    await launch(page, 'beta');

    // The pane replays the host's ring buffer once, when it mounts.
    // Anything that makes that run again on a tab switch — reading the
    // active tab inside the subscription rather than beside it is the
    // easy way in — writes the entire history into the terminal a
    // second time, under the copy already there.
    await tab(page, /alpha/).click();
    await expect(visibleText(page, /echo:from-alpha/)).toBeVisible();
    // The pane asks for the buffer as it re-renders, so this read is
    // queued behind any the switch provoked: once it answers, a second
    // replay would already have been written.
    await page.evaluate(() => window.kirby.getSessionBuffer('alpha'));

    await expect(page.getByText(BANNER).filter({ visible: true })).toHaveCount(
      1
    );
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

    // The paste is a round trip — read the file, hand it to the host,
    // write it to disk, then type the path — while the agent only
    // echoes once a line is terminated. Pressing Enter once races that:
    // send it too early and the newline arrives ahead of the path,
    // which then sits in the buffer un-echoed forever. Retry the
    // newline instead of guessing how long the round trip takes.
    await expect(async () => {
      await page.keyboard.press('Enter');
      await expect(
        visibleText(page, /echo:.*kirby-pasted-images.*\.png/)
      ).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
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
    // Same race as the image case: the pasted text reaches the PTY over
    // IPC, so a single Enter can beat it there.
    await expect(async () => {
      await page.keyboard.press('Enter');
      await expect(visibleText(page, /echo:plain-text-paste/)).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: 30_000 });
  });
});

/**
 * The grid a relaunched agent is given.
 *
 * An agent draws itself to whatever size its terminal hands it, so a
 * terminal on the wrong grid looks like the agent misbehaving. A launch
 * can only estimate the pane, so the PTY starts on a guess and is
 * corrected once the terminal has measured itself — but a restart into a
 * pane that already holds a correctly-sized terminal moves nothing, and
 * the correction never came.
 */
test.describe('Terminal fit', () => {
  test.use({ kirbyConfig: { aiCommand: fakeAgent({ printSize: true }) } });

  interface Grid {
    cols: number;
    rows: number;
  }
  interface Report extends Grid {
    /** Which agent said so. */
    pid: string;
  }

  /** Every grid an agent has reported, oldest first. */
  async function reportedGrids(page: Page): Promise<Report[]> {
    const text = await page.evaluate(() => document.body.innerText);
    return [...text.matchAll(/size:(\d+)x(\d+)#(\d+)/g)].map((m) => ({
      cols: Number(m[1]),
      rows: Number(m[2]),
      pid: m[3],
    }));
  }

  /** The agent currently reporting, once it has said anything. */
  async function currentPid(page: Page): Promise<string> {
    await expect
      .poll(async () => (await reportedGrids(page)).length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    return (await reportedGrids(page)).at(-1)!.pid;
  }

  /**
   * The grid that fills the terminal on screen, measured off its own
   * box and cell metrics — so this says nothing about how the app
   * computes a grid, only how much of the pane the agent covers.
   */
  async function paneGrid(page: Page): Promise<Grid> {
    return page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.wterm');
      const row = el?.querySelector<HTMLElement>('.term-row');
      if (!el || !row) throw new Error('no terminal on screen');
      const style = getComputedStyle(el);
      const probe = document.createElement('div');
      probe.className = 'term-row';
      probe.style.position = 'absolute';
      probe.style.visibility = 'hidden';
      const span = document.createElement('span');
      span.textContent = 'W'.repeat(40);
      probe.appendChild(span);
      el.appendChild(probe);
      const charWidth = span.getBoundingClientRect().width / 40;
      probe.remove();
      const box = el.getBoundingClientRect();
      const inner = {
        width:
          box.width -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight),
        height:
          box.height -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom),
      };
      return {
        cols: Math.floor(inner.width / charWidth),
        rows: Math.floor(inner.height / row.getBoundingClientRect().height),
      };
    });
  }

  /**
   * Wait for the agent to settle on the grid that fills its pane.
   *
   * `notPid` is the agent that was there before. Without it a restart
   * reads the *previous* agent's last line — still on screen, and still
   * correct — and passes on a terminal that never resized at all.
   */
  async function expectAgentFillsPane(
    page: Page,
    notPid?: string
  ): Promise<void> {
    const expected = await paneGrid(page);
    await expect
      .poll(
        async () => {
          const last = (await reportedGrids(page))
            .filter((g) => g.pid !== notPid)
            .at(-1);
          return last ? { cols: last.cols, rows: last.rows } : null;
        },
        { timeout: 20_000 }
      )
      .toEqual(expected);
  }

  test('an agent restarted in place is given the pane it is drawn in', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'restart');
    await launchAgentFromRail(page);
    await expect(visibleText(page, BANNER)).toBeVisible({ timeout: 30_000 });

    await expectAgentFillsPane(page);
    const before = await currentPid(page);

    // Stopped from the rail, the tab stays open and the terminal stays
    // mounted — nothing about it changes size, so a fit that only speaks
    // up when wterm's own grid moved has nothing to say, and the new PTY
    // keeps whatever the launch request guessed.
    await page.getByLabel('Stop agent').filter({ visible: true }).click();
    await expect
      .poll(
        async () => {
          const s = await page.evaluate(() => window.kirby.listSessions());
          return s.filter((x) => x.running).length;
        },
        { timeout: 20_000 }
      )
      .toBe(0);

    await launchAgentFromRail(page);
    await expectAgentFillsPane(page, before);
  });

  test('a tab closed and launched again comes back on the pane\'s grid', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'refit');
    await launchAgentFromRail(page);
    await expect(visibleText(page, BANNER)).toBeVisible({ timeout: 30_000 });
    await expectAgentFillsPane(page);

    // Closing the tab takes the idle agent with it and tears the wterm
    // instance down; the relaunch mounts a fresh one.
    await expect(agentSpinner(page)).toHaveCount(0, { timeout: 20_000 });
    await tab(page, /refit/)
      .getByLabel('Close tab')
      .click();
    await expect(tabs(page)).toHaveCount(0);
    await expect
      .poll(
        async () => {
          const s = await page.evaluate(() => window.kirby.listSessions());
          return s.filter((x) => x.running).length;
        },
        { timeout: 20_000 }
      )
      .toBe(0);

    await sidebarRow(page, /refit/).dblclick();
    await startSessionFromMenu(page);
    await expect(visibleText(page, BANNER)).toBeVisible({ timeout: 30_000 });
    await expectAgentFillsPane(page);
  });

  /**
   * The same restart, through tmux.
   *
   * A tmux session outlives the local PTY that shows it, and tmux sizes
   * a window to the client attached to it — so the renderer's resize has
   * one more hop to survive here than it does on a bare PTY.
   */
  test.describe('under tmux', () => {
    test.skip(!tmuxAvailable(), 'tmux is not installed');
    test.use({
      kirbyConfig: {
        ...UNSET_BACKEND,
        aiCommand: fakeAgent({ printSize: true }),
      },
    });
    // Closing the app detaches rather than kills, by design.
    test.afterEach(({ desktop }) => killKirbySessions(desktop.homeDir));

    test('a restarted tmux agent is given the pane too', async ({
      desktop,
    }) => {
      const { page } = desktop;
      await createWorktree(page, 'tmux-refit');
      await launchAgentFromRail(page);
      await expect(visibleText(page, BANNER)).toBeVisible({ timeout: 30_000 });

      await expectAgentFillsPane(page);
      const before = await currentPid(page);

      await page.getByLabel('Stop agent').filter({ visible: true }).click();
      await expect
        .poll(
          async () => {
            const s = await page.evaluate(() => window.kirby.listSessions());
            return s.filter((x) => x.running).length;
          },
          { timeout: 20_000 }
        )
        .toBe(0);

      await launchAgentFromRail(page);
      await expectAgentFillsPane(page, before);
    });
  });
});
