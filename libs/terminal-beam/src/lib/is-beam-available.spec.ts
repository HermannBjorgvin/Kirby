import { describe, it, expect } from 'vitest';
import { parseRemoteLs } from './is-beam-available.js';

describe('parseRemoteLs', () => {
  it('takes the first column below the header', () => {
    const out = [
      'NAME     HOST                    PORT  IP',
      'desktop  hermann@10.0.0.5             127.44.0.1',
      'gpu      gpu-box                 2222  127.44.0.2',
    ].join('\n');
    expect(parseRemoteLs(out)).toEqual(['desktop', 'gpu']);
  });

  it('the no-remotes sentence yields an empty list', () => {
    expect(
      parseRemoteLs(
        'no remotes registered (beam remote add <name> <user@host>)'
      )
    ).toEqual([]);
  });

  it('empty output yields an empty list', () => {
    expect(parseRemoteLs('')).toEqual([]);
  });
});
