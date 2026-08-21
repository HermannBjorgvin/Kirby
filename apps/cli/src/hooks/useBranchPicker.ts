import { useState } from 'react';

export function useBranchPicker() {
  const [creating, setCreating] = useState(false);
  const [branchFilter, setBranchFilter] = useState('');
  const [branchIndex, setBranchIndex] = useState(0);
  const [branches, setBranches] = useState<string[]>([]);
  // Per-session agent override for the picker. Index into the agent
  // options list built from the active config (see buildAgentOptions
  // in branch-picker-input). Reset whenever the picker closes.
  const [agentIndex, setAgentIndex] = useState(0);

  return {
    creating,
    setCreating,
    branchFilter,
    setBranchFilter,
    branchIndex,
    setBranchIndex,
    branches,
    setBranches,
    agentIndex,
    setAgentIndex,
  };
}
