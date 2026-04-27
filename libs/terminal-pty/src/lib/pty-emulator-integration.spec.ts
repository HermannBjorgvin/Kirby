import { describe, it, expect } from 'vitest';
import { TerminalEmulator } from '@kirby/terminal';
import { PtySession } from './pty-session.js';

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
