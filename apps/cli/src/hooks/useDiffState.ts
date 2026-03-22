import { useState } from 'react';

export function useDiffState() {
  const [diffFileIndex, setDiffFileIndex] = useState(0);
  const [diffViewFile, setDiffViewFile] = useState<string | null>(null);
  const [diffScrollOffset, setDiffScrollOffset] = useState(0);
  const [showSkipped, setShowSkipped] = useState(false);

  return {
    diffFileIndex,
    setDiffFileIndex,
    diffViewFile,
    setDiffViewFile,
    diffScrollOffset,
    setDiffScrollOffset,
    showSkipped,
    setShowSkipped,
  };
}
