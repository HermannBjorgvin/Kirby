import { useEffect, useMemo, useRef, useState } from 'react';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import {
  collectImageUrls,
  type CommentImageLayouts,
  type CommentImageLayout,
} from '@kirby/review-comments';
import {
  detectKittyGraphics,
  encodeTransmitPng,
  encodeTransmitRgba,
  encodeAnimationFrame,
  setRootFrameGap,
  startAnimationLoop,
  supportsNativeAnimation,
  placementForImage,
  deleteImage,
  type PlacementSize,
} from '@kirby/kitty-graphics';
import {
  fetchImageBytes,
  decodeImage,
  decodeGifAnimation,
  type GifAnimation,
} from '@kirby/image-loader';
import type {
  CommentImagesValue,
  CommentImageState,
} from '../context/CommentImagesContext.js';
import { getGhToken } from '../utils/gh-token.js';

// Loads comment images and transmits them to the terminal via the
// kitty graphics protocol (virtual placements — see @kirby/kitty-graphics).
// Each distinct url is fetched, decoded, and transmitted exactly once
// per process; the resulting state map drives both rendering
// (CommentBody placeholders) and row estimation (imageLayouts).
//
// Animated GIFs play back two ways:
//   - kitty: frames are transmitted once (a=f) and the TERMINAL runs
//     an infinite loop (a=a,s=3,v=1) — no timers, no ongoing traffic.
//   - ghostty (no a=f support upstream): Kirby re-transmits downscaled
//     frames on a timer while a reviews pane is visible. Bounded by
//     MAX_ANIMATED gifs and MIN_FRAME_MS. KIRBY_GIF_ANIMATION=off
//     disables playback entirely (static frame only).

const MAX_ANIMATED = 3;
const MIN_FRAME_MS = 50;

interface ActiveAnimation extends GifAnimation {
  placement: PlacementSize;
}

export function useCommentImages(
  threads: RemoteCommentThread[],
  maxCols: number,
  vendorAuth: Record<string, string>,
  /** Client-driven playback runs only while a reviews pane is showing. */
  animationsActive = true
): CommentImagesValue {
  const enabled = useMemo(() => detectKittyGraphics(process.env), []);
  const native = useMemo(() => supportsNativeAnimation(process.env), []);
  const [images, setImages] = useState<ReadonlyMap<string, CommentImageState>>(
    new Map()
  );
  // Urls ever started (never retried within a session) + allocated ids.
  const startedRef = useRef(new Set<string>());
  const nextIdRef = useRef(1);
  const transmittedIdsRef = useRef<number[]>([]);
  // Client-driven animations by image id; version bumps re-arm the
  // playback effect when a new animation finishes loading.
  const animationsRef = useRef(new Map<number, ActiveAnimation>());
  const [animVersion, setAnimVersion] = useState(0);
  // Placement width is captured at load time; a later resize keeps the
  // transmitted placement (re-transmitting on resize is a follow-up).
  const maxColsRef = useRef(maxCols);
  useEffect(() => {
    maxColsRef.current = maxCols;
  }, [maxCols]);

  useEffect(() => {
    if (!enabled) return;
    const urls = collectImageUrls(threads).filter(
      (u) => !startedRef.current.has(u)
    );
    if (urls.length === 0) return;

    for (const url of urls) startedRef.current.add(url);
    setImages((prev) => {
      const next = new Map(prev);
      for (const url of urls) next.set(url, { status: 'loading' });
      return next;
    });

    let cancelled = false;
    const fail = (url: string) => {
      if (cancelled) return;
      setImages((prev) => new Map(prev).set(url, { status: 'failed' }));
    };

    for (const url of urls) {
      void (async () => {
        try {
          const githubToken = (await getGhToken()) ?? undefined;
          const bytes = await fetchImageBytes(url, {
            githubToken,
            azurePat: vendorAuth['pat'],
          });
          const decoded = await decodeImage(bytes);
          if (!decoded || cancelled) return fail(url);
          if (nextIdRef.current > 255) return fail(url);
          const id = nextIdRef.current++;
          const placement = placementForImage(
            decoded.width,
            decoded.height,
            Math.max(1, maxColsRef.current)
          );
          const animation =
            decoded.format === 'gif' &&
            process.env['KIRBY_GIF_ANIMATION'] !== 'off'
              ? decodeGifAnimation(bytes)
              : null;

          if (animation && native) {
            // Terminal-driven: base image is frame 1, then the rest of
            // the frames with their gaps, then loop forever.
            const [first, ...rest] = animation.frames;
            process.stdout.write(
              encodeTransmitRgba(
                id,
                first!.rgba,
                animation.width,
                animation.height,
                placement
              )
            );
            for (const frame of rest) {
              process.stdout.write(
                encodeAnimationFrame(
                  id,
                  frame.rgba,
                  animation.width,
                  animation.height,
                  frame.delayMs
                )
              );
            }
            process.stdout.write(setRootFrameGap(id, first!.delayMs));
            process.stdout.write(startAnimationLoop(id));
          } else {
            const escape =
              decoded.format === 'png'
                ? encodeTransmitPng(id, decoded.png, placement)
                : encodeTransmitRgba(
                    id,
                    decoded.rgba,
                    decoded.width,
                    decoded.height,
                    placement
                  );
            process.stdout.write(escape);
            if (animation && animationsRef.current.size < MAX_ANIMATED) {
              animationsRef.current.set(id, { ...animation, placement });
              if (!cancelled) setAnimVersion((v) => v + 1);
            }
          }
          transmittedIdsRef.current.push(id);
          if (cancelled) return;
          setImages((prev) =>
            new Map(prev).set(url, {
              status: 'ready',
              id,
              rows: placement.rows,
              cols: placement.cols,
            })
          );
        } catch {
          fail(url);
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [enabled, native, threads, vendorAuth]);

  // Client-driven GIF playback (ghostty). Each animation steps on its
  // own chained timeout, re-transmitting the next full frame — plain
  // image replacement is the only animation mechanism the terminal
  // supports without a=f.
  useEffect(() => {
    if (!enabled || native || !animationsActive) return;
    if (animationsRef.current.size === 0) return;

    let stopped = false;
    const handles: NodeJS.Timeout[] = [];
    for (const [id, anim] of animationsRef.current) {
      let idx = 0;
      const step = () => {
        if (stopped) return;
        idx = (idx + 1) % anim.frames.length;
        const frame = anim.frames[idx]!;
        process.stdout.write(
          encodeTransmitRgba(
            id,
            frame.rgba,
            anim.width,
            anim.height,
            anim.placement
          )
        );
        handles.push(setTimeout(step, Math.max(MIN_FRAME_MS, frame.delayMs)));
      };
      handles.push(
        setTimeout(step, Math.max(MIN_FRAME_MS, anim.frames[0]!.delayMs))
      );
    }
    return () => {
      stopped = true;
      for (const handle of handles) clearTimeout(handle);
    };
  }, [enabled, native, animationsActive, animVersion]);

  // Free the terminal's image memory when Kirby unmounts/exits.
  useEffect(() => {
    if (!enabled) return;
    const ids = transmittedIdsRef.current;
    return () => {
      for (const id of ids) process.stdout.write(deleteImage(id));
    };
  }, [enabled]);

  const layouts: CommentImageLayouts = useMemo(() => {
    const m = new Map<string, CommentImageLayout>();
    for (const [url, state] of images) {
      if (
        state.status === 'ready' &&
        state.rows !== undefined &&
        state.cols !== undefined
      ) {
        m.set(url, { rows: state.rows, cols: state.cols });
      }
    }
    return m;
  }, [images]);

  return useMemo(
    () => ({ enabled, images, layouts }),
    [enabled, images, layouts]
  );
}
