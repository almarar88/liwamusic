#!/usr/bin/env python3
"""LiwaTube — توليد أيقونة التطبيق (PNG 512x512) بلا اعتماديات خارجية."""
import zlib, struct, math

S = 512
px = bytearray(S * S * 4)

def put(x, y, r, g, b, a):
    if a <= 0: return
    i = (y * S + x) * 4
    ba = px[i+3]
    if ba == 0:
        px[i], px[i+1], px[i+2], px[i+3] = r, g, b, a
    else:
        na = a + ba * (255 - a) // 255
        px[i]   = (r * a + px[i]   * ba * (255 - a) // 255) // max(1, na)
        px[i+1] = (g * a + px[i+1] * ba * (255 - a) // 255) // max(1, na)
        px[i+2] = (b * a + px[i+2] * ba * (255 - a) // 255) // max(1, na)
        px[i+3] = na

def rounded_alpha(x, y, radius=112, inset=14):
    lo, hi = inset, S - 1 - inset
    if x < lo or x > hi or y < lo or y > hi: return 0
    cx = min(max(x, lo + radius), hi - radius)
    cy = min(max(y, lo + radius), hi - radius)
    d = math.hypot(x - cx, y - cy)
    return max(0, min(255, int((radius + 0.7 - d) * 255))) if d > radius - 1 else 255

# خلفية حمراء متدرّجة (لون يوتيوب) مع لمعة خفيفة
for y in range(S):
    for x in range(S):
        a = rounded_alpha(x, y)
        if not a: continue
        t = (x + y) / (2 * S)
        r = int(255 - 30 * t); g = int(20 + 10 * (1 - t)); b = int(50 + 20 * (1 - t))
        glow = max(0.0, 1 - math.hypot(x - 150, y - 130) / 300) * 0.22
        r = min(255, int(r + 255 * glow)); g = min(255, int(g + 120 * glow)); b = min(255, int(b + 120 * glow))
        put(x, y, r, g, b, a)

# شاشة فيديو بيضاء مستديرة في الوسط
def rrect_alpha(x, y, x0, y0, x1, y1, rad):
    if x < x0 or x > x1 or y < y0 or y > y1: return 0
    cx = min(max(x, x0 + rad), x1 - rad); cy = min(max(y, y0 + rad), y1 - rad)
    d = math.hypot(x - cx, y - cy)
    return max(0, min(255, int((rad + 0.7 - d) * 255))) if d > rad - 1 else 255

for y in range(S):
    for x in range(S):
        a = rrect_alpha(x, y, 96, 146, 416, 366, 48)
        if a: put(x, y, 255, 255, 255, a)

# مثلث التشغيل بلون الخلفية
def tri_alpha(x, y):
    # مثلث موجه لليمين: رؤوس (210,196) (210,316) (318,256)
    x0, y0, x1, y1, x2, y2 = 208, 194, 208, 318, 322, 256
    def edge(ax, ay, bx, by, px_, py_): return (bx - ax) * (py_ - ay) - (by - ay) * (px_ - ax)
    d0 = edge(x0, y0, x1, y1, x, y); d1 = edge(x1, y1, x2, y2, x, y); d2 = edge(x2, y2, x0, y0, x, y)
    inside = (d0 >= 0 and d1 >= 0 and d2 >= 0) or (d0 <= 0 and d1 <= 0 and d2 <= 0)
    if not inside: return 0
    # تنعيم بسيط قرب الحواف
    m = min(abs(d0) / 120, abs(d1) / 120, abs(d2) / 120)
    return max(0, min(255, int(m * 255 * 1.5)))

for y in range(S):
    for x in range(S):
        a = tri_alpha(x, y)
        if a: put(x, y, 235, 20, 50, a)

def png(w, h, rgba):
    raw = b''.join(b'\x00' + bytes(rgba[y*w*4:(y+1)*w*4]) for y in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')

import os
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build', 'icon.png')
with open(out, 'wb') as f: f.write(png(S, S, px))
print('wrote', out)
