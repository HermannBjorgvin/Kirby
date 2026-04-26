import { describe, expect, it, vi } from 'vitest';
import {
  processStdinChunk,
  type StdinChunkContext,
} from './useRawStdinForward.js';

function makeCtx(
  overrides: Partial<StdinChunkContext> = {}
): StdinChunkContext & {
  write: ReturnType<typeof vi.fn>;
  onEscape: ReturnType<typeof vi.fn>;
  onScrollUp: ReturnType<typeof vi.fn>;
  onScrollDown: ReturnType<typeof vi.fn>;
} {
  return {
    write: vi.fn(),
    onEscape: vi.fn(),
    mouseMode: 'none',
    onScrollUp: vi.fn(),
    onScrollDown: vi.fn(),
    ...overrides,
  } as StdinChunkContext & {
    write: ReturnType<typeof vi.fn>;
    onEscape: ReturnType<typeof vi.fn>;
    onScrollUp: ReturnType<typeof vi.fn>;
    onScrollDown: ReturnType<typeof vi.fn>;
  };
}

describe('processStdinChunk', () => {
  it('forwards plain typed bytes to the PTY', () => {
    const ctx = makeCtx();
    processStdinChunk('abc', ctx);
    expect(ctx.write).toHaveBeenCalledExactlyOnceWith('abc');
    expect(ctx.onEscape).not.toHaveBeenCalled();
  });

  it('triggers escape on a stand-alone NUL', () => {
    const ctx = makeCtx();
    processStdinChunk('\x00', ctx);
    expect(ctx.onEscape).toHaveBeenCalledOnce();
    expect(ctx.write).not.toHaveBeenCalled();
  });

  it('triggers escape and drops the suffix when NUL leads a chunk', () => {
    // Reproduces the CI race: under load, the WS sends \x00 and the
    // next keystroke ('c') bunch into a single stdin event. The escape
    // must still fire and the 'c' must NOT leak into the agent PTY.
    const ctx = makeCtx();
    processStdinChunk('\x00c', ctx);
    expect(ctx.onEscape).toHaveBeenCalledOnce();
    expect(ctx.write).not.toHaveBeenCalled();
  });

  it('forwards the prefix and then escapes when NUL ends a chunk', () => {
    // 'abc' was real typing the user wants the agent to see; the
    // trailing \x00 means "now switch back to the sidebar." Both halves
    // must land.
    const ctx = makeCtx();
    processStdinChunk('abc\x00', ctx);
    expect(ctx.write).toHaveBeenCalledExactlyOnceWith('abc');
    expect(ctx.onEscape).toHaveBeenCalledOnce();
  });

  it('forwards the prefix, escapes, and drops the suffix when NUL is mid-chunk', () => {
    const ctx = makeCtx();
    processStdinChunk('a\x00b', ctx);
    expect(ctx.write).toHaveBeenCalledExactlyOnceWith('a');
    expect(ctx.onEscape).toHaveBeenCalledOnce();
  });

  it('forwards everything raw when the child has enabled mouse tracking', () => {
    const ctx = makeCtx({ mouseMode: 'any' });
    processStdinChunk('\x1b[<0;10;5M', ctx);
    expect(ctx.write).toHaveBeenCalledExactlyOnceWith('\x1b[<0;10;5M');
    expect(ctx.onScrollUp).not.toHaveBeenCalled();
  });

  it('intercepts scroll-up SGR mouse events when child has not enabled mouse', () => {
    const ctx = makeCtx();
    processStdinChunk('\x1b[<64;10;5M', ctx);
    expect(ctx.onScrollUp).toHaveBeenCalledOnce();
    expect(ctx.write).not.toHaveBeenCalled();
  });

  it('intercepts scroll-down SGR mouse events when child has not enabled mouse', () => {
    const ctx = makeCtx();
    processStdinChunk('\x1b[<65;10;5M', ctx);
    expect(ctx.onScrollDown).toHaveBeenCalledOnce();
    expect(ctx.write).not.toHaveBeenCalled();
  });

  it('drops non-scroll mouse events but forwards interleaved typing', () => {
    // Click event (button 0) sandwiched between two real keystrokes —
    // the click is dropped, the typing reaches the PTY as one chunk.
    const ctx = makeCtx();
    processStdinChunk('a\x1b[<0;10;5Mb', ctx);
    expect(ctx.write).toHaveBeenCalledExactlyOnceWith('ab');
  });
});
