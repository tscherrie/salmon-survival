#!/usr/bin/env bash
set -euo pipefail
umask 022
export LC_ALL=C
export TZ=UTC
export SOURCE_DATE_EPOCH=1772582400
mkdir -p /build/flac /build/mediabunny /tmp/emcc
export EMCC_TEMP_DIR=/tmp/emcc
tar -xzf /sources/flac-3f1ecff843dd1b8c07fbb5f59425a4ec71fe4f6c.tar.gz --strip-components=1 -C /build/flac
tar -xzf /sources/mediabunny-encoders-cee57d1cdfd1776d515c081057b50eb337291e32.tar.gz --strip-components=1 -C /build/mediabunny
emcc /build/mediabunny/packages/flac-encoder/src/bridge.c \
  /out/libFLAC.a -I/build/flac/include \
  -sMODULARIZE=1 -sEXPORT_ES6=0 -sSINGLE_FILE=1 \
  -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,worker -sFILESYSTEM=0 \
  -sMALLOC=emmalloc -sSUPPORT_LONGJMP=0 -sDYNAMIC_EXECUTION=0 \
  -sEXPORTED_RUNTIME_METHODS=cwrap,HEAPU8 -sEXPORTED_FUNCTIONS=_malloc,_free \
  -msimd128 -flto -Oz -o /out/flac-classic.js
sha256sum /out/flac-classic.js > /out/classic.sha256
