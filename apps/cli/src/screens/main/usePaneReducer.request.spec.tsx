import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { usePaneReducer } from '@kirby/app-core';
import {
  SESSION_MENU_REQUEST_TTL_MS,
  __resetSessionMenuRequestForTests,
  requestSessionMenu,
  type SidebarItem,
} from '@kirby/core';

// The pane reducer honors a session-menu request from whichever pane
// shows that session: the one already mounted when the request is
// filed, or the mount a selection move produces. Rendered through Ink
// so the effect and the store subscription run for real.

const alpha = {
  kind: 'session',
  session: { name: 'alpha', running: false },
  branch: 'alpha',
} as SidebarItem;

function Probe({ item, name }: { item: SidebarItem; name: string }) {
  const pane = usePaneReducer(item, name);
  return (
    <Text>
      {pane.paneMode}|{pane.sessionMenu ? 'menu' : 'none'}
    </Text>
  );
}

const flush = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  __resetSessionMenuRequestForTests();
});

describe('usePaneReducer — session menu request', () => {
  it('opens the menu on the mount that follows a request', async () => {
    requestSessionMenu('alpha');
    const { lastFrame, unmount } = render(<Probe item={alpha} name="alpha" />);
    await flush();
    expect(lastFrame()).toBe('confirm|menu');
    unmount();
  });

  it('opens the menu on the pane already showing the session', async () => {
    const { lastFrame, unmount } = render(<Probe item={alpha} name="alpha" />);
    await flush();
    expect(lastFrame()).toBe('terminal|none');
    requestSessionMenu('alpha');
    await flush();
    expect(lastFrame()).toBe('confirm|menu');
    unmount();
  });

  it('leaves a request for another session alone', async () => {
    const { lastFrame, unmount } = render(<Probe item={alpha} name="alpha" />);
    await flush();
    requestSessionMenu('beta');
    await flush();
    expect(lastFrame()).toBe('terminal|none');
    unmount();
  });

  it('drops a request that has expired', async () => {
    requestSessionMenu('alpha', Date.now() - SESSION_MENU_REQUEST_TTL_MS - 1);
    const { lastFrame, unmount } = render(<Probe item={alpha} name="alpha" />);
    await flush();
    expect(lastFrame()).toBe('terminal|none');
    unmount();
  });
});
