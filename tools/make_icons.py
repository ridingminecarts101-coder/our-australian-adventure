"""Generate the PWA icons: the Southern Cross on an ochre ground.

Pure standard library — writes PNGs by hand so there's no Pillow dependency.
Run from the repo root:  python tools/make_icons.py
"""
import math
import os
import struct
import zlib

# Southern Cross, roughly to scale. (x, y, radius) in unit-square coordinates.
STARS = [
    (0.500, 0.795, 0.058),   # Alpha Crucis  (foot)
    (0.500, 0.255, 0.052),   # Gamma Crucis  (head)
    (0.268, 0.540, 0.048),   # Beta Crucis   (left)
    (0.700, 0.437, 0.040),   # Delta Crucis  (right)
    (0.590, 0.632, 0.022),   # Epsilon Crucis
]

TOP    = (0x9E, 0x46, 0x24)   # ochre
BOTTOM = (0x54, 0x22, 0x11)   # deep red earth
STAR   = (0xF8, 0xF1, 0xE6)   # cream


def smoothstep(edge0, edge1, x):
    t = (x - edge0) / (edge1 - edge0)
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def render(size, inset=0.0):
    """Return raw RGB rows. `inset` shrinks the star field for maskable icons."""
    rows = []
    scale = 1.0 - inset
    for y in range(size):
        row = bytearray()
        fy = (y + 0.5) / size
        # Vertical gradient background.
        bg = tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * fy) for i in range(3))
        for x in range(size):
            fx = (x + 0.5) / size
            # Map into the (possibly inset) star field.
            sx = (fx - 0.5) / scale + 0.5
            sy = (fy - 0.5) / scale + 0.5

            cover = 0.0
            for cx, cy, r in STARS:
                d = math.hypot(sx - cx, sy - cy)
                aa = 1.2 / (size * scale)              # ~1px feather
                cover = max(cover, 1.0 - smoothstep(r - aa, r + aa, d))
                # Four short spikes, so it reads as a star rather than a dot.
                spike = r * 2.9
                along = abs(sx - cx) + abs(sy - cy)
                thin = min(abs(sx - cx), abs(sy - cy))
                if along < spike:
                    w = 0.16 * r * (1 - along / spike)
                    cover = max(cover, (1.0 - smoothstep(w, w + aa, thin)) * 0.95)

            px = tuple(round(bg[i] + (STAR[i] - bg[i]) * cover) for i in range(3))
            row += bytes(px)
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b''.join(b'\x00' + r for r in rows)          # filter byte 0 per scanline

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as fh:
        fh.write(png)
    return len(png)


def main():
    os.makedirs('icons', exist_ok=True)
    targets = [
        # Web / PWA
        ('icons/icon-180.png', 180, 0.0),
        ('icons/icon-192.png', 192, 0.0),
        ('icons/icon-512.png', 512, 0.0),
        ('icons/icon-512-maskable.png', 512, 0.30),   # safe zone for Android masks
        # iOS. 1024 is the App Store icon and must have no transparency and no
        # rounded corners - Apple applies the mask itself.
        ('icons/ios/icon-1024.png', 1024, 0.0),
        ('icons/ios/icon-120.png', 120, 0.0),
        ('icons/ios/icon-152.png', 152, 0.0),
        ('icons/ios/icon-167.png', 167, 0.0),
        ('icons/ios/icon-76.png', 76, 0.0),
        ('icons/ios/icon-60.png', 60, 0.0),
        ('icons/ios/icon-40.png', 40, 0.0),
        ('icons/ios/icon-29.png', 29, 0.0),
        # Android adaptive foreground
        ('icons/android/icon-432-foreground.png', 432, 0.32),
    ]
    for path, _, _ in targets:
        d = os.path.dirname(path)
        if d:
            os.makedirs(d, exist_ok=True)
    for path, size, inset in targets:
        n = write_png(path, size, render(size, inset))
        print(f'{path:34} {size}x{size}  {n:,} bytes')


if __name__ == '__main__':
    main()
