#!/usr/bin/env python3
"""Pack icon.icns (from icon.iconset) and icon.ico (Windows tile renditions), then read both back and verify."""
import hashlib
import struct
import io
import os
import subprocess
import sys

import icnsutil
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FINAL = os.path.dirname(HERE)
ICONSET = os.path.join(FINAL, 'icon.iconset')
ICNS = os.path.join(FINAL, 'icon.icns')
ICO = os.path.join(FINAL, 'icon.ico')
WIN = os.path.join(HERE, 'win')

# --- icns -------------------------------------------------------------------------------------
# key -> iconset file. ic04/ic05 are ARGB (macOS 11+ small sizes), the rest PNG.
ICNS_MAP = [
    ('ic04', 'icon_16x16.png'), ('ic05', 'icon_32x32.png'),
    ('ic11', 'icon_16x16@2x.png'), ('ic12', 'icon_32x32@2x.png'),
    ('ic07', 'icon_128x128.png'), ('ic13', 'icon_128x128@2x.png'),
    ('ic08', 'icon_256x256.png'), ('ic14', 'icon_256x256@2x.png'),
    ('ic09', 'icon_512x512.png'), ('ic10', 'icon_512x512@2x.png'),
]
icns = icnsutil.IcnsFile()
for key, name in ICNS_MAP:
    path = os.path.join(ICONSET, name)
    if key in ('ic04', 'ic05'):
        icns.add_media(key, data=icnsutil.ArgbImage(file=path).argb_data())
    else:
        icns.add_media(key, file=path)
icns.write(ICNS, toc=True)

# --- ico ----------------------------------------------------------------------------------------
# Written by hand so every entry is exactly the tuned rendition: 32-bit BMP (straight alpha + AND mask) below 256 px,
# the way Windows' own icons and NSIS/rcedit expect them, and the sRGB-tagged PNG verbatim for 256 px.
# 20/30/36/40 cover 125 %/150 %/250 % scaling (small icons 20, taskbar 30/36, 40).
sizes = [16, 20, 24, 30, 32, 36, 40, 48, 64, 128, 256]


def bmp_entry(png_path):
    im = Image.open(png_path).convert('RGBA')
    w, h = im.size
    px = im.tobytes()
    xor = bytearray()
    for y in range(h - 1, -1, -1):                         # bottom-up rows, BGRA
        row = px[y * w * 4:(y + 1) * w * 4]
        for x in range(w):
            r, g, b, a = row[x * 4:x * 4 + 4]
            xor += bytes((b, g, r, a))
    stride = ((w + 31) // 32) * 4                          # 1-bpp AND mask, rows padded to 32 bits
    mask = bytearray()
    for y in range(h - 1, -1, -1):
        bits = bytearray(stride)
        for x in range(w):
            if px[(y * w + x) * 4 + 3] == 0:
                bits[x // 8] |= 0x80 >> (x % 8)
        mask += bits
    header = struct.pack('<IiiHHIIiiII', 40, w, h * 2, 1, 32, 0, len(xor) + len(mask), 0, 0, 0, 0)
    return header + bytes(xor) + bytes(mask)


entries = []
for n in sizes:
    src = os.path.join(WIN, f'{n}.png')
    data = open(src, 'rb').read() if n >= 256 else bmp_entry(src)
    entries.append((n, data))
offset = 6 + 16 * len(entries)
blob = struct.pack('<HHH', 0, 1, len(entries))
for n, data in entries:
    blob += struct.pack('<BBBBHHII', n % 256, n % 256, 0, 0, 1, 32, len(data), offset)
    offset += len(data)
for _, data in entries:
    blob += data
open(ICO, 'wb').write(blob)

# --- verify -------------------------------------------------------------------------------------
ok = True
print('icon.icns', os.path.getsize(ICNS), 'bytes')
back = icnsutil.IcnsFile(ICNS)
for line in icnsutil.IcnsFile.description(ICNS, verbose=False, indent=2).splitlines():
    print(line)
want = {k for k, _ in ICNS_MAP}
got = {k for k in back.media.keys() if k != 'TOC '}
if want - got:
    ok = False
    print('MISSING icns keys:', sorted(want - got))
errors = list(icnsutil.IcnsFile.verify(ICNS))
print('icnsutil verify:', 'OK' if not errors else errors)
ok &= not errors
# PNG payloads must be byte-identical to the iconset files; ARGB payloads must decode to the same pixels.
os.makedirs(os.path.join(HERE, 'icns-out'), exist_ok=True)
for key, name in ICNS_MAP:
    data = back.media[key]
    src = os.path.join(ICONSET, name)
    if key in ('ic04', 'ic05'):
        img = icnsutil.ArgbImage(data=data)
        out = os.path.join(HERE, 'icns-out', f'{key}.png')
        img.write_png(out)
        a = Image.open(out).convert('RGBA').tobytes()
        b = Image.open(src).convert('RGBA').tobytes()
        same = a == b
    else:
        same = hashlib.sha256(data).digest() == hashlib.sha256(open(src, 'rb').read()).digest()
        with open(os.path.join(HERE, 'icns-out', f'{key}.png'), 'wb') as fh:
            fh.write(data)
    w, h = Image.open(io.BytesIO(data)).size if data[:8] == b'\x89PNG\r\n\x1a\n' else img.size
    print(f'  {key}: {w}x{h} <- {name}  roundtrip {"identical" if same else "DIFFERENT"}')
    ok &= same

print('icon.ico', os.path.getsize(ICO), 'bytes')
raw = open(ICO, 'rb').read()
_, kind, count = struct.unpack('<HHH', raw[:6])
print(f'  header: type {kind} (1 = icon), {count} entries')
for i in range(count):
    bw, bh, _, _, planes, bpp, size, off = struct.unpack('<BBBBHHII', raw[6 + 16 * i:22 + 16 * i])
    payload = raw[off:off + size]
    fmt = 'PNG' if payload[:8] == b'\x89PNG\r\n\x1a\n' else 'BMP'
    srgb = (b'sRGB' in payload[:80]) if fmt == 'PNG' else None
    print(f'  entry {i}: {bw or 256}x{bh or 256} {bpp} bpp {fmt}{" sRGB-tagged" if srgb else ""}, {size} bytes')
    if fmt == 'PNG' and not srgb:
        ok = False
with Image.open(ICO) as ico:
    found = sorted(ico.info.get('sizes', set()))
    print('  Pillow sizes:', ', '.join(f'{w}x{h}' for w, h in found))
    for n in sizes:
        ico.size = (n, n)
        frame = ico.copy().convert('RGBA')
        ref = Image.open(os.path.join(WIN, f'{n}.png')).convert('RGBA')
        same = frame.tobytes() == ref.tobytes()
        corner = frame.getpixel((0, 0))[3]
        print(f'  {n}x{n}: decoded RGBA, corner alpha {corner}, matches source {"yes" if same else "NO"}')
        ok &= same and corner == 0
    if set((n, n) for n in sizes) - set(found):
        ok = False
        print('MISSING ico sizes')
# every shipped PNG carries the sRGB chunk
import glob
pngs = [os.path.join(FINAL, 'icon.png')] + sorted(glob.glob(os.path.join(ICONSET, '*.png'))) + sorted(glob.glob(os.path.join(FINAL, 'linux', '*.png')))
untagged = [p for p in pngs if b'sRGB' not in open(p, 'rb').read()[:120]]
print(f'sRGB chunk: {len(pngs) - len(untagged)}/{len(pngs)} shipped PNGs tagged', untagged or '')
ok &= not untagged
print('identify:', subprocess.run(['identify', ICO], capture_output=True, text=True).stdout.strip().replace('\n', ' | '))
print('ALL OK' if ok else 'PROBLEMS FOUND')
sys.exit(0 if ok else 1)
