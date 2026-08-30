import { useState } from 'react';
import type { Focus } from '@kirby/core';

export function useNavigation() {
  const [focus, setFocus] = useState<Focus>('sidebar');

  return {
    focus,
    setFocus,
  };
}
