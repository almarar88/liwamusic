#!/usr/bin/env python3
"""LiwaMusic — توليد أيقونات أندرويد (mipmap) بلا اعتماديات خارجية."""
import math
import os
import struct
import sys
import zlib

ICON_SIZES = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
}


def draw(size, rounded=True):
    """يرسم أيقونة النوتة على تدرّج بنفسجي ويعيد بايتات RGBA."""
    px = bytearray(size * size * 4)
    s = size / 512.0

    def put(x, y, r, g, b, a):
        if a <= 0 or not (0 <= x < size and 0 <= y < size):
            return
        i = (y * size + x) * 4
        ba = px[i + 3]
        if ba == 0:
            px[i], px[i + 1], px[i + 2], px[i + 3] = r, g, b, a
        else:
            na = a + ba * (255 - a) // 255
            px[i] = (r * a + px[i] * ba * (255 - a) // 255) // max(1, na)
            px[i + 1] = (g * a + px[i + 1] * ba * (255 - a) // 255) // max(1, na)
            px[i + 2] = (b * a + px[i + 2] * ba * (255 - a) // 255) // max(1, na)
            px[i + 3] = na

    radius = 112 * s
    inset = 0 if not rounded else 8 * s
    lo, hi = inset, size - 1 - inset
    for y in range(size):
        for x in range(size):
            if rounded:
                cx = min(max(x, lo + radius), hi - radius)
                cy = min(max(y, lo + radius), hi - radius)
                d = math.hypot(x - cx, y - cy)
                if x < lo or x > hi or y < lo or y > hi:
                    continue
                a = 255 if d <= radius - 1 else max(0, min(255, int((radius + 0.7 - d) * 255)))
            else:
                a = 255
            if not a:
                continue
            t = (x + y) / (2.0 * size)
            put(x, y, int(140 - 42 * t), int(96 - 40 * t), int(255 - 40 * t), a)

    W = (255, 255, 255)

    def ellipse(cx, cy, rx, ry, ang):
        ca, sa = math.cos(ang), math.sin(ang)
        span = int(max(rx, ry) + 2)
        for y in range(int(cy - span), int(cy + span)):
            for x in range(int(cx - span), int(cx + span)):
                dx, dy = x - cx, y - cy
                u, v = dx * ca + dy * sa, -dx * sa + dy * ca
                d = (u / rx) ** 2 + (v / ry) ** 2
                if d <= 1.0:
                    put(x, y, W[0], W[1], W[2], min(255, int((1.0 - d) * 900) + 90))

    def rect(x0, y0, x1, y1):
        for y in range(int(y0), int(y1)):
            for x in range(int(x0), int(x1)):
                put(x, y, W[0], W[1], W[2], 255)

    ellipse(178 * s, 356 * s, 60 * s, 45 * s, -0.32)
    ellipse(330 * s, 330 * s, 60 * s, 45 * s, -0.32)
    rect(228 * s, 150 * s, 248 * s, 360 * s)
    rect(380 * s, 124 * s, 400 * s, 334 * s)
    for i in range(20):
        rect(228 * s, (150 + i * 3.2) * s, 400 * s, (154 + i * 3.2) * s)
    return px


def write_png(path, size, px):
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    raw = bytearray()
    for y in range(size):
        raw.append(0)
        raw += px[y * size * 4:(y + 1) * size * 4]
    out = b'\x89PNG\r\n\x1a\n'
    out += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    out += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    out += chunk(b'IEND', b'')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(out)


def main():
    res = sys.argv[1] if len(sys.argv) > 1 else 'android/app/src/main/res'
    for folder, size in ICON_SIZES.items():
        px = draw(size)
        write_png(os.path.join(res, folder, 'ic_launcher.png'), size, px)
        write_png(os.path.join(res, folder, 'ic_launcher_round.png'), size, px)
        write_png(os.path.join(res, folder, 'ic_launcher_foreground.png'), size, px)
        print(f'{folder}: {size}x{size}')
    write_png(os.path.join(res, 'drawable', 'splash.png'), 512, draw(512, rounded=False))
    print('انتهى توليد الأيقونات')


if __name__ == '__main__':
    main()
