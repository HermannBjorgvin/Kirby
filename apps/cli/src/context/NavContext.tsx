import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Focus } from '../types.js';

// Split navigation state into a state context (re-renders on focus
// change — needed by components that style themselves differently when
// a pane is active) and an actions context (stable setFocus, used from
// input handlers).

export interface NavStateValue {
  focus: Focus;
}

export interface NavActionsValue {
  setFocus: React.Dispatch<React.SetStateAction<Focus>>;
}

export type NavValue = NavStateValue & NavActionsValue;

const NavStateContext = createContext<NavStateValue | null>(null);
const NavActionsContext = createContext<NavActionsValue | null>(null);

export function NavProvider({ children }: { children: ReactNode }) {
  const [focus, setFocus] = useState<Focus>('sidebar');

  const stateValue = useMemo<NavStateValue>(() => ({ focus }), [focus]);
  const actionsValue = useMemo<NavActionsValue>(() => ({ setFocus }), []);

  return (
    <NavStateContext.Provider value={stateValue}>
      <NavActionsContext.Provider value={actionsValue}>
        {children}
      </NavActionsContext.Provider>
    </NavStateContext.Provider>
  );
}

export function useNavState(): NavStateValue {
  const ctx = useContext(NavStateContext);
  if (!ctx) throw new Error('useNavState must be used within NavProvider');
  return ctx;
}

export function useNavActions(): NavActionsValue {
  const ctx = useContext(NavActionsContext);
  if (!ctx) throw new Error('useNavActions must be used within NavProvider');
  return ctx;
}
