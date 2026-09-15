import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '@kirby/vcs-core';
import { createTmuxBackendFactory, tmuxSetOption } from '@kirby/terminal-tmux';
import { orchestraFixture } from '../../../tests/orchestra-fixture.js';
import { diffScans } from '../discovery/discovery-model.js';
import {
  getSession,
  isSessionAlive,
  liveSessionNames,
  setSessionBackendFactory,
} from '../pty-registry.js';
import { resolveSessionByName } from '../session-resolver.js';
import { newTerminalSessionName } from './terminal-name.js';
import { terminalSessionKey } from '../session-key.js';
import { sessionTags } from '../session-identity.js';
import { kirbyTmuxFactoryOptions } from '../tmux-factory-options.js';
import { launchTerminalSession } from './launch-terminal.js';

describe.skipIf(spawnSync('tmux', ['-V']).status !== 0)(
  'terminal name allocation',
  () => {
    let fixture: ReturnType<typeof orchestraFixture>;
    beforeEach(() => {
      fixture = orchestraFixture();
      setSessionBackendFactory(
        createTmuxBackendFactory(kirbyTmuxFactoryOptions(fixture.repo))
      );
    });
    afterEach(() => fixture?.close());

    it.each(['disappears', 'appears'] as const)(
      'uses the allocated name when another session %s before creation',
      (change) => {
        if (change === 'disappears')
          fixture.tmux('new-session', '-d', '-s', 'shop-shell', 'sleep', '300');
        const suggested = newTerminalSessionName();
        if (change === 'disappears')
          fixture.tmux('kill-session', '-t', '=shop-shell:');
        else {
          fixture.tmux('new-session', '-d', '-s', 'shop-shell', 'sleep', '300');
          for (const [key, value] of Object.entries(
            sessionTags(fixture.repo, { type: 'shell' })
          )) {
            tmuxSetOption('shop-shell', key, value);
          }
        }
        const expected =
          change === 'disappears' ? 'shop-shell' : 'shop-shell-2';
        const entry = launchTerminalSession({
          name: suggested,
          fresh: true,
          kind: 'shell',
          cwd: fixture.repo,
          cols: 80,
          rows: 24,
          config: { terminalBackend: 'tmux' } as AppConfig,
        });
        expect(entry.name).toBe(terminalSessionKey(expected));
        expect(entry.pty.name).toBe(expected);
        expect(getSession(terminalSessionKey(expected))).toBe(entry);
        expect(getSession(suggested)).toBeUndefined();
        expect(liveSessionNames()).toEqual([terminalSessionKey(expected)]);
        expect(resolveSessionByName(expected)).not.toBeNull();
        const delta = diffScans(
          null,
          {
            worktrees: [],
            persisted: new Set(),
            terminals: [
              {
                name: terminalSessionKey(expected),
                kind: 'shell',
                path: fixture.repo,
              },
            ],
          },
          isSessionAlive
        );
        expect(delta.adoptableTerminals).toEqual([]);
      }
    );
  }
);
