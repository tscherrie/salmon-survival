# FFmpeg 0.12.10 source and build evidence

## Verified binary and release facts

- Installed npm package: `@ffmpeg/core@0.12.10`, license `GPL-2.0-or-later`, single-thread ESM.
- Published npm archive: <https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz>.
- npm integrity: `sha512-dzNplnn2Nxle2c2i2rrDhqcB19q9cglCkWnoMTDN9Q9l3PvdjZWd1HfSPjCNWc/p8Q3CT+Es9fWOR0UhAeYQZA==`.
- Upstream release: <https://github.com/ffmpegwasm/ffmpeg.wasm/releases/tag/v12.15>.
- Build recipe commit: `71aa99d37c02a7b4c435275ca9ef50e612f6efa1` (tag v12.15).
- FFmpeg source tag `n5.1.4` resolves to commit `4729204c17f756e186d622060088371d10b34f7e`; annotated tag object `80e7806be7f10c038bef2e71905e91af174c28e9`.
- The installed WASM strings identify version 5.1.4 and the production `-O3 -msimd128` configuration below. This verifies identifiable build facts, not byte-for-byte reproducibility.

The included archives contain the immutable build recipe and identified FFmpeg source. Archive download URLs, byte sizes and SHA-256 are recorded in `inventory.json` and `SHA256SUMS`.

## Upstream build recipe

Read the complete [Dockerfile](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/Dockerfile), [Makefile](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/Makefile), [configure script](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/build/ffmpeg.sh) and [WASM link script](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/build/ffmpeg-wasm.sh).

The recipe uses Emscripten SDK Docker image `emscripten/emsdk:3.1.40`. Its documented production single-thread build is:

```sh
git clone https://github.com/ffmpegwasm/ffmpeg.wasm.git
cd ffmpeg.wasm
git checkout 71aa99d37c02a7b4c435275ca9ef50e612f6efa1
make prd
```

This is the upstream documented command. It has **not** been executed or claimed to reproduce the npm binary in this release preparation. Before a controlled rebuild, replace every mutable library source reference with the verified original revision or a deliberately selected new revision and record those changes. Rebuilding with newly selected revisions produces a new binary that needs new hashes and output regression tests.

The binary's configure string is:

```text
--target-os=none --arch=x86_32 --enable-cross-compile --disable-asm --disable-stripping --disable-programs --disable-doc --disable-debug --disable-runtime-cpudetect --disable-autodetect --nm=emnm --ar=emar --ranlib=emranlib --cc=emcc --cxx=em++ --objcc=emcc --dep-cc=emcc --extra-cflags='-I/opt/include -O3 -msimd128' --extra-cxxflags='-I/opt/include -O3 -msimd128' --disable-pthreads --disable-w32threads --disable-os2threads --enable-gpl --enable-libx264 --enable-libx265 --enable-libvpx --enable-libmp3lame --enable-libtheora --enable-libvorbis --enable-libopus --enable-zlib --enable-libwebp --enable-libfreetype --enable-libfribidi --enable-libass --enable-libzimg
```

## Source completeness still unresolved

The recipe references these sources; a GitHub source archive of the main repository does not include them:

| Library | Recipe repository/ref |
| --- | --- |
| FFmpeg | FFmpeg/FFmpeg, n5.1.4 |
| x264 | ffmpegwasm/x264, **mutable branch 4-cores** |
| x265 | ffmpegwasm/x265, 3.4 |
| libvpx | ffmpegwasm/libvpx, v1.13.1 |
| LAME | ffmpegwasm/lame, **mutable master** |
| Ogg | ffmpegwasm/Ogg, v1.3.4 |
| Theora | ffmpegwasm/theora, v1.1.1 |
| Opus | ffmpegwasm/opus, v1.3.1 |
| Vorbis | ffmpegwasm/vorbis, v1.3.3 |
| zlib | ffmpegwasm/zlib, v1.2.11 |
| libwebp | ffmpegwasm/libwebp, v1.3.2 |
| FreeType | ffmpegwasm/freetype2, VER-2-10-4 |
| FriBidi | fribidi/fribidi, v1.0.9 |
| HarfBuzz | harfbuzz/harfbuzz, 5.2.0 |
| libass | libass/libass, 0.15.0 |
| zimg | sekrit-twc/zimg, release-3.0.5, recursively cloned |
| SDL2/system libraries | supplied by the Emscripten build environment |

The exact historical source commits for mutable refs and any relevant patches/submodules/toolchain materials have not been established from the npm publication. The provided source download is therefore explicitly partial. Complete corresponding source requires the whole relevant source and build set, including modifications and required scripts, associated with the actual binary; upstream links alone are not a substitute for that verification. The [official FFmpeg legal page](https://ffmpeg.org/legal.html) explicitly calls for source corresponding to the distributed binary and build details.

A concrete resolution is either obtain the original upstream build provenance/source set for core 0.12.10, or perform a controlled pinned rebuild and publish its complete source/build archive beside the new binary. Do not mark public codec-source compliance complete before this is done.
