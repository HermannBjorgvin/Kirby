import { useState } from 'react';
import type { Focus } from '../types.js';

export function useNavigation() {
  const [focus, setFocus] = useState<Focus>('sidebar');

  return {
    focus,
    setFocus,
  };
}
