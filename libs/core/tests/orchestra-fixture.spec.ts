import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
  }
);
