import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { orchestraFixture } from './orchestra-fixture.js';

// close() lists and kills every session on the fixture's scratch tmux
// server. `list-sessions` (execFileSync) throws once no server is left —
// exercised here by killing every session, including the anchor, before
// close() gets to run its own listing.
describe.skipIf(spawnSync('tmux', ['-V']).status !== 0)(
  'orchestra fixture close()',
  () => {
    it('still unstubs env and removes the scratch HOME with no server left', () => {
      const fixture = orchestraFixture();
      for (const name of fixture
        .tmux('list-sessions', '-F', '#{session_name}')
        .split('\n')) {
        fixture.tmux('kill-session', '-t', `=${name}:`);
      }

      expect(() => fixture.close()).not.toThrow();

      expect(existsSync(fixture.home)).toBe(false);
      expect(process.env.HOME).not.toBe(fixture.home);
    });

    // Every tmux(...) call runs assertIsolated() first, which throws if
    // $TMUX reappeared — a sign the fixture is no longer safely isolated
    // from the developer's own server. close() must surface that rather
    // than swallow it as if cleanup had succeeded; the fixture's own
    // `sleep 300` anchor session would otherwise be silently left behind.
    // The anchor is killed first, while the fixture is still isolated:
    // close() throws before its own kill loop runs, and once the scratch
    // HOME is removed the server's socket is gone with it.
    it('does not swallow a lost isolation guarantee', () => {
      const fixture = orchestraFixture();
      fixture.tmux('kill-session', '-t', '=fixture-anchor:');
      vi.stubEnv('TMUX', '/tmp/not-the-scratch-socket,1,0');

      expect(() => fixture.close()).toThrow('Unsafe tmux fixture environment');
    });
  }
);
