## Current 0.1.4 Core adoption

FFmpeg Core is now selected from `packages/browser-media/vendor/ffmpeg-core/manifest.json`. The executed, pinned source build produced both UMD and ESM JavaScript/WASM. All four files directly equal the accepted `@ffmpeg/core@0.12.10` bytes. The source chain, immutable inputs, compiler image, actual FFmpeg compilation/link/export and browser output acceptance are recorded in `apps/extension/release/codec-rebuild/source-lock.json` and its receipts. Dependency stages reused preserved caches; a second cold rebuild and the historical publisher checkout timeline are not claimed.

The offered H264/AAC, MP4/MOV and audio formats and WebM import passed the owned Core browser acceptance. Auxiliary VP9 encoding crashed, the separate x265 diagnostic timed out, and the pinned ffprobe wrapper returns -1 despite producing validated JSON. These limits are retained in the receipts. The current product does not offer VP9/HEVC exports or call that ffprobe wrapper.

Standalone owned AAC/MP3/FLAC candidates also passed separate source/build/browser tests. The product still embeds the original Mediabunny encoder modules; their historical compiler/source limits remain. A Git application-source ZIP includes the owned Core binaries and recipe records, but the bulk source archives, actual offline build context and raw evidence are supplied in the separate Core source bundle. No legal compliance attestation is made.

The following earlier procurement notes remain historical where they say no rebuild was performed or a historical receipt is absent. They are superseded for the newly executed Core build by the current owned-Core records, and remain applicable to unadopted original encoder binaries.

# Exact codec source and build evidence

## Shipped npm runtime

@ffmpeg/core **0.12.10**, GPL-2.0-or-later; @ffmpeg/ffmpeg **0.12.15** and @ffmpeg/types **0.12.4**, MIT wrappers. The [npm core archive](https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz) was published 2025-01-07. WASM identifies FFmpeg 5.1.4 and Emscripten 3.1.40, revision5c27e79dd0a9c4e27ef2326841698cdd4f6b5784. Exact npm integrities/runtime hashes are in [CODEC-ARTIFACT-INVENTORY.json](CODEC-ARTIFACT-INVENTORY.json).

The unmodified WASM is **32,232,419 bytes**, SHA-256 **9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7**. Sites transports16MiB and15,455,203-byte parts; reassembly is byte-for-byte checked against npm. ESM/classic JS remain unchanged npm glue. Chunk transport does not change source obligations.

The fixed recipe is [ffmpeg.wasm v12.15,71aa99d37c02a7b4c435275ca9ef50e612f6efa1](https://github.com/ffmpegwasm/ffmpeg.wasm/tree/71aa99d37c02a7b4c435275ca9ef50e612f6efa1), including Dockerfile, Makefile, build/ffmpeg.sh and build/ffmpeg-wasm.sh. Tag v0.12.10 has core 0.12.6 and is not the source association for core 0.12.10.

Configuration actually present in shipped WASM:

~~~text
--target-os=none --arch=x86_32 --enable-cross-compile --disable-asm --disable-stripping --disable-programs --disable-doc --disable-debug --disable-runtime-cpudetect --disable-autodetect --nm=emnm --ar=emar --ranlib=emranlib --cc=emcc --cxx=em++ --objcc=emcc --dep-cc=emcc --extra-cflags='-I/opt/include -O3 -msimd128' --extra-cxxflags='-I/opt/include -O3 -msimd128' --disable-pthreads --disable-w32threads --disable-os2threads --enable-gpl --enable-libx264 --enable-libx265 --enable-libvpx --enable-libmp3lame --enable-libtheora --enable-libvorbis --enable-libopus --enable-zlib --enable-libwebp --enable-libfreetype --enable-libfribidi --enable-libass --enable-libzimg
~~~

## Source material actually acquired

**26 verified archives / 241,265,704 bytes (230.09 MiB)**. Original recipe/FFmpeg/installed-MPL archives remain in sources unchanged. New large archives are separate from Git/static deployment. [The source manifest](CODEC-SOURCE-MANIFEST.json) supplies immutable primary URLs/lengths/hashes. The source repository's release/codec-sources/manage-sources.mjs fetches, verifies and extracts them; its README gives executable commands/local collection location. No public download URL for our separate local collection is asserted.

| Core recipe component | Identified recipe ref / environment | Fixed primary source snapshot |
| --- | --- | --- |
| ffmpeg | n5.1.4 | [4729204c17f756e186d622060088371d10b34f7e](https://codeload.github.com/FFmpeg/FFmpeg/tar.gz/4729204c17f756e186d622060088371d10b34f7e) |
| x264 | 4-cores | [33cac6b77d5b9259c552156013a817ab23119612](https://codeload.github.com/ffmpegwasm/x264/tar.gz/33cac6b77d5b9259c552156013a817ab23119612) |
| x265 | 3.4 | [2bb5520e9596f361bf0ed81b3b8da0d7fd999069](https://codeload.github.com/ffmpegwasm/x265/tar.gz/2bb5520e9596f361bf0ed81b3b8da0d7fd999069) |
| libvpx | v1.13.1 | [10b9492dcf05b652e2e4b370e205bd605d421972](https://codeload.github.com/ffmpegwasm/libvpx/tar.gz/10b9492dcf05b652e2e4b370e205bd605d421972) |
| lame | master | [2badea1974ae36cb8312afe99cff1e6b3b5decee](https://codeload.github.com/ffmpegwasm/lame/tar.gz/2badea1974ae36cb8312afe99cff1e6b3b5decee) |
| ogg | v1.3.4 | [bada45718453ac27b56773ae663f7e65112f6a6e](https://codeload.github.com/ffmpegwasm/Ogg/tar.gz/bada45718453ac27b56773ae663f7e65112f6a6e) |
| theora | v1.1.1 | [7ffd8b2ecfc2d93ae5e16028e7528e609266bfbf](https://codeload.github.com/ffmpegwasm/theora/tar.gz/7ffd8b2ecfc2d93ae5e16028e7528e609266bfbf) |
| opus | v1.3.1 | [e85ed7726db5d677c9c0677298ea0cb9c65bdd23](https://codeload.github.com/ffmpegwasm/opus/tar.gz/e85ed7726db5d677c9c0677298ea0cb9c65bdd23) |
| vorbis | v1.3.3 | [7798164043197d7e33f02de4353ce2aa5b248225](https://codeload.github.com/ffmpegwasm/vorbis/tar.gz/7798164043197d7e33f02de4353ce2aa5b248225) |
| zlib | v1.2.11 | [cacf7f1d4e3d44d871b605da3b647f07d718623f](https://codeload.github.com/ffmpegwasm/zlib/tar.gz/cacf7f1d4e3d44d871b605da3b647f07d718623f) |
| libwebp | v1.3.2 | [ca332209cb5567c9b249c86788cb2dbf8847e760](https://codeload.github.com/ffmpegwasm/libwebp/tar.gz/ca332209cb5567c9b249c86788cb2dbf8847e760) |
| freetype2 | VER-2-10-4 | [6a2b3e4007e794bfc6c91030d0ed987f925164a8](https://codeload.github.com/ffmpegwasm/freetype2/tar.gz/6a2b3e4007e794bfc6c91030d0ed987f925164a8) |
| fribidi | v1.0.9 | [f9e8e71a6fbf4a4619481284c9f484d10e559995](https://codeload.github.com/fribidi/fribidi/tar.gz/f9e8e71a6fbf4a4619481284c9f484d10e559995) |
| harfbuzz | 5.2.0 | [4a1d891c6317d2c83e5f3c2607ec5f5ccedffcde](https://codeload.github.com/harfbuzz/harfbuzz/tar.gz/4a1d891c6317d2c83e5f3c2607ec5f5ccedffcde) |
| libass | 0.15.0 | [d149636f502f5774ae1a8fb4c554b122674393b2](https://codeload.github.com/libass/libass/tar.gz/d149636f502f5774ae1a8fb4c554b122674393b2) |
| zimg | release-3.0.5 | [e5b0de6bebbcbc66732ed5afaafef6b2c7dfef87](https://codeload.github.com/sekrit-twc/zimg/tar.gz/e5b0de6bebbcbc66732ed5afaafef6b2c7dfef87) |
| zimg-googletest | Zimg recursive submodule test/extra/googletest | [703bd9caab50b139428cea1aaff9974ebee5742e](https://codeload.github.com/google/googletest/tar.gz/703bd9caab50b139428cea1aaff9974ebee5742e) |
| emsdk | 3.1.40 | [ae245715ef50e036b68a2412a323129676bf8300](https://codeload.github.com/emscripten-core/emsdk/tar.gz/ae245715ef50e036b68a2412a323129676bf8300) |
| emscripten | 3.1.40 | [5c27e79dd0a9c4e27ef2326841698cdd4f6b5784](https://codeload.github.com/emscripten-core/emscripten/tar.gz/5c27e79dd0a9c4e27ef2326841698cdd4f6b5784) |
| sdl2 | Emscripten 3.1.40 port release-2.24.2 | [55b03c7493a7abed33cf803d1380a40fa8af903f](https://codeload.github.com/libsdl-org/SDL/tar.gz/55b03c7493a7abed33cf803d1380a40fa8af903f) |

All recipe build scripts are preserved. Emscripten's SDL2 port selects 2.24.2; zimg's recursive googletest submodule is separately archived. prepare-recipe emits Dockerfile.pinned and SOURCE-LOCK.json, without compiling. Container image/frontend digests and apt versions remain unfixed original inputs.

Historical bounds are useful, without proving association: selected x2644-cores tip33cac6b… dates 2022-08-22; selected LAME master2badea1… is its2020-10-29 LAME 3.100 initial commit. Both predate the2025 core publication. Core contains3.100 and x264 - core0000, without usable x264 Git revision. No historical build receipt or bit-identical rebuild is claimed.

## Mediabunny source mapping

Mediabunny 1.61.0 npm gitHead is **0f91fe768e7ee42703f15e2b8845551b0f1028b3**. Nested1.56.1 and all three encoder 1.56.1 packages resolve to **cee57d1cdfd1776d515c081057b50eb337291e32**. Both complete archives are acquired, including shared TypeScript helpers, root build setup, C bridges, original glue/WASM and MP3 relink archive/header. They restore material omitted by npm's source-directory copy.

Read-only AST literal decoding proves that installed encoder WASM equals its embedded module at that fixed upstream commit. No encoder JS/WASM was evaluated.

| Encoder | WASM bytes | SHA-256 | Embedded source identifier |
| --- | --- | --- | --- |
| @mediabunny/aac-encoder@1.56.1 | 509386 | 8488acb0bc9f43055b83600cc4c2c07d20f07675aa65671f91ac1d75515845d9 | Lavc62.23.103 |
| @mediabunny/mp3-encoder@1.56.1 | 223033 | d0b109db83c153b81ba0080fa2163664dff1e341b154edda6d40bc4b6fbc355e | LAME 3.100 in original static archive |
| @mediabunny/flac-encoder@1.56.1 | 166140 | ea25f2da12550128391e0d83465deb887c3bef96b7ee4a9b34ebb1d8202fffbe | reference libFLAC git-3f1ecff8 20260304 |

**AAC:** [original instructions](https://github.com/Vanilagy/mediabunny/blob/cee57d1cdfd1776d515c081057b50eb337291e32/packages/aac-encoder/README.md) build only avcodec/AAC+avutil, -Oz/-flto/-msimd128, disabled assembly/threads/other codecs, then single-file WASM C bridge. They pin neither FFmpeg nor Emscripten. Lavc62.23.103 was [introduced at 499b5f5…](https://github.com/FFmpeg/FFmpeg/commit/499b5f5f92f73e5b0e6108242983695fcb6409e2),2026-01-27, and [bumped at e245f4d…](https://github.com/FFmpeg/FFmpeg/commit/e245f4d5cf642faa6f43002654dfc84ba457b78c),2026-02-28. This interval cannot select original checkout/patchset/compiler. Core's5.1.4 source cannot substitute. Included generic FFmpeg LGPLv2.1 notice is a license text, not exact source attestation.

**MP3:** [original instructions](https://github.com/Vanilagy/mediabunny/blob/cee57d1cdfd1776d515c081057b50eb337291e32/packages/mp3-encoder/README.md) identify SIMD LAME 3.100,-O3/-msimd128,NO_STDIO and no decoder/frontend/analyzer. [Official LAME 3.100 source](https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz) is acquired. Original344,180-byte libmp3lame.a is in the complete upstream archive, SHA-256 **73b562e4a14ec1c396044ad84b836a444794177bd4bce7956268de2fe84ca77d**. Its strings identify3.100 and clang 22.0.0git / [LLVM 7f934878…](https://github.com/llvm/llvm-project/tree/7f93487862d98bf1c168babba87daf6224d8a46f). This supplies the actual relink object; original patches/full compiler build are unrecorded.

**FLAC:** identifier reference libFLAC git-3f1ecff8 20260304 selects [3f1ecff843dd1b8c07fbb5f59425a4ec71fe4f6c](https://github.com/xiph/flac/tree/3f1ecff843dd1b8c07fbb5f59425a4ec71fe4f6c); source/notices are acquired. [Recipe](https://github.com/Vanilagy/mediabunny/blob/cee57d1cdfd1776d515c081057b50eb337291e32/packages/flac-encoder/README.md) disables programs/C++/examples/tests/Ogg/shared/multithreading and uses-Oz/-flto/-msimd128. None of these 3 final WASM modules has compiler/producers custom metadata; exact compiler/rebuilt-byte association remains untested.

## Minimal remaining provenance evidence

Core needs its original upstream receipt fixing historical x264/LAME checkouts and container/apt inputs against core 0.12.10. AAC needs exact FFmpeg checkout/patchset and compiler/build record for the already matched encoder WASM. MP3 needs original patch/toolchain provenance; FLAC source is pinned but compiler/relink reproduction untested. An approved pinned rebuild could replace an historically unprovable binary, with new hashes/codec acceptance; none was performed.

Original notices are under upstream with [source/hash mapping](UPSTREAM-NOTICES.json). Acquired material resolves previously missing components without claiming complete legal corresponding-source/relink approval or bit-identical reproduction. [Official FFmpeg guidance](https://ffmpeg.org/legal.html) remains applicable.
