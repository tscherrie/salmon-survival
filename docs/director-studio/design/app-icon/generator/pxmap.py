#!/usr/bin/env python3
"""Print a character map of a small icon PNG: . transparent, : partial alpha, # well/dark, B daylight, b daylight AA,
O tungsten, o tungsten AA, R rule grey, n numeral (on-ref), r rim-ish light, ? other."""
import sys
from PIL import Image

def cls(p):
    r, g, b, a = p
    if a == 0: return '.'
    if a < 200: return ':'
    if r > 200 and 130 < g < 190 and b < 120: return 'O'
    if r > 120 and g > 80 and b < 100 and r - b > 60: return 'o'
    if b > 180 and g > 160 and r > 130 and b - r > 20: return 'B'
    if b - r > 25 and b > 70: return 'b'
    if abs(r - g) < 14 and abs(g - b) < 18 and r > 120: return 'R'
    if abs(r - g) < 14 and abs(g - b) < 18 and 70 < r <= 120: return 'r'
    if r < 25 and g < 35 and b < 45 and b - r > 8: return 'n'
    if max(r, g, b) < 70: return '#'
    return '?'

for f in sys.argv[1:]:
    im = Image.open(f).convert('RGBA')
    w, h = im.size
    print(f, im.size)
    print('   ' + ''.join(str(x % 10) for x in range(w)))
    for y in range(h):
        print(f'{y:2d} ' + ''.join(cls(im.getpixel((x, y))) for x in range(w)))
