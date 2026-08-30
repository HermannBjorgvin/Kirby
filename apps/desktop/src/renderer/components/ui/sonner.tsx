import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useTheme } from '../../lib/theme.js';

function Toaster(props: ToasterProps) {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      position="bottom-right"
      offset={32}
      toastOptions={{
        classNames: {
          toast:
            '!bg-popover !text-popover-foreground !border-border !shadow-lg !text-base',
          description: '!text-muted-foreground',
        },
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
