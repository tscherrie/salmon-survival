#!/usr/bin/env bash
set -euo pipefail
umask 022
export LC_ALL=C
export TZ=UTC
export SOURCE_DATE_EPOCH=1772582400
mkdir -p /out
printf '%s  %s\n' 'ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e' '/sources/lame-3.100-official.tar.gz' | sha256sum -c -
printf '%s  %s\n' '3fb1c82b9cd8c337b7b1bf8393ad4d0d84b8d569bce97bddf18fc51d580c51bf' '/sources/mediabunny-encoders-cee57d1cdfd1776d515c081057b50eb337291e32.tar.gz' | sha256sum -c -
# Execute the prepared source recipe with one make job under the bounded container.
# The tracked recipe is unchanged; preserve this exact executed variant in the receipt directory.
sed 's/emmake make -j2/emmake make -j1/' /recipe/build-mp3.sh > /out/build-mp3-executed.sh
bash /out/build-mp3-executed.sh
emcc /build/mediabunny/packages/mp3-encoder/src/lame-bridge.c /out/libmp3lame.a \
  -sDYNAMIC_EXECUTION=0 -sMODULARIZE=1 -sEXPORT_ES6=0 -sEXPORT_NAME=createMp3Module \
  -sSINGLE_FILE=1 -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,worker \
  -sFILESYSTEM=0 -sMALLOC=emmalloc -sSUPPORT_LONGJMP=0 \
  -sEXPORTED_RUNTIME_METHODS=cwrap,HEAPU8 -sEXPORTED_FUNCTIONS=_malloc,_free \
  -msimd128 -O3 -o /out/lame-classic.js
sha256sum /out/lame.js /out/lame-classic.js /out/libmp3lame.a > /out/classic.sha256
