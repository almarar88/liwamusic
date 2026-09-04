#!/usr/bin/env python3
"""LiwaMusic — توليد أيقونة التطبيق (PNG 512x512) بلا اعتماديات خارجية."""
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
    cx = min(max(x, lo + radius), hi - radius)
    cy = min(max(y, lo + radius), hi - radius)
    d = math.hypot(x - cx, y - cy)
    if x < lo or x > hi or y < lo or y > hi: return 0
    return max(0, min(255, int((radius + 0.7 - d) * 255))) if d > radius - 1 else 255

# خلفية متدرّجة بنفسجية
for y in range(S):
    for x in range(S):
        a = rounded_alpha(x, y)
        if not a: continue
        t = (x + y) / (2.0 * S)
        r = int(140 - 42 * t); g = int(96 - 40 * t); b = int(255 - 40 * t)
        put(x, y, r, g, b, a)

def ellipse(cx, cy, rx, ry, ang, col):
    ca, sa = math.cos(ang), math.sin(ang)
    for y in range(int(cy - ry - rx), int(cy + ry + rx)):
        if not 0 <= y < S: continue
        for x in range(int(cx - rx - ry), int(cx + rx + ry)):
            if not 0 <= x < S: continue
            dx, dy = x - cx, y - cy
            u, v = dx * ca + dy * sa, -dx * sa + dy * ca
            d = (u / rx) ** 2 + (v / ry) ** 2
            if d <= 1.0:
                edge = min(255, int((1.0 - d) * 900) + 90)
                put(x, y, col[0], col[1], col[2], min(255, edge))

def rect(x0, y0, x1, y1, col):
    for y in range(int(y0), int(y1)):
        if not 0 <= y < S: continue
        for x in range(int(x0), int(x1)):
            if 0 <= x < S: put(x, y, col[0], col[1], col[2], 255)

W = (255, 255, 255)
# نوتة موسيقية: رأسان + عمودان + علم يصل بينهما
ellipse(178, 356, 60, 45, -0.32, W)
ellipse(330, 330, 60, 45, -0.32, W)
rect(228, 150, 248, 360, W)
rect(380, 124, 400, 334, W)
for i in range(20):           # العلم العلوي
    rect(228, 150 + i * 3.2, 400, 154 + i * 3.2, W)

def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

raw = bytearray()
for y in range(S):
    raw.append(0)
    raw += px[y * S * 4:(y + 1) * S * 4]

png = b'\x89PNG\r\n\x1a\n'
png += chunk(b'IHDR', struct.pack('>IIBBBBB', S, S, 8, 6, 0, 0, 0))
png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
png += chunk(b'IEND', b'')
open('build/icon.png', 'wb').write(png)
print(f'build/icon.png — {len(png)} بايت، {S}x{S}')
