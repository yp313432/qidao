#!/usr/bin/env python3
"""Rasterize the Aster 12-ray mark to PWA PNGs (and a 16px QC preview)."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

CREAM = (246, 243, 238, 255)  # #F6F3EE
TERRA = (193, 123, 90, 255)  # #C17B5A
# Match favicon.svg: viewBox 32, outer 11, inner 3.55, tile rx 7.
R_OUTER = 11 / 32
R_INNER = 3.55 / 32
RX = 7 / 32


def star_points(cx: float, cy: float, r_o: float, r_i: float, n: int = 12) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for i in range(n * 2):
        r = r_o if i % 2 == 0 else r_i
        a = -math.pi / 2 + i * math.pi / n
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def render(size: int, *, rounded: bool, supersample: int = 8) -> Image.Image:
    s = size * supersample
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    if rounded:
        rad = max(1, round(s * RX))
        draw.rounded_rectangle([0, 0, s - 1, s - 1], radius=rad, fill=CREAM)
    else:
        draw.rectangle([0, 0, s, s], fill=CREAM)
    cx = cy = s / 2
    draw.polygon(star_points(cx, cy, s * R_OUTER, s * R_INNER), fill=TERRA)
    out = im.resize((size, size), Image.Resampling.LANCZOS)
    if rounded:
        return out
    bg = Image.new("RGB", (size, size), CREAM[:3])
    bg.paste(out, mask=out.split()[-1])
    return bg


def main() -> None:
    grok = Path("/workspace/.grok")
    render(192, rounded=False).save(grok / "icon-192.png.tmp", "PNG", optimize=True)
    render(512, rounded=False).save(grok / "icon-512.png.tmp", "PNG", optimize=True)
    # QC only — not shipped. Rounded tile at favicon sizes.
    render(16, rounded=True).save(grok / "favicon-16-qc.png", "PNG")
    render(32, rounded=True).save(grok / "favicon-32-qc.png", "PNG")
    print("wrote icon-192/512 temps + 16/32 qc")


if __name__ == "__main__":
    main()
