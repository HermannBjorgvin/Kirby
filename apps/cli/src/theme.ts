// Visual constants shared by Pane and any component that needs to match
// the active/inactive focus colors. Plain module export — no React context,
// no hook churn. Contexts are for mutable state; constants belong in modules.

export const theme = {
  border: {
    style: 'round' as const,
    active: 'cyan' as const,
    inactive: 'gray' as const,
  },
} as const;
