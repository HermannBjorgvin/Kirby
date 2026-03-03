import xtermHeadless from '@xterm/headless';

const { Terminal } = xtermHeadless;

export class TerminalEmulator {
  private terminal: InstanceType<typeof Terminal>;
  private renderListeners: Array<() => void> = [];
  private disposed = false;

  constructor(cols = 80, rows = 24) {
    this.terminal = new Terminal({
      cols,
      rows,
      allowProposedApi: true,
    });
  }

  write(data: string): Promise<void> {
    return new Promise((resolve) => {
      this.terminal.write(data, resolve);
    });
  }

  render(scrollOffset = 0): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    const start = Math.max(0, buffer.baseY - scrollOffset);

    for (let i = start; i < start + this.terminal.rows; i++) {
      const line = buffer.getLine(i);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }

    // Trim trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    return lines.join('\n');
  }

  get maxScrollback(): number {
    return this.terminal.buffer.active.baseY;
  }

  get mouseTrackingMode(): 'none' | 'x10' | 'vt200' | 'drag' | 'any' {
    return this.terminal.modes.mouseTrackingMode;
  }

  resize(cols: number, rows: number): void {
    if (!this.disposed) {
      this.terminal.resize(cols, rows);
    }
  }

  onRender(cb: () => void): void {
    this.renderListeners.push(cb);
    this.terminal.onWriteParsed(() => {
      cb();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.terminal.dispose();
    this.renderListeners = [];
  }
}
