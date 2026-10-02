#!/usr/bin/env bash
set -euo pipefail
umask 022
export LC_ALL=C
export TZ=UTC
export SOURCE_DATE_EPOCH=1772582400
mkdir -p /build/mediabunny /out
tar -xzf /sources/mediabunny-encoders-cee57d1cdfd1776d515c081057b50eb337291e32.tar.gz --strip-components=1 -C /build/mediabunny
# Relink support only: this deliberately retains the ORIGINAL upstream static archive.
# It does not establish its unrecorded historical LAME patch/toolchain provenance.
emcc /build/mediabunny/packages/mp3-encoder/src/lame-bridge.c \
  /build/mediabunny/packages/mp3-encoder/build/libmp3lame.a \
  -sDYNAMIC_EXECUTION=0 -sMODULARIZE=1 -sEXPORT_ES6=1 -sSINGLE_FILE=1 -sALLOW_MEMORY_GROWTH=1 \
  -sENVIRONMENT=web,worker -sEXPORTED_RUNTIME_METHODS=cwrap,HEAPU8 \
  -sEXPORTED_FUNCTIONS=_malloc,_free -msimd128 -O3 -o /out/lame-relinked.js
sha256sum /out/lame-relinked.js > /out/output.sha256
