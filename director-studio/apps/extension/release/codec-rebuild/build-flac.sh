#!/usr/bin/env bash
set -euo pipefail
umask 022
export SOURCE_DATE_EPOCH=1772582400
export LC_ALL=C
export TZ=UTC
export EMCC_TEMP_DIR=/tmp/emcc
mkdir -p /build/flac /build/mediabunny /out /tmp/emcc
printf '%s  %s\n' '4ace54db53e274f6c73999a644b0a11410f67e5c35c06e4aaa8e5457bbf59f9d' '/sources/flac-3f1ecff843dd1b8c07fbb5f59425a4ec71fe4f6c.tar.gz' | sha256sum -c -
printf '%s  %s\n' '3fb1c82b9cd8c337b7b1bf8393ad4d0d84b8d569bce97bddf18fc51d580c51bf' '/sources/mediabunny-encoders-cee57d1cdfd1776d515c081057b50eb337291e32.tar.gz' | sha256sum -c -
tar -xzf /sources/flac-3f1ecff843dd1b8c07fbb5f59425a4ec71fe4f6c.tar.gz --strip-components=1 -C /build/flac
tar -xzf /sources/mediabunny-encoders-cee57d1cdfd1776d515c081057b50eb337291e32.tar.gz --strip-components=1 -C /build/mediabunny
emcc --version > /out/emcc-version.txt
cmake --version > /out/cmake-version.txt
dpkg-query -W -f='${binary:Package}\t${Version}\n' | LC_ALL=C sort > /out/container-packages.lock
emcmake cmake -S /build/flac -B /build/flac-wasm \
  -DBUILD_PROGRAMS=OFF -DBUILD_CXXLIBS=OFF -DBUILD_EXAMPLES=OFF \
  -DBUILD_TESTING=OFF -DWITH_OGG=OFF -DBUILD_SHARED_LIBS=OFF \
  -DENABLE_MULTITHREADING=OFF -DINSTALL_MANPAGES=OFF \
  -DCMAKE_C_FLAGS="-DNDEBUG -Oz -flto -msimd128" \
  -DCMAKE_C_FLAGS_RELEASE="-DNDEBUG -Oz -flto -msimd128"
cmake --build /build/flac-wasm --parallel 2
emcc /build/mediabunny/packages/flac-encoder/src/bridge.c \
  /build/flac-wasm/src/libFLAC/libFLAC.a -I/build/flac/include \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sSINGLE_FILE=1 \
  -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,worker -sFILESYSTEM=0 \
  -sMALLOC=emmalloc -sSUPPORT_LONGJMP=0 -sDYNAMIC_EXECUTION=0 \
  -sEXPORTED_RUNTIME_METHODS=cwrap,HEAPU8 -sEXPORTED_FUNCTIONS=_malloc,_free \
  -msimd128 -flto -Oz -o /out/flac.js
cp /build/flac-wasm/CMakeCache.txt /out/flac-CMakeCache.txt
cp /build/flac-wasm/src/libFLAC/libFLAC.a /out/libFLAC.a
sha256sum /out/flac.js /out/libFLAC.a > /out/output.sha256
