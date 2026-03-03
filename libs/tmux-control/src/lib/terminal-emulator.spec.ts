import { describe, it, expect } from 'vitest';
import { TerminalEmulator } from './terminal-emulator.js';
import { PtySession } from './pty-session.js';

describe('TerminalEmulator', () => {
  it('renders written text', async () => {
    const emu = new TerminalEmulator(80, 24);
    await emu.write('hello world');
    expect(emu.render()).toContain('hello world');
    emu.dispose();
  });

  it('handles cursor movement sequences', async () => {
    const emu = new TerminalEmulator(80, 24);
    await emu.write('line1\r\nline2\r\nline3');
    const output = emu.render();
    expect(output).toContain('line1');
    expect(output).toContain('line2');
    expect(output).toContain('line3');
    emu.dispose();
  });

  it('handles ANSI color codes without corrupting text', async () => {
    const emu = new TerminalEmulator(80, 24);
    await emu.write('\x1b[32mgreen\x1b[0m normal');
    // translateToString strips ANSI — just the text
    expect(emu.render()).toContain('green normal');
    emu.dispose();
  });

  it('resize changes dimensions', async () => {
    const emu = new TerminalEmulator(80, 24);
    emu.resize(120, 40);
    // Write a long line that fits in 120 cols but would wrap in 80
    const longLine = 'A'.repeat(100);
    await emu.write(longLine);
    const rendered = emu.render();
    // Should be on one line (no wrapping at 80)
    expect(rendered).toBe(longLine);
    emu.dispose();
  });

  it('fires onRender callback after write', async () => {
    const emu = new TerminalEmulator(80, 24);
    let renderCount = 0;
    emu.onRender(() => renderCount++);
    await emu.write('test');
    expect(renderCount).toBeGreaterThan(0);
    emu.dispose();
  });

  it('dispose is safe to call multiple times', () => {
    const emu = new TerminalEmulator(80, 24);
    emu.dispose();
    expect(() => emu.dispose()).not.toThrow();
  });
});

describe('PTY → TerminalEmulator integration', () => {
  it('renders PTY output through emulator', async () => {
    const pty = new PtySession('echo', ['hello from pty'], {
      cols: 80,
      rows: 24,
    });
    const emu = new TerminalEmulator(80, 24);

    await new Promise<void>((resolve) => {
      pty.onData(async (data) => {
        await emu.write(data);
      });
      pty.onExit(() => {
        // Small delay to let final writes flush
        setTimeout(resolve, 50);
      });
    });

    const rendered = emu.render();
    expect(rendered).toContain('hello from pty');

    pty.dispose();
    emu.dispose();
  });

  it('handles interactive PTY input/output cycle', async () => {
    const pty = new PtySession('cat', [], { cols: 80, rows: 24 });
    const emu = new TerminalEmulator(80, 24);

    pty.onData(async (data) => {
      await emu.write(data);
    });

    // Wait for cat to start
    await new Promise((r) => setTimeout(r, 100));

    pty.write('interactive test\n');

    // Wait for echo + output
    await new Promise((r) => setTimeout(r, 200));

    const rendered = emu.render();
    expect(rendered).toContain('interactive test');

    pty.dispose();
    emu.dispose();
  });
});
