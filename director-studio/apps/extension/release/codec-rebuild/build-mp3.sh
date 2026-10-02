#!/usr/bin/env bash
set -euo pipefail
umask 022
export SOURCE_DATE_EPOCH=1772582400
export LC_ALL=C
export TZ=UTC
mkdir -p /build/lame /build/mediabunny /out /tmp/emcc
export EMCC_TEMP_DIR=/tmp/emcc
tar -xzf /sources/lame-3.100-official.tar.gz --strip-components=1 -C /build/lame
tar -xzf /sources/mediabunny-encoders-cee57d1cdfd1776d515c081057b50eb337291e32.tar.gz --strip-components=1 -C /build/mediabunny
emcc --version > /out/emcc-version.txt
dpkg-query -W -f='${binary:Package}\t${Version}\n' | LC_ALL=C sort > /out/container-packages.lock
cd /build/lame
emconfigure ./configure CFLAGS="-DNDEBUG -DNO_STDIO -O3 -msimd128" \
  --disable-dependency-tracking --disable-shared --disable-gtktest \
  --disable-analyzer-hooks --disable-decoder --disable-frontend
emmake make -j2
emcc /build/mediabunny/packages/mp3-encoder/src/lame-bridge.c \
  /build/lame/libmp3lame/.libs/libmp3lame.a \
  -sDYNAMIC_EXECUTION=0 -sMODULARIZE=1 -sEXPORT_ES6=1 -sSINGLE_FILE=1 -sALLOW_MEMORY_GROWTH=1 \
  -sENVIRONMENT=web,worker -sEXPORTED_RUNTIME_METHODS=cwrap,HEAPU8 \
  -sEXPORTED_FUNCTIONS=_malloc,_free -msimd128 -O3 -o /out/lame.js
cp /build/lame/libmp3lame/.libs/libmp3lame.a /out/libmp3lame.a
cp /build/lame/config.log /out/lame-config.log
cp /build/lame/config.h /out/lame-config.h
sha256sum /out/lame.js /out/libmp3lame.a > /out/output.sha256
