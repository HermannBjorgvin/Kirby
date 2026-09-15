import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalEmulator, type SessionBackend } from '@kirby/terminal';
import {
  __resetForTests,
  attach,
  noteInput,
  noteResize,
  snapshot,
} from './activity.js';
import {
  ACTIVITY_IDLE_MS,
  INPUT_ECHO_MS,
  RESIZE_ECHO_MS,
} from './activity-config.js';

describe('activity from parsed terminal frames', () => {
  let emulator: TerminalEmulator;
  let now: number;
  let data: (chunk: string) => void;
  let exit: () => void;
  beforeEach(() => {
    __resetForTests();
    now = 10000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    emulator = new TerminalEmulator(40, 5);
    const pty = {
      onData: (cb: typeof data) => {
        data = cb;
      },
      offData: vi.fn(),
      onExit: (cb: typeof exit) => {
        exit = cb;
      },
      offExit: vi.fn(),
    } as unknown as SessionBackend;
    attach('render', pty, emulator);
  });
  afterEach(() => {
    __resetForTests();
    emulator.dispose();
    vi.restoreAllMocks();
  });
  async function output(chunk: string) {
    data(chunk);
    await emulator.write(chunk);
  }
  it('ignores cursor controls and a replayed frame but counts new content', async () => {
    await output('agent ready');
    expect(snapshot('render').active).toBe(true);
    now += ACTIVITY_IDLE_MS + 1;
    await output('\x1b[?25l\x1b[?12l\x1b[?25h');
    expect(snapshot('render').active).toBe(false);
    await output('\x1b[H\x1b[2Jagent ready');
    expect(snapshot('render').active).toBe(false);
    await output('\r\nworking');
    expect(snapshot('render').active).toBe(true);
    exit();
    expect(snapshot('render').exited).toBe(true);
  });
  it('updates the comparison frame during input and resize suppression', async () => {
    noteInput('render');
    await output('echo of input');
    expect(snapshot('render').active).toBe(false);
    now += INPUT_ECHO_MS + 1;
    await output('\x1b[H\x1b[2Jecho of input');
    expect(snapshot('render').active).toBe(false);
    noteResize('render');
    emulator.resize(60, 5);
    await output('\x1b[H\x1b[2Jresized prompt');
    now += RESIZE_ECHO_MS + 1;
    await output('\x1b[H\x1b[2Jresized prompt');
    expect(snapshot('render').active).toBe(false);
    await output('\r\nnew work');
    expect(snapshot('render').active).toBe(true);
  });
});
