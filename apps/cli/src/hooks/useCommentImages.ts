import { useEffect, useMemo, useRef, useState } from 'react';
import type { RemoteCommentThread } from '@n10/vcs-core';
import {
  collectImageUrls,
  type CommentImageLayouts,
  type CommentImageLayout,
} from '@n10/review-comments';
import {
  detectKittyGraphics,
  supportsNativeAnimation,
  placementForImage,
  deleteImage,
  type PlacementSize,
} from '@n10/kitty-graphics';
import type { GifAnimation } from '@n10/image-loader';
import type {
  CommentImagesValue,
  CommentImageState,
} from '../context/CommentImagesContext.js';
import {
  loadCommentImage,
  transmitStill,
  transmitTerminalAnimation,
  transmitFrame,
} from './comment-image-transmit.js';

// Loads comment images and transmits them to the terminal via the
// kitty graphics protocol (virtual placements — see @n10/kitty-graphics).
// Each distinct url is fetched, decoded and transmitted exactly once
// per process; the state map drives both rendering (CommentProse
// placeholders) and the row/height math (imageLayouts).
//
// Animated GIFs play back two ways:
//   - kitty: frames transmit once (a=f) and the TERMINAL loops them
//     forever (a=a,s=3,v=1) — no timers, no ongoing traffic.
//   - ghostty (no a=f support upstream): n10 re-transmits frames on
//     a chained timeout while a reviews pane is visible. Bounded by
//     MAX_ANIMATED gifs and MIN_FRAME_MS. `N10_GIF_ANIMATION=off`
//     disables playback entirely (a static composite frame only).

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
  const startedRef = useRef(new Set<string>());
  const nextIdRef = useRef(1);
  const transmittedIdsRef = useRef<number[]>([]);
  // Client-driven animations by image id; the version bump re-arms the
  // playback effect when a new animation finishes loading.
  const animationsRef = useRef(new Map<number, ActiveAnimation>());
  const [animVersion, setAnimVersion] = useState(0);
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
    const setState = (url: string, state: CommentImageState) => {
      if (!cancelled) setImages((prev) => new Map(prev).set(url, state));
    };

    const start = (url: string) => {
      void loadCommentImage(url, vendorAuth)
        .then((loaded) => {
          if (cancelled || !loaded || nextIdRef.current > 255) {
            setState(url, { status: 'failed' });
            return;
          }
          const id = nextIdRef.current++;
          const placement = placementForImage(
            loaded.decoded.width,
            loaded.decoded.height,
            Math.max(1, maxColsRef.current)
          );
          if (loaded.animation && native) {
            transmitTerminalAnimation(id, loaded.animation, placement);
          } else {
            transmitStill(id, loaded.decoded, placement);
            if (loaded.animation && animationsRef.current.size < MAX_ANIMATED) {
              animationsRef.current.set(id, {
                ...loaded.animation,
                placement,
              });
              setAnimVersion((v) => v + 1);
            }
          }
          transmittedIdsRef.current.push(id);
          setState(url, {
            status: 'ready',
            id,
            rows: placement.rows,
            cols: placement.cols,
          });
        })
        .catch(() => setState(url, { status: 'failed' }));
    };

    for (const url of urls) start(url);
    return () => {
      cancelled = true;
    };
  }, [enabled, native, threads, vendorAuth]);

  // Client-driven GIF playback (ghostty). Each animation steps on its
  // own chained timeout, re-transmitting the next full frame — plain
  // image replacement is all the terminal supports without a=f.
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
        transmitFrame(id, anim, anim.placement, idx);
        const gap = anim.frames[idx]?.delayMs ?? MIN_FRAME_MS;
        handles.push(setTimeout(step, Math.max(MIN_FRAME_MS, gap)));
      };
      const firstGap = anim.frames[0]?.delayMs ?? MIN_FRAME_MS;
      handles.push(setTimeout(step, Math.max(MIN_FRAME_MS, firstGap)));
    }
    return () => {
      stopped = true;
      for (const handle of handles) clearTimeout(handle);
    };
  }, [enabled, native, animationsActive, animVersion]);

  // Free the terminal's image memory when n10 unmounts / exits.
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
