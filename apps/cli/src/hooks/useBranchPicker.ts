import { useState } from 'react';

export function useBranchPicker() {
  const [creating, setCreating] = useState(false);
  const [branchFilter, setBranchFilter] = useState('');
  const [branchIndex, setBranchIndex] = useState(0);
  const [branches, setBranches] = useState<string[]>([]);
  // Second stage: a branch was picked and a beam host is configured,
  // so the picker asks where the session should live. Null skips the
  // stage entirely — the picker behaves exactly as before.
  const [locationBranch, setLocationBranch] = useState<string | null>(null);
  const [locationIndex, setLocationIndex] = useState(0);

  return {
    creating,
    setCreating,
    branchFilter,
    setBranchFilter,
    branchIndex,
    setBranchIndex,
    branches,
    setBranches,
    locationBranch,
    setLocationBranch,
    locationIndex,
    setLocationIndex,
  };
}
