import { useMutation, useQueryClient } from '@tanstack/react-query';
import { keys } from './query-keys.js';

/**
 * The renderer's babysit writes — start and stop watching a pull
 * request. Split from `mutations.ts`, which is a catalogue already.
 */

// A babysat pull request's status rides on its sidebar item, so the
// row's badge appears — and goes — with the sidebar's refetch.
export function useStartBabysit(cwd: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prId: number) => window.kirby.startBabysit(prId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.sidebar(cwd) });
    },
  });
}

export function useStopBabysit(cwd: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prId: number) => window.kirby.stopBabysit(prId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.sidebar(cwd) });
    },
  });
}
