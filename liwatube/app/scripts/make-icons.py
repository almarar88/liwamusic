#!/usr/bin/env python3
"""LiwaTube App — توليد أيقونات أندرويد (mipmap) ولافتة التلفاز (drawable/banner.png) بلا اعتماديات خارجية."""
import math, os, struct, sys, zlib

ICON_SIZES = {'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96, 'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192}

def canvas(w, h):
    return bytearray(w * h * 4)

def put(px, w, h, x, y, r, g, b, a):
    if a <= 0 or not (0 <= x < w and 0 <= y < h): return
    i = (y * w + x) * 4
    ba = px[i + 3]
    if ba == 0:
        px[i], px[i + 1], px[i + 2], px[i + 3] = r, g, b, a
    else:
        na = a + ba * (255 - a) // 255
        px[i] = (r * a + px[i] * ba * (255 - a) // 255) // max(1, na)
        px[i + 1] = (g * a + px[i + 1] * ba * (255 - a) // 255) // max(1, na)
        px[i + 2] = (b * a + px[i + 2] * ba * (255 - a) // 255) // max(1, na)
        px[i + 3] = na

def rrect(x, y, x0, y0, x1, y1, rad):
    if x < x0 or x > x1 or y < y0 or y > y1: return 0
    cx = min(max(x, x0 + rad), x1 - rad); cy = min(max(y, y0 + rad), y1 - rad)
    d = math.hypot(x - cx, y - cy)
    return max(0, min(255, int((rad + 0.7 - d) * 255))) if d > rad - 1 else 255

def tri(x, y, x0, y0, x1, y1, x2, y2):
    def edge(ax, ay, bx, by, px_, py_): return (bx - ax) * (py_ - ay) - (by - ay) * (px_ - ax)
    d0 = edge(x0, y0, x1, y1, x, y); d1 = edge(x1, y1, x2, y2, x, y); d2 = edge(x2, y2, x0, y0, x, y)
    inside = (d0 >= 0 and d1 >= 0 and d2 >= 0) or (d0 <= 0 and d1 <= 0 and d2 <= 0)
    if not inside: return 0
    m = min(abs(d0), abs(d1), abs(d2)) / max(1.0, (x1 - x0) * 0.6 + 1)
    return max(0, min(255, int(m * 255 * 3)))

def draw_icon(size, rounded=True):
    px = canvas(size, size); s = size / 512.0
    for y in range(size):
        for x in range(size):
            a = rrect(x, y, 14 * s, 14 * s, size - 1 - 14 * s, size - 1 - 14 * s, 112 * s) if rounded else 255
            if not a: continue
            t = (x + y) / (2 * size)
            put(px, size, size, x, y, int(255 - 30 * t), 20, 50, a)
    for y in range(size):
        for x in range(size):
            a = rrect(x, y, 96 * s, 146 * s, 416 * s, 366 * s, 48 * s)
            if a: put(px, size, size, x, y, 255, 255, 255, a)
    for y in range(size):
        for x in range(size):
            a = tri(x, y, 208 * s, 194 * s, 208 * s, 318 * s, 322 * s, 256 * s)
            if a: put(px, size, size, x, y, 235, 20, 50, a)
    return px

def draw_banner(w=320, h=180):
    px = canvas(w, h)
    for y in range(h):
        for x in range(w):
            t = x / w
            put(px, w, h, x, y, int(30 + 10 * t), 12, 16, 255)
    # أيقونة تشغيل حمراء على اليسار + نص «LiwaTube» مرسوم كمستطيلات بسيطة (بدون خطوط)
    for y in range(h):
        for x in range(w):
            a = rrect(x, y, 34, 54, 118, 126, 18)
            if a: put(px, w, h, x, y, 255, 0, 51, a)
            a = tri(x, y, 62, 72, 62, 108, 96, 90)
            if a: put(px, w, h, x, y, 255, 255, 255, a)
    # حروف مبسّطة: L i w a T u b e كأشرطة بيضاء (تعريفية فقط)
    bars = [(140, 62, 8, 56), (140, 110, 30, 8), (180, 62, 8, 8), (180, 78, 8, 40), (198, 78, 8, 40), (212, 78, 8, 40), (206, 110, 14, 8),
            (230, 62, 44, 8), (248, 62, 8, 56), (266, 78, 8, 40), (280, 78, 8, 40), (266, 110, 22, 8)]
    for (bx, by, bw, bh) in bars:
        for y in range(by, by + bh):
            for x in range(bx, bx + bw):
                put(px, w, h, x, y, 255, 255, 255, 255)
    return px

def png(w, h, rgba):
    raw = b''.join(b'\x00' + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')

res = sys.argv[1] if len(sys.argv) > 1 else 'android/app/src/main/res'
for folder, size in ICON_SIZES.items():
    d = os.path.join(res, folder); os.makedirs(d, exist_ok=True)
    data = png(size, size, draw_icon(size))
    for name in ('ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png'):
        with open(os.path.join(d, name), 'wb') as f: f.write(data)
    print('✓', folder, size)
# إزالة الأيقونات التكيفية الافتراضية إن وُجدت حتى تُستخدم PNG مباشرة
for folder in ('mipmap-anydpi-v26',):
    d = os.path.join(res, folder)
    if os.path.isdir(d):
        for f in os.listdir(d): os.remove(os.path.join(d, f))
        os.rmdir(d); print('− حذف', folder)
d = os.path.join(res, 'drawable'); os.makedirs(d, exist_ok=True)
with open(os.path.join(d, 'banner.png'), 'wb') as f: f.write(png(320, 180, draw_banner()))
print('✓ drawable/banner.png (Android TV)')
