import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.js';

function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      spellCheck={false}
      className={cn(
        'flex h-7 w-full min-w-0 rounded-md border border-input bg-background px-2.5 py-1 text-base text-foreground shadow-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export { Input };
