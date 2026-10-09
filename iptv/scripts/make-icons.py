#!/usr/bin/env python3
"""LiwaIPTV — توليد أيقونات أندرويد (mipmap) ولافتة أندرويد TV بلا اعتماديات خارجية."""
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

A1 = (46, 230, 214)   # فيروزي
A2 = (124, 92, 255)   # بنفسجي
BG = (7, 8, 13)


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = bytearray(w * h * 4)

    def put(self, x, y, c, a):
        if a <= 0 or not (0 <= x < self.w and 0 <= y < self.h):
            return
        i = (y * self.w + x) * 4
        ba = self.px[i + 3]
        if ba == 0:
            self.px[i:i + 4] = bytes((c[0], c[1], c[2], a))
            return
        na = a + ba * (255 - a) // 255
        for k in range(3):
            self.px[i + k] = (c[k] * a + self.px[i + k] * ba * (255 - a) // 255) // max(1, na)
        self.px[i + 3] = na

    def rrect(self, x0, y0, x1, y1, r, color_fn):
        """مستطيل بزوايا مستديرة مع حواف ناعمة؛ color_fn(x, y) تعيد اللون."""
        for y in range(int(y0) - 1, int(y1) + 2):
            for x in range(int(x0) - 1, int(x1) + 2):
                cx = min(max(x, x0 + r), x1 - r)
                cy = min(max(y, y0 + r), y1 - r)
                d = math.hypot(x - cx, y - cy)
                a = 255 if d <= max(r - 1, 0) else max(0, min(255, int((r + 0.5 - d) * 255)))
                if a:
                    self.put(x, y, color_fn(x, y), a)

    def triangle(self, pts, color):
        (ax, ay), (bx, by), (cx, cy) = pts
        minx, maxx = int(min(ax, bx, cx)) - 1, int(max(ax, bx, cx)) + 2
        miny, maxy = int(min(ay, by, cy)) - 1, int(max(ay, by, cy)) + 2

        def edge(px, py, qx, qy, x, y):
            return (qx - px) * (y - py) - (qy - py) * (x - px)

        area = edge(ax, ay, bx, by, cx, cy)
        for y in range(miny, maxy):
            for x in range(minx, maxx):
                cov = 0
                for sx in (0.25, 0.75):
                    for sy in (0.25, 0.75):
                        w0 = edge(bx, by, cx, cy, x + sx, y + sy)
                        w1 = edge(cx, cy, ax, ay, x + sx, y + sy)
                        w2 = edge(ax, ay, bx, by, x + sx, y + sy)
                        if (w0 >= 0 and w1 >= 0 and w2 >= 0) if area > 0 else (w0 <= 0 and w1 <= 0 and w2 <= 0):
                            cov += 1
                if cov:
                    self.put(x, y, color, cov * 64 - 1)

    def line(self, x0, y0, x1, y1, width, color):
        minx, maxx = int(min(x0, x1) - width), int(max(x0, x1) + width) + 1
        miny, maxy = int(min(y0, y1) - width), int(max(y0, y1) + width) + 1
        dx, dy = x1 - x0, y1 - y0
        ln = dx * dx + dy * dy or 1
        for y in range(miny, maxy):
            for x in range(minx, maxx):
                t = max(0, min(1, ((x - x0) * dx + (y - y0) * dy) / ln))
                d = math.hypot(x - (x0 + t * dx), y - (y0 + t * dy))
                a = max(0, min(255, int((width / 2 + 0.5 - d) * 255)))
                if a:
                    self.put(x, y, color, a)


def draw_glyph(c, ox, oy, s):
    """شعار: شاشة بتدرّج وزر تشغيل وهوائيان. s = حجم المربع المرجعي."""
    grad = lambda x, y: mix(A1, A2, max(0, min(1, ((x - ox) + (y - oy)) / (2.0 * s))))
    c.line(ox + s * 0.34, oy + s * 0.12, ox + s * 0.5, oy + s * 0.24, s * 0.055, A1)
    c.line(ox + s * 0.66, oy + s * 0.12, ox + s * 0.5, oy + s * 0.24, s * 0.055, A2)
    c.rrect(ox + s * 0.06, oy + s * 0.22, ox + s * 0.94, oy + s * 0.84, s * 0.15, grad)
    c.triangle([(ox + s * 0.41, oy + s * 0.38), (ox + s * 0.41, oy + s * 0.68), (ox + s * 0.67, oy + s * 0.53)], (255, 255, 255))


def icon(size, rounded=True):
    c = Canvas(size, size)
    r = size * 0.22 if rounded else 0
    c.rrect(0, 0, size - 1, size - 1, r, lambda x, y: mix((20, 24, 38), BG, (x + y) / (2.0 * size)))
    pad = size * 0.16
    draw_glyph(c, pad, pad * 0.95, size - 2 * pad)
    return c


def banner(w=320, h=180):
    """لافتة أندرويد TV: خلفية داكنة متدرّجة، الشعار، وخط فيروزي/بنفسجي."""
    c = Canvas(w, h)
    c.rrect(0, 0, w - 1, h - 1, 0, lambda x, y: mix((22, 26, 42), BG, x / float(w)))
    draw_glyph(c, w * 0.36, h * 0.12, h * 0.62)
    for x in range(int(w * 0.2), int(w * 0.8)):
        t = (x - w * 0.2) / (w * 0.6)
        for y in range(int(h * 0.86), int(h * 0.86) + 4):
            c.put(x, y, mix(A1, A2, t), 255)
    return c


def write_png(path, c):
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    raw = bytearray()
    for y in range(c.h):
        raw.append(0)
        raw += c.px[y * c.w * 4:(y + 1) * c.w * 4]
    out = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', c.w, c.h, 8, 6, 0, 0, 0))
    out += chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(out)


def main():
    res = sys.argv[1] if len(sys.argv) > 1 else 'android/app/src/main/res'
    for folder, size in ICON_SIZES.items():
        c = icon(size)
        for name in ('ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png'):
            write_png(os.path.join(res, folder, name), c)
        print(f'{folder}: {size}x{size}')
    write_png(os.path.join(res, 'drawable', 'banner.png'), banner())
    write_png(os.path.join(res, 'drawable', 'splash.png'), icon(512, rounded=False))
    print('انتهى توليد الأيقونات واللافتة')


if __name__ == '__main__':
    main()
