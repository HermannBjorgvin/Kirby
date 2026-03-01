import { useState } from 'react';
import type { ActiveTab } from '../types.js';
import type { Focus } from '../input-handlers.js';

export function useNavigation() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('sessions');
  const [focus, setFocus] = useState<Focus>('sidebar');

  return {
    activeTab,
    setActiveTab,
    focus,
    setFocus,
  };
}
