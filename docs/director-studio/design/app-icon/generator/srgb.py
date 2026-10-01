#!/usr/bin/env python3
"""Tag PNG files as sRGB in place: insert sRGB (perceptual) plus the matching gAMA and cHRM chunks right after IHDR,
as the PNG spec recommends for decoders that ignore sRGB. Pixel data (IDAT) is left byte-for-byte unchanged.
Idempotent: files that already carry sRGB, iCCP, gAMA or cHRM are left alone. Usage: srgb.py FILE.png..."""
import struct
import sys
import zlib

SIG = b'\x89PNG\r\n\x1a\n'


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)


SRGB = chunk(b'sRGB', b'\x00')
GAMA = chunk(b'gAMA', struct.pack('>I', 45455))
CHRM = chunk(b'cHRM', struct.pack('>8I', 31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000))


def chunks(buf):
    i = 8
    while i < len(buf):
        n = struct.unpack('>I', buf[i:i + 4])[0]
        yield buf[i + 4:i + 8], i, i + 12 + n
        i += 12 + n


def tag_bytes(buf):
    assert buf[:8] == SIG, 'not a PNG'
    kinds = [k for k, _, _ in chunks(buf)]
    if any(k in kinds for k in (b'sRGB', b'iCCP', b'gAMA', b'cHRM')):
        return buf
    _, _, ihdr_end = next(chunks(buf))
    return buf[:ihdr_end] + SRGB + GAMA + CHRM + buf[ihdr_end:]


def tag(path):
    buf = open(path, 'rb').read()
    out = tag_bytes(buf)
    if out is not buf:
        open(path, 'wb').write(out)
    return out


if __name__ == '__main__':
    for p in sys.argv[1:]:
        tag(p)
    print('srgb-tagged', len(sys.argv) - 1, 'files')
