import { useEffect, useState } from 'react';
import type { KirbyHostApi, KirbyVersionInfo } from '../host/contract.js';

declare global {
  interface Window {
    kirby: KirbyHostApi;
  }
}

/**
 * Phase-4 shell page: proves the Electron shell boots, the renderer
 * mounts, Tailwind styles apply, and the preload bridge answers IPC.
 * Replaced by the real app layout in Phase 5.
 */
export function App() {
  const [version, setVersion] = useState<KirbyVersionInfo | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  useEffect(() => {
    window.kirby
      .getVersion()
      .then(setVersion)
      .catch((err: unknown) =>
        setBridgeError(err instanceof Error ? err.message : String(err))
      );
  }, []);

  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-100">
        Kirby Desktop
      </h1>
      {version ? (
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 font-mono text-sm text-slate-400">
          <dt>app</dt>
          <dd className="text-slate-200">{version.app}</dd>
          <dt>electron</dt>
          <dd className="text-slate-200">{version.electron}</dd>
          <dt>node</dt>
          <dd className="text-slate-200">{version.node}</dd>
          <dt>chrome</dt>
          <dd className="text-slate-200">{version.chrome}</dd>
        </dl>
      ) : bridgeError ? (
        <p className="font-mono text-sm text-red-400">
          bridge error: {bridgeError}
        </p>
      ) : (
        <p className="animate-pulse font-mono text-sm text-slate-500">
          connecting to host…
        </p>
      )}
    </main>
  );
}
