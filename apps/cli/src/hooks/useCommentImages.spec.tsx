import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { Text } from 'ink';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import { useCommentImages } from './useCommentImages.js';

vi.mock('@kirby/image-loader', () => ({
  fetchImageBytes: vi.fn(),
  decodeImage: vi.fn(),
  decodeGifAnimation: vi.fn(() => null),
}));
vi.mock('../utils/gh-token.js', () => ({
  getGhToken: vi.fn(async () => null),
}));

import {
  fetchImageBytes,
  decodeImage,
  decodeGifAnimation,
} from '@kirby/image-loader';

const URL = 'https://x/shot.png';

function thread(body: string): RemoteCommentThread {
  return {
    id: 't1',
    file: null,
    lineStart: null,
    lineEnd: null,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    canResolve: false,
    comments: [
      { id: 'c0', author: 'a', body, createdAt: '2026-01-01T00:00:00Z' },
    ],
  };
}

function Probe({
  threads,
  animationsActive = true,
}: {
  threads: RemoteCommentThread[];
  animationsActive?: boolean;
}) {
  const value = useCommentImages(threads, 40, {}, animationsActive);
  const parts = [...value.images.entries()].map(
    ([url, s]) => `${url}=${s.status}${s.id ? `#${s.id}` : ''}`
  );
  return <Text>{`[${value.enabled ? 'on' : 'off'}] ${parts.join('|')}`}</Text>;
}

const flush = () => new Promise((r) => setTimeout(r, 20));

let writes: string[];
let writeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env['KIRBY_IMAGES'] = 'kitty';
  writes = [];
  writeSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
});

afterEach(() => {
  cleanup();
  writeSpy.mockRestore();
  delete process.env['KIRBY_IMAGES'];
  vi.clearAllMocks();
});

describe('useCommentImages', () => {
  it('fetches, decodes, transmits once, and reports ready', async () => {
    vi.mocked(fetchImageBytes).mockResolvedValue(new Uint8Array([1]));
    vi.mocked(decodeImage).mockResolvedValue({
      format: 'png',
      width: 100,
      height: 50,
      png: new Uint8Array([1, 2, 3]),
    });

    const { lastFrame, rerender } = render(
      <Probe threads={[thread(`![s](${URL})`)]} />
    );
    await flush();
    expect(lastFrame()).toContain(`${URL}=ready#1`);

    const transmit = writes.find((w) => w.startsWith('\x1b_G'));
    expect(transmit).toBeDefined();
    expect(transmit).toContain('q=2,f=100,i=1');
    expect(transmit).toContain('U=1');

    // A rerender with the same threads must not retransmit
    const before = writes.filter((w) => w.startsWith('\x1b_G')).length;
    rerender(<Probe threads={[thread(`![s](${URL})`)]} />);
    await flush();
    expect(writes.filter((w) => w.startsWith('\x1b_G')).length).toBe(before);
  });

  it('marks failed downloads and emits nothing', async () => {
    vi.mocked(fetchImageBytes).mockRejectedValue(new Error('404'));

    const { lastFrame } = render(<Probe threads={[thread(`![s](${URL})`)]} />);
    await flush();
    expect(lastFrame()).toContain(`${URL}=failed`);
    expect(writes.find((w) => w.startsWith('\x1b_G'))).toBeUndefined();
  });

  it('is inert when kitty graphics is off', async () => {
    process.env['KIRBY_IMAGES'] = 'off';
    const { lastFrame } = render(<Probe threads={[thread(`![s](${URL})`)]} />);
    await flush();
    expect(lastFrame()).toContain('[off]');
    expect(vi.mocked(fetchImageBytes)).not.toHaveBeenCalled();
  });

  it('deletes transmitted images on unmount', async () => {
    vi.mocked(fetchImageBytes).mockResolvedValue(new Uint8Array([1]));
    vi.mocked(decodeImage).mockResolvedValue({
      format: 'png',
      width: 10,
      height: 10,
      png: new Uint8Array([1]),
    });
    const { unmount } = render(<Probe threads={[thread(`![s](${URL})`)]} />);
    await flush();
    unmount();
    expect(writes).toContain('\x1b_Ga=d,d=I,i=1\x1b\\');
  });
});

describe('useCommentImages — GIF playback', () => {
  const GIF_URL = 'https://x/anim.gif';
  const gifThread = () => thread(`![g](${GIF_URL})`);

  function mockAnimatedGif() {
    vi.mocked(fetchImageBytes).mockResolvedValue(new Uint8Array([1]));
    vi.mocked(decodeImage).mockResolvedValue({
      format: 'gif',
      width: 2,
      height: 1,
      rgba: new Uint8Array(8),
    });
    vi.mocked(decodeGifAnimation).mockReturnValue({
      width: 2,
      height: 1,
      frames: [
        { rgba: new Uint8Array(8).fill(1), delayMs: 100 },
        { rgba: new Uint8Array(8).fill(2), delayMs: 100 },
      ],
    });
  }

  it('client-driven playback retransmits frames on a timer (ghostty path)', async () => {
    mockAnimatedGif();
    const { lastFrame } = render(<Probe threads={[gifThread()]} />);
    await flush();
    expect(lastFrame()).toContain(`${GIF_URL}=ready#1`);
    const before = writes.filter((w) => w.includes('a=T')).length;

    // Two frame periods later, at least two retransmissions happened.
    await new Promise((r) => setTimeout(r, 250));
    const after = writes.filter((w) => w.includes('a=T')).length;
    expect(after).toBeGreaterThanOrEqual(before + 2);
  });

  it('pauses client-driven playback while reviews panes are hidden', async () => {
    mockAnimatedGif();
    render(<Probe threads={[gifThread()]} animationsActive={false} />);
    await flush();
    const before = writes.filter((w) => w.includes('a=T')).length;
    await new Promise((r) => setTimeout(r, 250));
    expect(writes.filter((w) => w.includes('a=T')).length).toBe(before);
  });

  it('uses terminal-driven animation in kitty (a=f frames + loop)', async () => {
    // Fully control the terminal identity — the test process itself
    // may run inside ghostty, whose TERM_PROGRAM would veto native
    // animation support.
    const saved = {
      TERM: process.env['TERM'],
      TERM_PROGRAM: process.env['TERM_PROGRAM'],
    };
    process.env['TERM'] = 'xterm-kitty';
    delete process.env['TERM_PROGRAM'];
    try {
      mockAnimatedGif();
      const { lastFrame } = render(<Probe threads={[gifThread()]} />);
      await flush();
      expect(lastFrame()).toContain(`${GIF_URL}=ready#1`);
      expect(writes.some((w) => w.includes('a=f'))).toBe(true);
      expect(writes).toContain('\x1b_Gq=2,a=a,i=1,s=3,v=1\x1b\\');
      // No client-driven retransmissions.
      const before = writes.filter((w) => w.includes('a=T')).length;
      await new Promise((r) => setTimeout(r, 250));
      expect(writes.filter((w) => w.includes('a=T')).length).toBe(before);
    } finally {
      if (saved.TERM === undefined) delete process.env['TERM'];
      else process.env['TERM'] = saved.TERM;
      if (saved.TERM_PROGRAM === undefined) delete process.env['TERM_PROGRAM'];
      else process.env['TERM_PROGRAM'] = saved.TERM_PROGRAM;
    }
  });
});
