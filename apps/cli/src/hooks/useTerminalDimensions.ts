import { useState, useEffect } from 'react';

export function useTerminalDimensions(): { rows: number; cols: number } {
  const [dimensions, setDimensions] = useState({
    rows: process.stdout.rows ?? 24,
    cols: process.stdout.columns ?? 80,
  });

  useEffect(() => {
    if (!process.stdout.isTTY) return;

    const onResize = () => {
      const rows = process.stdout.rows ?? 24;
      const cols = process.stdout.columns ?? 80;
      setDimensions((prev) => {
        if (prev.rows === rows && prev.cols === cols) return prev;
        return { rows, cols };
      });
    };

    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);

  return dimensions;
}
