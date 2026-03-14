import { describe, it, expect } from 'vitest';
import { parseArgs } from './util.js';

describe('parseArgs', () => {
  it('parses simple key=value', () => {
    expect(parseArgs(['--body=noquotes'])).toEqual({ body: 'noquotes' });
  });

  it('strips double quotes', () => {
    expect(parseArgs(['--body="hello world"'])).toEqual({
      body: 'hello world',
    });
  });

  it('strips single quotes', () => {
    expect(parseArgs(["--body='single'"])).toEqual({ body: 'single' });
  });

  it('preserves equals signs inside quoted values', () => {
    expect(parseArgs(['--key="value=with=equals"'])).toEqual({
      key: 'value=with=equals',
    });
  });

  it('does not strip mismatched quotes', () => {
    expect(parseArgs(['--key="mixed\'']).key).toBe('"mixed\'');
  });

  it('ignores args without -- prefix', () => {
    expect(parseArgs(['foo=bar'])).toEqual({});
  });

  it('parses multiple args', () => {
    expect(
      parseArgs(['--pr=123', '--file="src/foo.ts"', '--severity=major'])
    ).toEqual({ pr: '123', file: 'src/foo.ts', severity: 'major' });
  });
});
