import { useState, useEffect, useRef } from 'react';

const DEBOUNCE_MS = 500;

export function useTerminalDimensions(): { rows: number; cols: number } {
  const [dimensions, setDimensions] = useState({
    rows: process.stdout.rows ?? 24,
    cols: process.stdout.columns ?? 80,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!process.stdout.isTTY) return;

    const onResize = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const rows = process.stdout.rows ?? 24;
        const cols = process.stdout.columns ?? 80;
        setDimensions((prev) => {
          if (prev.rows === rows && prev.cols === cols) return prev;
          return { rows, cols };
        });
      }, DEBOUNCE_MS);
    };

    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return dimensions;
}
