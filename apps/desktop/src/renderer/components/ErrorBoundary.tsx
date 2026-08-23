import { AlertTriangleIcon, RotateCcwIcon } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { Button } from './ui/button.js';

interface Props {
  children: ReactNode;
  /** Changing this resets the boundary (e.g. the active tab id). */
  resetKey?: string;
  label?: string;
}
interface State {
  error: Error | null;
}

/** Keeps one crashing tab/pane from blanking the whole window. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangleIcon className="size-8 text-warning" />
        <div>
          <p className="font-medium">
            {this.props.label ?? 'Something went wrong rendering this view.'}
          </p>
          <p className="mx-auto mt-1 max-w-md font-mono text-sm text-muted-foreground">
            {this.state.error.message}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => this.setState({ error: null })}
        >
          <RotateCcwIcon /> Try again
        </Button>
      </div>
    );
  }
}
