import { describe, it, expect } from 'vitest';
import { PtySession } from './pty-session.js';

describe('PtySession', () => {
  it('receives output from spawned process', async () => {
    const session = new PtySession('echo', ['hello']);
    const chunks: string[] = [];

    await new Promise<void>((resolve) => {
      session.onData((data) => chunks.push(data));
      session.onExit(() => resolve());
    });

    const output = chunks.join('');
    expect(output).toContain('hello');
    session.dispose();
  });

  it('fires onExit when process exits', async () => {
    const session = new PtySession('true', []);

    const { code } = await new Promise<{ code: number }>((resolve) => {
      session.onExit((exitCode) => resolve({ code: exitCode }));
    });

    expect(code).toBe(0);
    session.dispose();
  });

  it('writes data to process stdin', async () => {
    const session = new PtySession('cat', []);
    const chunks: string[] = [];

    session.onData((data) => chunks.push(data));

    // Wait a tick for the process to start
    await new Promise((r) => setTimeout(r, 100));

    session.write('test input\n');

    // Wait for echo back
    await new Promise((r) => setTimeout(r, 200));

    const output = chunks.join('');
    // cat echoes input back (PTY echo) and then prints it again
    expect(output).toContain('test input');
    session.dispose();
  });

  it('resize does not throw', () => {
    const session = new PtySession('cat', []);
    expect(() => session.resize(120, 40)).not.toThrow();
    session.dispose();
  });

  it('exposes pid, cols, and rows', () => {
    const session = new PtySession('cat', [], { cols: 100, rows: 30 });
    expect(session.pid).toBeGreaterThan(0);
    expect(session.cols).toBe(100);
    expect(session.rows).toBe(30);
    session.dispose();
  });

  it('dispose kills the process', async () => {
    const session = new PtySession('cat', []);
    const exited = new Promise<void>((resolve) => {
      session.onExit(() => resolve());
    });

    session.dispose();
    // Should resolve within a reasonable time
    await Promise.race([
      exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('process did not exit')), 3000)
      ),
    ]);
  });

  it('write after dispose is a no-op', () => {
    const session = new PtySession('cat', []);
    session.dispose();
    expect(() => session.write('data')).not.toThrow();
  });
});
