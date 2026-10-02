#!/usr/bin/env bash
set -euo pipefail
umask 022
export LC_ALL=C
export TZ=UTC
export SOURCE_DATE_EPOCH=1772582400
mkdir -p /build/ffmpeg /build/mediabunny /out /tmp/emcc
export EMCC_TEMP_DIR=/tmp/emcc
printf '%s  %s\n' 'e5c84419677f2aa84d062515214ad3d893b26e467f54d3b347e522de8f6ba61d' '/new-sources/aac-ffmpeg-499b5f5f92f73e5b0e6108242983695fcb6409e2.tar.gz' | sha256sum -c -
printf '%s  %s\n' '3fb1c82b9cd8c337b7b1bf8393ad4d0d84b8d569bce97bddf18fc51d580c51bf' '/sources/mediabunny-encoders-cee57d1cdfd1776d515c081057b50eb337291e32.tar.gz' | sha256sum -c -
printf '%s  %s\n' 'ef37c323dd23b81e108e97674fa0167947accdedb36c26d27e79f2fcde6d5fc0' '/built/libavcodec.a' | sha256sum -c -
printf '%s  %s\n' '802f710f79df3adb6bcdc2053d4322aa365f66fdf8ffb7cff790a66e7de7484e' '/built/libavutil.a' | sha256sum -c -
tar -xzf /new-sources/aac-ffmpeg-499b5f5f92f73e5b0e6108242983695fcb6409e2.tar.gz --strip-components=1 -C /build/ffmpeg
tar -xzf /sources/mediabunny-encoders-cee57d1cdfd1776d515c081057b50eb337291e32.tar.gz --strip-components=1 -C /build/mediabunny
# Recreate generated public headers, then link the already compiled libraries from a read-only mount.
cd /build/ffmpeg
emconfigure ./configure \
  --target-os=none --arch=x86_32 --enable-cross-compile --disable-asm \
  --disable-x86asm --disable-inline-asm --disable-programs --disable-doc \
  --disable-debug --disable-all --disable-everything --disable-autodetect \
  --disable-pthreads --disable-runtime-cpudetect --enable-avcodec --enable-encoder=aac \
  --cc=emcc --cxx=em++ --ar=emar --ranlib=emranlib \
  --extra-cflags="-DNDEBUG -Oz -flto -msimd128" --extra-ldflags="-Oz -flto"
emcc /build/mediabunny/packages/aac-encoder/src/bridge.c \
  /built/libavcodec.a /built/libavutil.a -I/build/ffmpeg \
  -sMODULARIZE=1 -sEXPORT_ES6=0 -sEXPORT_NAME=createAacModule -sSINGLE_FILE=1 \
  -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,worker -sFILESYSTEM=0 \
  -sMALLOC=emmalloc -sSUPPORT_LONGJMP=0 -sDYNAMIC_EXECUTION=0 \
  -sEXPORTED_RUNTIME_METHODS=cwrap,HEAPU8 -sEXPORTED_FUNCTIONS=_malloc,_free \
  -msimd128 -flto -Oz -o /out/aac-classic.js
emcc --version > /out/emcc-version.txt
sha256sum /built/libavcodec.a /built/libavutil.a /out/aac-classic.js > /out/classic.sha256
