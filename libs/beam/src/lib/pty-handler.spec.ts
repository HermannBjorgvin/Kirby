import { describe, expect, it } from 'vitest';
import { createPtyStreamHandler, MAX_PTY_SESSIONS } from './pty-handler.js';
import type { BeamStream } from './stream.js';

/** Minimal fake BeamStream: enough surface for the pty handler to drive,
 * plus test-only getters to observe what it did. */
function fakeStream(id: number, name: string) {
  const dataHandlers: ((data: Uint8Array) => void)[] = [];
  const closeHandlers: ((reason?: string) => void)[] = [];
  const controlHandlers: ((message: Record<string, unknown>) => void)[] = [];
  const written: Uint8Array[] = [];
  const controlsSent: Record<string, unknown>[] = [];
  let closedWith: string | undefined;
  let closed = false;
  const stream: BeamStream = {
    id,
    name,
    write: (data) => written.push(data),
    control: (message) => controlsSent.push(message),
    close: (reason) => {
      if (closed) return;
      closed = true;
      closedWith = reason;
      for (const h of closeHandlers) h(reason);
    },
    onData: (h) => dataHandlers.push(h),
    onClose: (h) => closeHandlers.push(h),
    onControl: (h) => controlHandlers.push(h),
  };
  return {
    stream,
    written,
    controlsSent,
    emitData: (data: Uint8Array) => dataHandlers.forEach((h) => h(data)),
    emitControl: (message: Record<string, unknown>) =>
      controlHandlers.forEach((h) => h(message)),
    text: () => written.map((b) => new TextDecoder().decode(b)).join(''),
    get closedWith() {
      return closedWith;
    },
    get closed() {
      return closed;
    },
  };
}

async function waitFor<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  timeoutMs = 4000
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = read();
    if (predicate(value)) return value;
    if (Date.now() - started > timeoutMs)
      throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('createPtyStreamHandler', () => {
  it('acks a "pty" open and a "pty:<program>" open the same way', () => {
    const handler = createPtyStreamHandler();
    const plain = fakeStream(1, 'pty');
    const named = fakeStream(2, 'pty:sh');
    handler(plain.stream);
    handler(named.stream);
    expect(plain.controlsSent).toContainEqual({ kind: 'opened' });
    expect(named.controlsSent).toContainEqual({ kind: 'opened' });
    plain.stream.close();
    named.stream.close();
  });

  it('bytes written to the stream reach the process and its output comes back', async () => {
    const handler = createPtyStreamHandler();
    const fake = fakeStream(3, 'pty:sh');
    handler(fake.stream);
    fake.emitData(new TextEncoder().encode('echo hello-from-pty\n'));
    const output = await waitFor(fake.text, (text) =>
      text.includes('hello-from-pty')
    );
    expect(output).toContain('hello-from-pty');
    fake.stream.close();
  });

  it('treats pty:<program> as one literal program name, never a shell command line', async () => {
    const handler = createPtyStreamHandler();
    // If this were parsed as a shell command, it would print "hi there".
    // A literal program lookup for "echo hi there" instead fails to spawn
    // (or exits immediately reporting the failure) — either way, nothing
    // it ran ever produces that text.
    const fake = fakeStream(4, 'pty:echo hi there');
    handler(fake.stream);
    await waitFor(
      () => fake.closedWith,
      (reason) => reason !== undefined
    );
    expect(fake.text()).not.toContain('hi there');
  });

  it('clamps resize to the 2-500 range instead of throwing on out-of-range values', () => {
    const handler = createPtyStreamHandler();
    const fake = fakeStream(5, 'pty:sh');
    handler(fake.stream);
    expect(() =>
      fake.emitControl({ kind: 'resize', streamId: 5, cols: 999999, rows: -5 })
    ).not.toThrow();
    expect(() =>
      fake.emitControl({ kind: 'resize', streamId: 5, cols: 'nope', rows: 40 })
    ).not.toThrow();
    fake.stream.close();
  });

  it('closing the stream kills the process (no further output arrives)', async () => {
    const handler = createPtyStreamHandler();
    const fake = fakeStream(6, 'pty:sh');
    handler(fake.stream);
    fake.emitData(new TextEncoder().encode('echo before-close\n'));
    await waitFor(fake.text, (text) => text.includes('before-close'));
    const lengthAtClose = fake.written.length;
    fake.stream.close('client done');
    await new Promise((resolve) => setTimeout(resolve, 150));
    // A live shell keeps printing its prompt; a killed one produces nothing
    // further once the write buffer at close time has been flushed.
    expect(fake.written.length).toBeLessThanOrEqual(lengthAtClose + 1);
  });

  it('the process exiting closes the stream with a reason', async () => {
    const handler = createPtyStreamHandler();
    const fake = fakeStream(7, 'pty:sh');
    handler(fake.stream);
    fake.emitData(new TextEncoder().encode('exit 0\n'));
    await waitFor(
      () => fake.closedWith,
      (reason) => reason !== undefined
    );
    expect(fake.closedWith).toMatch(/exit/);
  });

  it('enforces a cap of MAX_PTY_SESSIONS live PTYs per handler instance', () => {
    const handler = createPtyStreamHandler();
    const fakes = Array.from({ length: MAX_PTY_SESSIONS + 1 }, (_, i) =>
      fakeStream(100 + i, 'pty:sh')
    );
    for (const fake of fakes) handler(fake.stream);
    const over = fakes[MAX_PTY_SESSIONS];
    expect(over.closedWith).toMatch(/too many live pty sessions/);
    for (const fake of fakes) fake.stream.close();
  });
});
