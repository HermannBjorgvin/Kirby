import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTmuxBackendFactory } from '@kirby/terminal-tmux';
import { orchestraFixture } from '../../tests/orchestra-fixture.js';
import { listLiveWorktreeSessions } from './discovery/live-worktree-sessions.js';
import {
  getSession,
  setSessionBackendFactory,
  spawnSession,
} from './pty-registry.js';
import { listOurSessions, resolveWorktreeSession } from './session-resolver.js';
import { kirbyTmuxFactoryOptions } from './tmux-factory-options.js';

const target = 'codex:11111111-2222-4333-8444-555555555555';
const branch = 'feature/integration';

describe.skipIf(spawnSync('tmux', ['-V']).status !== 0)(
  'installed Orchestra plugin',
  () => {
    let fixture: ReturnType<typeof orchestraFixture>;
    beforeEach(() => {
      fixture = orchestraFixture();
      setSessionBackendFactory(
        createTmuxBackendFactory(kirbyTmuxFactoryOptions(fixture.repo))
      );
    });
    afterEach(() => fixture?.close());

    async function spawnPlayer(prompt = 'Do the fixture task') {
      const result = fixture.script(
        'spawn.sh',
        '--branch',
        branch,
        '--from',
        'main',
        '--agent',
        'codex',
        '--prompt',
        prompt,
        '--orchestrator',
        target,
        '--no-node-modules'
      );
      expect({ status: result.status, stderr: result.stderr }).toEqual({
        status: 0,
        stderr: '',
      });
      await expect
        .poll(() => existsSync(join(fixture.home, 'agent-start.json')))
        .toBe(true);
      const session = resolveWorktreeSession(fixture.repo, branch);
      expect(session).not.toBeNull();
      return session!;
    }

    it('installs the package, launches a player, and attaches Kirby without replacing it', async () => {
      const manifest = JSON.parse(
        readFileSync(join(fixture.plugin, '.claude-plugin/plugin.json'), 'utf8')
      );
      expect(manifest).toMatchObject({ name: 'orchestra', version: '2.0.0' });
      for (const skill of ['orchestrator', 'player']) {
        expect(
          readFileSync(
            join(fixture.plugin, 'skills', skill, 'SKILL.md'),
            'utf8'
          )
        ).toContain(`name: ${skill}`);
      }
      // A collision must not claim an untagged terminal, and a >16 KiB
      // prompt must reach the agent unchanged through the real buffer path.
      fixture.tmux(
        'new-session',
        '-d',
        '-s',
        'shop-feature-integration',
        'sleep',
        '300'
      );
      const prompt =
        'Literal $(touch SHOULD_NOT_EXIST) `echo nope`\n' +
        'task '.repeat(4000);
      const player = await spawnPlayer(prompt);
      expect(player.name).toBe('shop-feature-integration-2');
      const started = JSON.parse(fixture.read('agent-start.json')) as {
        args: string[];
        tmux: string | null;
      };
      expect(started.args.at(-1)).toBe(`$player ${prompt}`);
      expect(started.tmux).toBeNull();
      expect(existsSync(join(player.path, 'SHOULD_NOT_EXIST'))).toBe(false);
      expect(listLiveWorktreeSessions({ terminalBackend: 'tmux' })).toEqual([
        expect.objectContaining({
          tmuxName: player.name,
          repoRoot: fixture.repo,
          branch,
          agent: 'codex',
          orchestrator: target,
        }),
      ]);
      const beforePid = fixture.tmux(
        'display-message',
        '-p',
        '-t',
        `=${player.name}:`,
        '#{pane_pid}'
      );
      const entry = spawnSession(
        'feature-integration',
        'codex',
        [],
        80,
        24,
        player.path
      );
      expect(getSession('feature-integration')).toBe(entry);
      expect(entry.pty.name).toBe(player.name);
      expect(
        fixture.tmux(
          'display-message',
          '-p',
          '-t',
          `=${player.name}:`,
          '#{pane_pid}'
        )
      ).toBe(beforePid);
      expect(resolveWorktreeSession(fixture.repo, branch)).toEqual(player);
      expect(listOurSessions()).toHaveLength(1);
      const killed = fixture.script('kill.sh', branch);
      expect({ status: killed.status, stderr: killed.stderr }).toEqual({
        status: 0,
        stderr: '',
      });
      expect(resolveWorktreeSession(fixture.repo, branch)).toBeNull();
      expect(existsSync(player.path)).toBe(true);
      expect(
        fixture.tmux('has-session', '-t', '=shop-feature-integration:')
      ).toBe('');
    });

    it('runs reports inside the fake player and exposes delivery failures without advancing last-report', async () => {
      const player = await spawnPlayer();
      const send = fixture.script(
        'send.sh',
        branch,
        '--raw',
        'report first update'
      );
      expect({ status: send.status, stderr: send.stderr }).toEqual({
        status: 0,
        stderr: '',
      });
      await expect
        .poll(() => existsSync(join(fixture.home, 'report-result.json')))
        .toBe(true);
      expect(JSON.parse(fixture.read('report-result.json')).status).toBe(0);
      expect(JSON.parse(fixture.read('deliveries.jsonl').trim())).toEqual([
        'queue',
        '--thread',
        target.slice(6),
        '--message',
        `[player ${player.name}] PROGRESS: first update`,
      ]);
      const lastReport = resolveWorktreeSession(
        fixture.repo,
        branch
      )?.lastReport;
      expect(lastReport).toMatch(/^PROGRESS \d{4}-.*Z$/);
      writeFileSync(join(fixture.home, 'refuse-queue'), '1');
      rmSync(join(fixture.home, 'report-result.json'));
      const failed = fixture.script(
        'send.sh',
        branch,
        '--raw',
        'report complete failed message'
      );
      expect({ status: failed.status, stderr: failed.stderr }).toEqual({
        status: 0,
        stderr: '',
      });
      await expect
        .poll(() => existsSync(join(fixture.home, 'report-result.json')))
        .toBe(true);
      const result = JSON.parse(fixture.read('report-result.json'));
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`Target: ${target}`);
      expect(result.stderr).toContain(
        'Reason: Codex queue refused the message'
      );
      expect(result.stderr).toContain(
        `Report: [player ${player.name}] PROGRESS: complete failed message`
      );
      expect(resolveWorktreeSession(fixture.repo, branch)?.lastReport).toBe(
        lastReport
      );
      expect(fixture.read('deliveries.jsonl').trim().split('\n')).toHaveLength(
        1
      );
    });

    it('lets Orchestra adopt and stop a Kirby-created player while preserving creator identity', async () => {
      const entry = spawnSession('main', 'codex', [], 80, 24, fixture.repo);
      await expect
        .poll(() => existsSync(join(fixture.home, 'agent-start.json')))
        .toBe(true);
      const player = resolveWorktreeSession(fixture.repo, 'main')!;
      expect(player.spawner).toBe('kirby');
      const adopted = fixture.script(
        'adopt.sh',
        player.name,
        '--agent',
        'codex',
        '--orchestrator',
        target,
        'handoff task'
      );
      expect({ status: adopted.status, stderr: adopted.stderr }).toEqual({
        status: 0,
        stderr: '',
      });
      await expect
        .poll(() => existsSync(join(fixture.home, 'agent-input.jsonl')))
        .toBe(true);
      expect(fixture.read('agent-input.jsonl')).toContain(
        '$player handoff task'
      );
      expect(resolveWorktreeSession(fixture.repo, 'main')).toMatchObject({
        spawner: 'kirby',
        orchestrator: target,
      });
      expect(fixture.script('kill.sh', player.name).status).toBe(0);
      await expect.poll(() => entry.exited).toBe(true);
      expect(resolveWorktreeSession(fixture.repo, 'main')).toBeNull();
    });
  }
);
