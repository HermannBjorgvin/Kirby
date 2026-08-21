import { describe, it, expect } from 'vitest';
import { IPC } from './contract.js';
import { createHostApi, registerHostHandlers } from './register-handlers.js';

function collect() {
  const registered = new Map<string, (...args: unknown[]) => unknown>();
  const registrar = {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      registered.set(channel, fn);
    },
  };
  return { registered, registrar };
}

describe('registerHostHandlers', () => {
  it('registers a handler for every channel in the contract', () => {
    const { registered, registrar } = collect();
    registerHostHandlers(registrar);
    for (const channel of Object.values(IPC)) {
      expect(registered.has(channel), `missing handler for ${channel}`).toBe(
        true
      );
    }
    expect(registered.size).toBe(Object.keys(IPC).length);
  });

  it('returns the version payload from the getVersion handler', async () => {
    const { registered, registrar } = collect();
    registerHostHandlers(registrar);
    const result = (await registered.get(IPC.getVersion)!()) as Record<
      string,
      string
    >;
    expect(result.node).toBe(process.versions.node);
    expect(result).toHaveProperty('app');
    expect(result).toHaveProperty('electron');
    expect(result).toHaveProperty('chrome');
  });

  it('preserves error messages across the boundary', async () => {
    const { registered, registrar } = collect();
    const failingApi = {
      ...createHostApi(),
      openRepo: () => Promise.reject(new Error('Not a git repository: /x')),
    };
    registerHostHandlers(registrar, failingApi);
    await expect(registered.get(IPC.openRepo)!('/x')).rejects.toThrow(
      'Not a git repository: /x'
    );
  });
});
