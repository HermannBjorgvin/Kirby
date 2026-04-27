import { describe, it, expect } from 'vitest';
import { TerminalEmulator } from './terminal-emulator.js';

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

  it('preserves ANSI color codes in rendered output', async () => {
    const emu = new TerminalEmulator(80, 24);
    await emu.write('\x1b[32mgreen\x1b[0m normal');
    const rendered = emu.render();
    // Text content is present
    expect(rendered).toContain('green');
    expect(rendered).toContain('normal');
    // SGR for green (palette color 2 → code 32) is present
    expect(rendered).toContain('\x1b[32m');
    // Reset is present
    expect(rendered).toContain('\x1b[0m');
    emu.dispose();
  });

  it('renders 256-color palette codes', async () => {
    const emu = new TerminalEmulator(80, 24);
    await emu.write('\x1b[38;5;208morange\x1b[0m');
    const rendered = emu.render();
    expect(rendered).toContain('orange');
    expect(rendered).toContain('38;5;208');
    emu.dispose();
  });

  it('renders RGB true color codes', async () => {
    const emu = new TerminalEmulator(80, 24);
    await emu.write('\x1b[38;2;255;128;0mtrue\x1b[0m');
    const rendered = emu.render();
    expect(rendered).toContain('true');
    expect(rendered).toContain('38;2;255;128;0');
    emu.dispose();
  });

  it('renders bold and other text styles', async () => {
    const emu = new TerminalEmulator(80, 24);
    await emu.write('\x1b[1mbold\x1b[0m \x1b[3mitalic\x1b[0m');
    const rendered = emu.render();
    expect(rendered).toContain('bold');
    expect(rendered).toContain('italic');
    // Bold SGR code 1 should appear
    // eslint-disable-next-line no-control-regex
    expect(rendered).toMatch(/\x1b\[\d*1\d*m/);
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
