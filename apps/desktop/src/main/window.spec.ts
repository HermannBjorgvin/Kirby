import { describe, it, expect } from 'vitest';
import { loadTarget, rendererWebPreferences } from './window.js';

describe('rendererWebPreferences', () => {
  it('never grants Node access to the renderer', () => {
    const prefs = rendererWebPreferences('/path/to/preload.cjs');
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
  });

  it('points the preload at the provided bridge script', () => {
    const prefs = rendererWebPreferences('/path/to/preload.cjs');
    expect(prefs.preload).toBe('/path/to/preload.cjs');
  });
});

describe('loadTarget', () => {
  it('prefers the dev server URL when one is set', () => {
    const target = loadTarget('http://localhost:5173', '/app/index.html');
    expect(target).toEqual({
      kind: 'dev-server',
      url: 'http://localhost:5173',
    });
  });

  it('falls back to the built index.html on disk', () => {
    const target = loadTarget(undefined, '/app/renderer/index.html');
    expect(target).toEqual({ kind: 'file', path: '/app/renderer/index.html' });
  });
});
