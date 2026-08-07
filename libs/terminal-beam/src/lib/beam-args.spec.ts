import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  beamKillArgs,
  beamLsArgs,
  beamNewArgs,
  shellJoin,
  shellQuote,
} from './beam-args.js';

describe('beamNewArgs', () => {
  it('bare target is a plain create-or-attach', () => {
    expect(beamNewArgs({ target: 'desktop:api' })).toEqual([
      'new',
      'desktop:api',
    ]);
  });

  it('cwd becomes -c', () => {
    expect(beamNewArgs({ target: 'desktop:api', cwd: '/data/wt' })).toEqual([
      'new',
      'desktop:api',
      '-c',
      '/data/wt',
    ]);
  });

  it('repo and branch ride together', () => {
    expect(
      beamNewArgs({
        target: 'desktop:api',
        repo: '/data/repo',
        branch: 'feature/x',
      })
    ).toEqual([
      'new',
      'desktop:api',
      '--repo',
      '/data/repo',
      '--branch',
      'feature/x',
    ]);
  });

  it('repo without branch is omitted — beam requires the pair', () => {
    expect(beamNewArgs({ target: 'desktop:api', repo: '/data/repo' })).toEqual([
      'new',
      'desktop:api',
    ]);
  });

  it('the command runs through a login shell as one argument', () => {
    expect(
      beamNewArgs({
        target: 'desktop:api',
        command: ['/bin/sh', '-c', 'claude --continue || claude'],
      })
    ).toEqual([
      'new',
      'desktop:api',
      '--',
      'sh',
      '-lc',
      "/bin/sh -c 'claude --continue || claude'",
    ]);
  });

  it('an empty command adds nothing', () => {
    expect(beamNewArgs({ target: 'desktop:api', command: [] })).toEqual([
      'new',
      'desktop:api',
    ]);
  });
});

describe('beamKillArgs', () => {
  it('plain kill', () => {
    expect(beamKillArgs('desktop:api')).toEqual(['kill', 'desktop:api']);
  });

  it('with worktree removal', () => {
    expect(beamKillArgs('desktop:api', true)).toEqual([
      'kill',
      'desktop:api',
      '--rm-worktree',
    ]);
  });
});

describe('beamLsArgs', () => {
  it('asks for JSON', () => {
    expect(beamLsArgs()).toEqual(['ls', '--json']);
  });
});

describe('shellJoin', () => {
  it('quoted output is inert when re-parsed by a real shell', () => {
    const nasty = [
      ['echo', "it's", '$HOME', '`id`', 'a;b', 'a b\tc', '--flag'],
      ['claude', '--continue'],
    ];
    for (const argv of nasty) {
      const r = spawnSync('sh', ['-c', `printf '%s\\0' ${shellJoin(argv)}`], {
        encoding: 'utf8',
      });
      expect(r.stdout.split('\0').slice(0, -1)).toEqual(argv);
    }
  });

  it('empty string survives quoting', () => {
    expect(shellQuote('')).toBe("''");
  });
});
