#!/usr/bin/env python3
"""
Build the light/dark comparison GIF: one image wiped over the other by a
slider that travels right, holds, and comes back.

The two hero stills are the same frame of the same app in the two
themes — captured back to back by capture.mjs — so a wipe between them
lines up pixel for pixel and reads as one window changing its mind
rather than two screenshots being swapped.

    python3 apps/desktop-e2e/demo/theme-slider.py

Frames are composited with Pillow and encoded by ffmpeg, the same way
the recorded demos are.
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
MEDIA = ROOT / "docs" / "media"

WIDTH = 960          # matches the recorded GIFs
FPS = 25
HANDLE_R = 15        # radius of the grip circle, in output pixels
LINE_W = 3

# The travel, in seconds: hold on dark, wipe to light, hold, wipe back.
HOLD_START, WIPE, HOLD_MID, HOLD_END = 1.1, 1.9, 1.6, 1.2
DURATION = HOLD_START + WIPE + HOLD_MID + WIPE + HOLD_END


def ease(t: float) -> float:
    """Smoothstep — a linear wipe reads like a machine, not a drag."""
    return t * t * (3.0 - 2.0 * t)


def split_at(t: float) -> float:
    """Fraction of the frame showing the light theme at time `t`."""
    if t < HOLD_START:
        return 0.0
    t -= HOLD_START
    if t < WIPE:
        return ease(t / WIPE)
    t -= WIPE
    if t < HOLD_MID:
        return 1.0
    t -= HOLD_MID
    if t < WIPE:
        return 1.0 - ease(t / WIPE)
    return 0.0


def main() -> int:
    dark_path, light_path = MEDIA / "hero.png", MEDIA / "hero-light.png"
    for p in (dark_path, light_path):
        if not p.exists():
            print(f"missing {p} — run capture.mjs hero first", file=sys.stderr)
            return 1
    if shutil.which("ffmpeg") is None:
        print("ffmpeg is required", file=sys.stderr)
        return 1

    dark = Image.open(dark_path).convert("RGB")
    light = Image.open(light_path).convert("RGB")
    if dark.size != light.size:
        print("the two stills must be the same size", file=sys.stderr)
        return 1

    height = round(WIDTH * dark.height / dark.width)
    size = (WIDTH, height)
    dark = dark.resize(size, Image.LANCZOS)
    light = light.resize(size, Image.LANCZOS)

    frames = round(DURATION * FPS)
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        for i in range(frames):
            x = round(WIDTH * split_at(i / FPS))
            frame = dark.copy()
            if x > 0:
                frame.paste(light.crop((0, 0, x, height)), (0, 0))
            # The divider, and a grip on it, so the wipe reads as a
            # control someone is dragging rather than a transition.
            if 0 < x < WIDTH:
                d = ImageDraw.Draw(frame)
                d.line([(x, 0), (x, height)], fill=(255, 255, 255), width=LINE_W)
                cy = height // 2
                d.ellipse(
                    [x - HANDLE_R, cy - HANDLE_R, x + HANDLE_R, cy + HANDLE_R],
                    fill=(255, 255, 255),
                )
                d.polygon(
                    [(x - 7, cy), (x - 2, cy - 4), (x - 2, cy + 4)],
                    fill=(30, 30, 30),
                )
                d.polygon(
                    [(x + 7, cy), (x + 2, cy - 4), (x + 2, cy + 4)],
                    fill=(30, 30, 30),
                )
            frame.save(tmpdir / f"{i:04d}.png")

        out = MEDIA / "theme.gif"
        # Same two-pass palette as the recorded GIFs: a global palette
        # posterizes the diff's greens and the syntax highlighting.
        vf = (
            f"fps={FPS},split[a][b];[a]palettegen=stats_mode=diff[p];"
            f"[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle"
        )
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-framerate", str(FPS), "-i", str(tmpdir / "%04d.png"),
            "-vf", vf, str(out),
        ]
        if subprocess.run(cmd).returncode != 0:
            return 1
        print(f"wrote {out} ({out.stat().st_size // 1024} KB, {DURATION:.1f}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
