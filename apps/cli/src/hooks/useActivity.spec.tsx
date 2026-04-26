import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Text, Box } from 'ink';
import { render } from 'ink-testing-library';
import type { PtySession } from '@kirby/terminal';
import { attach, __resetForTests as resetActivity } from '../activity.js';
import { ACTIVITY_IDLE_MS } from '../activity-config.js';
import { RainbowSpinner } from '../components/RainbowSpinner.js';
import {
  useActivityStatus,
  useSpinnerFrame,
  __resetForTests as resetHooks,
  __timerActiveForTests,
  __subscriberCountForTests,
} from './useActivity.js';

class MockPty {
  private dataCb: ((s: string) => void) | null = null;
  private exitCb: ((c: number) => void) | null = null;
  onData = vi.fn((cb: (s: string) => void) => {
    this.dataCb = cb;
  });
  offData = vi.fn(() => {
    this.dataCb = null;
  });
  onExit = vi.fn((cb: (c: number) => void) => {
    this.exitCb = cb;
  });
  offExit = vi.fn(() => {
    this.exitCb = null;
  });
  emit(data: string) {
    this.dataCb?.(data);
  }
  asPty(): PtySession {
    return this as unknown as PtySession;
  }
}

function SpinnerHarness() {
  const f = useSpinnerFrame();
  return <Text>{`${f.frame}:${f.colorIndex}`}</Text>;
}

// Mirrors the Sidebar's render logic for active sessions: mounts a
// RainbowSpinner when useActivityStatus reports active. Used to verify
// the end-to-end "spinner disappears when the session goes idle"
// behavior that the hook alone can't prove. The `_` placeholder stands
// in where the spinner isn't mounted so the column is detectable (Ink
// trims trailing whitespace from rendered frames).
function RowHarness({ name }: { name: string }) {
  const s = useActivityStatus(name);
  return (
    <Box>
      {s.active ? <RainbowSpinner /> : <Text>_</Text>}
      <Text>{`|${s.active ? 'A' : '-'}${s.flashing ? 'F' : '-'}`}</Text>
    </Box>
  );
}

// Yield once so ink flushes useEffect + any setState-triggered re-render
// into `lastFrame()`.
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('useActivity shared ticker', () => {
  beforeEach(() => {
    resetActivity();
    resetHooks();
  });

  afterEach(() => {
    resetActivity();
    resetHooks();
  });

  it('starts the ticker when the first subscriber mounts and stops it when the last unmounts', async () => {
    expect(__timerActiveForTests()).toBe(false);
    expect(__subscriberCountForTests()).toBe(0);

    const h = render(<SpinnerHarness />);
    await flush();
    expect(__timerActiveForTests()).toBe(true);
    expect(__subscriberCountForTests()).toBe(1);

    h.unmount();
    await flush();
    expect(__timerActiveForTests()).toBe(false);
    expect(__subscriberCountForTests()).toBe(0);
  });

  it('shares one ticker across multiple subscribers', async () => {
    const a = render(<SpinnerHarness />);
    const b = render(<SpinnerHarness />);
    await flush();

    expect(__timerActiveForTests()).toBe(true);
    expect(__subscriberCountForTests()).toBe(2);

    a.unmount();
    await flush();
    expect(__timerActiveForTests()).toBe(true);
    expect(__subscriberCountForTests()).toBe(1);

    b.unmount();
    await flush();
    expect(__timerActiveForTests()).toBe(false);
    expect(__subscriberCountForTests()).toBe(0);
  });
});

describe('spinner mounts and unmounts with activity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetActivity();
    resetHooks();
  });

  afterEach(() => {
    resetActivity();
    resetHooks();
    vi.useRealTimers();
  });

  it('renders the spinner while active and clears it after the session goes idle', async () => {
    const pty = new MockPty();
    attach('s1', pty.asPty());

    pty.emit('xxxx');
    const h = render(<RowHarness name="s1" />);
    // Flush ink's render scheduler + any pending microtasks so the
    // initial compute() result is reflected in lastFrame().
    await vi.advanceTimersByTimeAsync(100);
    const activeFrame = h.lastFrame() ?? '';
    expect(activeFrame).toContain('|A-');
    expect(activeFrame).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);

    await vi.advanceTimersByTimeAsync(ACTIVITY_IDLE_MS + 100);
    const idleFrame = h.lastFrame() ?? '';
    expect(idleFrame).toContain('_|--');
    expect(idleFrame).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);

    h.unmount();
  });
});
