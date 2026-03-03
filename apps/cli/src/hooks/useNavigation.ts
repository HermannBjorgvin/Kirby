import { useState } from 'react';
import type { ActiveTab, Focus } from '../types.js';

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
