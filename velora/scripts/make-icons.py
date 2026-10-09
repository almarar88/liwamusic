#!/usr/bin/env python3
"""Velora — generate Android launcher icons (gold 'V' on navy). Requires Pillow."""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

SIZES = {'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96, 'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192}
FG_SIZES = {'mipmap-mdpi': 108, 'mipmap-hdpi': 162, 'mipmap-xhdpi': 216, 'mipmap-xxhdpi': 324, 'mipmap-xxxhdpi': 432}


def font(px):
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, px)
    return ImageFont.load_default()


def gradient(n):
    img = Image.new('RGBA', (n, n))
    top, bot = (29, 43, 92), (8, 12, 26)
    for y in range(n):
        t = y / max(1, n - 1)
        ImageDraw.Draw(img).line([(0, y), (n, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bot)) + (255,))
    return img


def mark(img, n, scale):
    d = ImageDraw.Draw(img)
    f = font(int(n * scale))
    box = d.textbbox((0, 0), 'V', font=f)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((n - w) / 2 - box[0], (n - h) / 2 - box[1]), 'V', font=f, fill=(233, 200, 132, 255))


def icon(n, round_=False):
    s = n * 4
    base = gradient(s)
    mark(base, s, 0.58)
    mask = Image.new('L', (s, s), 0)
    md = ImageDraw.Draw(mask)
    if round_:
        md.ellipse([0, 0, s - 1, s - 1], fill=255)
    else:
        md.rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.22, fill=255)
    out = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)
    return out.resize((n, n), Image.LANCZOS)


def foreground(n):
    s = n * 4
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    mark(img, s, 0.36)
    return img.resize((n, n), Image.LANCZOS)


res = sys.argv[1] if len(sys.argv) > 1 else 'android/app/src/main/res'
for d, n in SIZES.items():
    os.makedirs(os.path.join(res, d), exist_ok=True)
    icon(n).save(os.path.join(res, d, 'ic_launcher.png'))
    icon(n, True).save(os.path.join(res, d, 'ic_launcher_round.png'))
    foreground(FG_SIZES[d]).save(os.path.join(res, d, 'ic_launcher_foreground.png'))
bg = os.path.join(res, 'values', 'ic_launcher_background.xml')
if os.path.isdir(os.path.dirname(bg)):
    with open(bg, 'w') as fh:
        fh.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#121B3A</color>\n</resources>\n')
icon(512).save(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icon.png'))
print('icons written to', res)
