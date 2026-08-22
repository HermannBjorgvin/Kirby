import { useState } from 'react';

export function useBranchPicker() {
  const [creating, setCreating] = useState(false);
  const [branchFilter, setBranchFilter] = useState('');
  const [branchIndex, setBranchIndex] = useState(0);
  const [branches, setBranches] = useState<string[]>([]);

  return {
    creating,
    setCreating,
    branchFilter,
    setBranchFilter,
    branchIndex,
    setBranchIndex,
    branches,
    setBranches,
  };
}
