#!/usr/bin/env python3
"""Generates the procedural tileable textures used by the Sandstorm, Villa and Bazaar maps.

    python3 Tools/make_textures.py            # writes Assets/Arena/Textures/*.jpg (1024 px, seamless)

Everything is drawn from seeded noise and simple shapes, so the output is reproducible and original. Needs numpy
and Pillow. Unity picks the files up on the next import; Arena -> 1. Generate Scene and Prefabs sets their import
settings (repeat, mipmaps, crunch, 512 px).
"""
import os
import numpy as np
from PIL import Image

N = 1024
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'Assets', 'Arena', 'Textures')


def periodic_noise(rng, beta=2.0, size=N):
    """Seamless fractal noise in [0, 1]: white noise shaped by 1/f^beta in the frequency domain."""
    white = rng.standard_normal((size, size))
    fy = np.fft.fftfreq(size)[:, None]
    fx = np.fft.fftfreq(size)[None, :]
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1.0
    shaped = np.real(np.fft.ifft2(np.fft.fft2(white) / f ** (beta / 2)))
    shaped -= shaped.min()
    return shaped / shaped.max()


def lerp(a, b, t):
    return a + (b - a) * t


def rgb(c):
    return np.array(c, dtype=np.float32)


def save(name, img):
    img = np.clip(img, 0, 255).astype(np.uint8)
    path = os.path.join(OUT, name + '.jpg')
    Image.fromarray(img, 'RGB').save(path, quality=88, optimize=True)
    print('wrote', os.path.relpath(path))


def colourise(t, low, high):
    return lerp(rgb(low)[None, None, :], rgb(high)[None, None, :], t[..., None])


def sandstone_blocks(seed=11):
    """Large dressed sandstone blocks in staggered courses, with chipped arrises and soft weathering."""
    rng = np.random.default_rng(seed)
    grain = periodic_noise(rng, 2.6)
    fine = periodic_noise(rng, 1.2)
    img = colourise(grain * 0.6 + fine * 0.4, (205, 176, 128), (246, 228, 190))
    rows = 4
    rh = N // rows
    mortar = np.zeros((N, N), bool)
    shade = np.zeros((N, N), np.float32)
    yy, xx = np.mgrid[0:N, 0:N]
    for r in range(rows):
        y0 = r * rh
        # Random block widths that sum to the full width, then a random phase so joints stagger and wrap.
        widths = []
        while sum(widths) < N:
            widths.append(int(rng.integers(220, 420)))
        widths[-1] -= sum(widths) - N
        if widths[-1] < 120:
            widths[-2] += widths[-1]
            widths.pop()
        phase = int(rng.integers(0, N))
        x = phase
        for w in widths:
            tone = rng.uniform(-14, 14)
            xs = (np.arange(x, x + w) % N)
            block = (slice(y0, y0 + rh), xs)
            img[y0:y0 + rh][:, xs] += tone
            # Bevel: lighter top edge, darker bottom edge.
            shade[y0:y0 + 10, xs] += 16
            shade[y0 + rh - 12:y0 + rh, xs] -= 22
            mortar[y0:y0 + rh, xs[:7]] = True
            x += w
        mortar[y0:y0 + 7, :] = True
    chips = (periodic_noise(rng, 1.0) > 0.78) & (np.roll(mortar, 9, 0) | np.roll(mortar, 9, 1) | np.roll(mortar, -9, 0))
    img += shade[..., None]
    img[chips] = img[chips] * 0.86
    img[mortar] = colourise(fine, (150, 122, 86), (182, 152, 110))[mortar]
    stains = periodic_noise(rng, 3.0)
    img *= (0.92 + 0.08 * stains)[..., None]
    save('sandstorm_wall_block', img)


def roof_tiles(seed=23):
    """Terracotta barrel tiles: rounded columns, overlapping courses, a few odd-coloured and mossy tiles."""
    rng = np.random.default_rng(seed)
    cols, rows = 16, 8
    cw, rh = N // cols, N // rows
    yy, xx = np.mgrid[0:N, 0:N]
    noise = periodic_noise(rng, 1.6)
    img = np.zeros((N, N, 3), np.float32)
    for r in range(rows):
        offset = (cw // 2) * (r % 2)
        for c in range(cols):
            base = rgb((196, 92, 54)) * rng.uniform(0.82, 1.12)
            if rng.random() < 0.12:
                base = rgb((150, 78, 52))
            if rng.random() < 0.06:
                base = rgb((176, 120, 70))
            x0 = (c * cw + offset) % N
            xs = (np.arange(x0, x0 + cw) % N)
            u = (np.arange(cw) + 0.5) / cw
            profile = 0.62 + 0.38 * np.sin(np.pi * u)  # barrel: light crown, dark edges
            v = (np.arange(rh) + 0.5) / rh
            lip = np.clip((v - 0.86) / 0.14, 0, 1)
            light = profile[None, :] * (1.0 - 0.45 * lip[:, None]) * (0.9 + 0.1 * v[:, None])
            img[r * rh:(r + 1) * rh][:, xs] = base[None, None, :] * light[..., None]
    img *= (0.88 + 0.24 * noise)[..., None]
    moss = (periodic_noise(rng, 2.2) > 0.8) & (periodic_noise(rng, 0.8) > 0.55)
    img[moss] = img[moss] * 0.55 + rgb((96, 104, 60)) * 0.45
    save('villa_roof_tiles', img)


def cobbles(seed=37):
    """Rounded cobbles (jittered-grid Voronoi, wrapped so it tiles) in warm greys, with dark joints."""
    rng = np.random.default_rng(seed)
    g = 26
    cell = N / g
    gy, gx = np.mgrid[0:g, 0:g]
    pts = (np.stack([gy, gx], axis=-1) + rng.uniform(0.15, 0.85, (g, g, 2))) * cell  # [gy, gx, (y, x)]
    tones = rng.uniform(0.0, 1.0, (g, g))
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    cy, cx = (yy // cell).astype(int), (xx // cell).astype(int)
    d1 = np.full((N, N), 1e9, np.float32)
    d2 = np.full((N, N), 1e9, np.float32)
    tone = np.zeros((N, N), np.float32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            ny, nx = cy + dy, cx + dx
            py = pts[ny % g, nx % g, 0] + (ny - ny % g) * cell
            px = pts[ny % g, nx % g, 1] + (nx - nx % g) * cell
            d = np.hypot(yy - py, xx - px)
            closer = d < d1
            d2 = np.where(closer, d1, np.minimum(d2, d))
            tone = np.where(closer, tones[ny % g, nx % g], tone)
            d1 = np.where(closer, d, d1)
    edge = d2 - d1
    noise = periodic_noise(rng, 1.4)
    stone = colourise(tone * 0.7 + noise * 0.3, (138, 128, 116), (206, 194, 174))
    dome = np.clip(1.0 - d1 / (cell * 0.75), 0, 1)
    stone *= (0.78 + 0.3 * dome)[..., None]
    joint = np.clip(edge / 7.0, 0, 1)
    dirt = colourise(noise, (70, 62, 52), (98, 88, 72))
    img = lerp(dirt, stone, joint[..., None])
    save('villa_cobble', img)


def stucco(seed=41):
    """Warm lime-washed stucco with soft mottling, hairline cracks and patches where the brick shows through."""
    rng = np.random.default_rng(seed)
    mottled = periodic_noise(rng, 3.2)
    fine = periodic_noise(rng, 1.0)
    img = colourise(mottled * 0.7 + fine * 0.3, (222, 182, 140), (250, 222, 186))
    # Exposed brick where a low-frequency mask peaks.
    mask = periodic_noise(rng, 3.6)
    patch = mask > 0.86
    yy, xx = np.mgrid[0:N, 0:N]
    course = (yy // 36) % 2
    joint = ((yy % 36) < 5) | (((xx + course * 40) % 80) < 5)
    brick = colourise(fine, (150, 72, 48), (190, 98, 64))
    brick[joint] = rgb((196, 176, 150))
    img[patch] = brick[patch]
    rim = (mask > 0.84) & ~patch
    img[rim] *= 0.88
    cracks = np.abs(periodic_noise(rng, 2.0) - 0.5) < 0.004
    img[cracks] *= 0.75
    save('villa_wall_stucco', img)


def awning(seed=53):
    """Striped canvas: red and cream bands with a woven texture and soft folds."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:N, 0:N]
    band = (xx // 128) % 2
    red, cream = rgb((182, 52, 46)), rgb((236, 222, 192))
    img = np.where(band[..., None] == 0, red[None, None, :], cream[None, None, :]).astype(np.float32)
    pin = ((xx % 128) < 6) | ((xx % 128) > 121)
    img[pin] *= 0.82
    weave = 0.94 + 0.06 * (((xx // 3) + (yy // 3)) % 2)
    folds = 0.9 + 0.1 * np.sin(xx / N * 2 * np.pi * 8)
    noise = periodic_noise(rng, 2.4)
    img *= (weave * folds * (0.9 + 0.12 * noise))[..., None]
    save('bazaar_awning', img)


def mud_wall(seed=67):
    """Adobe: earthy rendered mud brick with straw flecks, rain streaks and courses showing where it has worn."""
    rng = np.random.default_rng(seed)
    mottled = periodic_noise(rng, 3.0)
    fine = periodic_noise(rng, 1.1)
    img = colourise(mottled * 0.65 + fine * 0.35, (176, 118, 82), (222, 166, 120))
    yy, xx = np.mgrid[0:N, 0:N]
    course = (yy // 64) % 2
    joint = ((yy % 64) < 6) | (((xx + course * 96) % 192) < 6)
    worn = periodic_noise(rng, 3.4) > 0.72
    img[worn & joint] *= 0.78
    img[worn & ~joint] *= 1.04
    straw = periodic_noise(rng, 0.2) > 0.93
    img[straw] = img[straw] * 0.6 + rgb((236, 206, 140)) * 0.4
    streak_x = periodic_noise(rng, 3.0)[0]  # a 1-D column profile
    streaks = 0.92 + 0.08 * np.tile(streak_x[None, :], (N, 1))
    img *= streaks[..., None]
    save('bazaar_wall_mud', img)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    sandstone_blocks()
    roof_tiles()
    cobbles()
    stucco()
    awning()
    mud_wall()
