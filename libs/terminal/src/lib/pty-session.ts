import * as pty from 'node-pty';

export interface PtySessionOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export class PtySession {
  private process: pty.IPty;
  private disposed = false;
  private dataListeners: ((data: string) => void)[] = [];
  private exitListeners: ((code: number, signal?: number) => void)[] = [];

  constructor(cmd: string, args: string[], opts: PtySessionOptions = {}) {
    this.process = pty.spawn(cmd, args, {
      name: 'xterm-256color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: opts.cwd,
      env: opts.env ?? (process.env as Record<string, string>),
    });

    this.process.onData((data) => {
      for (const listener of this.dataListeners) {
        listener(data);
      }
    });

    this.process.onExit(({ exitCode, signal }) => {
      for (const listener of this.exitListeners) {
        listener(exitCode, signal);
      }
    });
  }

  get pid(): number {
    return this.process.pid;
  }

  get cols(): number {
    return this.process.cols;
  }

  get rows(): number {
    return this.process.rows;
  }

  onData(cb: (data: string) => void): void {
    this.dataListeners.push(cb);
  }

  offData(cb: (data: string) => void): void {
    const idx = this.dataListeners.indexOf(cb);
    if (idx >= 0) this.dataListeners.splice(idx, 1);
  }

  onExit(cb: (code: number, signal?: number) => void): void {
    this.exitListeners.push(cb);
  }

  offExit(cb: (code: number, signal?: number) => void): void {
    const idx = this.exitListeners.indexOf(cb);
    if (idx >= 0) this.exitListeners.splice(idx, 1);
  }

  write(data: string): void {
    if (!this.disposed) {
      this.process.write(data);
    }
  }

  resize(cols: number, rows: number): void {
    if (!this.disposed) {
      this.process.resize(cols, rows);
    }
  }

  kill(signal?: string): void {
    if (!this.disposed) {
      this.process.kill(signal);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.process.kill();
    } catch {
      // Process may have already exited
    }
    // Clear data listeners but keep exit listeners so onExit still fires
    this.dataListeners = [];
  }
}
