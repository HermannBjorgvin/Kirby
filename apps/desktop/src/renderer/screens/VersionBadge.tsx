import { useEffect, useState } from 'react';
import type { KirbyVersionInfo } from '../../host/contract.js';

/**
 * Tiny always-visible build stamp: proves which bundle is actually
 * rendering (version comes from the launcher's package.json). If this
 * number doesn't match the repo after an install, the wrong build is
 * running.
 */
export function VersionBadge() {
  const [info, setInfo] = useState<KirbyVersionInfo | null>(null);

  useEffect(() => {
    window.kirby
      .getVersion()
      .then(setInfo)
      .catch(() => null);
  }, []);

  return (
    <span className="pointer-events-none fixed bottom-1 right-2 font-mono text-[9px] text-slate-700">
      kirby-desktop {info?.app ?? '?'}
    </span>
  );
}
