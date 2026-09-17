import { useState } from 'react';
import type { Focus } from '@n10/core';

export function useNavigation() {
  const [focus, setFocus] = useState<Focus>('sidebar');

  return {
    focus,
    setFocus,
  };
}
