import { describe, expect, it } from 'vitest';
import { SingleUseSecrets } from './secrets.js';

describe('SingleUseSecrets', () => {
  it('a freshly issued secret consumes successfully exactly once', () => {
    const secrets = new SingleUseSecrets<undefined>(1000);
    const secret = secrets.issue(undefined);
    expect(secrets.consume(secret)).toEqual({
      valid: true,
      payload: undefined,
    });
    expect(secrets.consume(secret)).toEqual({ valid: false });
  });

  it('carries a payload from issue through to consume', () => {
    const secrets = new SingleUseSecrets<string>(1000);
    const secret = secrets.issue('peer-a');
    expect(secrets.consume(secret)).toEqual({ valid: true, payload: 'peer-a' });
  });

  it('rejects an unknown secret', () => {
    const secrets = new SingleUseSecrets<undefined>(1000);
    expect(secrets.consume('never-issued')).toEqual({ valid: false });
  });

  it('rejects a secret once its TTL has elapsed, even unconsumed', () => {
    let now = 0;
    const secrets = new SingleUseSecrets<undefined>(1000, () => now);
    const secret = secrets.issue(undefined);
    now = 1001;
    expect(secrets.consume(secret)).toEqual({ valid: false });
  });

  it('accepts a secret right up to the TTL boundary', () => {
    let now = 0;
    const secrets = new SingleUseSecrets<undefined>(1000, () => now);
    const secret = secrets.issue(undefined);
    now = 1000;
    expect(secrets.consume(secret).valid).toBe(true);
  });

  it('mints distinct secrets on each issue', () => {
    const secrets = new SingleUseSecrets<undefined>(1000);
    const a = secrets.issue(undefined);
    const b = secrets.issue(undefined);
    expect(a).not.toBe(b);
  });
});
