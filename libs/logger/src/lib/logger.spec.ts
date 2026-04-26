import { describe, it, expect } from 'vitest';
import { safeStringify } from './logger.js';

describe('safeStringify', () => {
  it('serializes plain objects via JSON.stringify', () => {
    expect(safeStringify({ a: 1, b: 'two' })).toBe('{"a":1,"b":"two"}');
  });

  it('formats Errors as message + stack', () => {
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at fake:1:1';
    expect(safeStringify(err)).toBe('boom\nError: boom\n    at fake:1:1');
  });

  it('does not throw on circular references', () => {
    const circular: Record<string, unknown> = { name: 'self' };
    circular.self = circular;
    expect(() => safeStringify(circular)).not.toThrow();
    // Falls through to String(circular) — '[object Object]'
    expect(safeStringify(circular)).toBe('[object Object]');
  });

  it('does not throw on BigInt values', () => {
    expect(() => safeStringify({ big: 1n })).not.toThrow();
    // String({ big: 1n }) → '[object Object]'
    expect(safeStringify({ big: 1n })).toBe('[object Object]');
  });

  it('does not throw when toJSON itself throws', () => {
    const obj = {
      toJSON() {
        throw new Error('toJSON sabotage');
      },
    };
    expect(() => safeStringify(obj)).not.toThrow();
  });
});
