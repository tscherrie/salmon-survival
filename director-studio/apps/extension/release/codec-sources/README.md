## Current 0.1.4 Core adoption

FFmpeg Core is now selected from `packages/browser-media/vendor/ffmpeg-core/manifest.json`. The executed, pinned source build produced both UMD and ESM JavaScript/WASM. All four files directly equal the accepted `@ffmpeg/core@0.12.10` bytes. The source chain, immutable inputs, compiler image, actual FFmpeg compilation/link/export and browser output acceptance are recorded in `apps/extension/release/codec-rebuild/source-lock.json` and its receipts. Dependency stages reused preserved caches; a second cold rebuild and the historical publisher checkout timeline are not claimed.

The offered H264/AAC, MP4/MOV and audio formats and WebM import passed the owned Core browser acceptance. Auxiliary VP9 encoding crashed, the separate x265 diagnostic timed out, and the pinned ffprobe wrapper returns -1 despite producing validated JSON. These limits are retained in the receipts. The current product does not offer VP9/HEVC exports or call that ffprobe wrapper.

Standalone owned AAC/MP3/FLAC candidates also passed separate source/build/browser tests. The product still embeds the original Mediabunny encoder modules; their historical compiler/source limits remain. A Git application-source ZIP includes the owned Core binaries and recipe records, but the bulk source archives, actual offline build context and raw evidence are supplied in the separate Core source bundle. No legal compliance attestation is made.

The following earlier procurement notes remain historical where they say no rebuild was performed or a historical receipt is absent. They are superseded for the newly executed Core build by the current owned-Core records, and remain applicable to unadopted original encoder binaries.

# Verified codec source collection

manifest.json fixes primary URLs, lengths, SHA-256 values, commits and correspondence qualifications. artifact-inventory.json records npm/runtime files and embedded WASM. notices.json maps copied original license texts to source files. These small records belong in Git; large archives do not.

The local collection is /Users/jeremias/Documents/Codex/2026-10-02/ai-director-studio-codec-sources: **26 archives / 241,265,704 bytes (230.09 MiB)**. The original three files in public/licenses/sources are preserved and copied here too. No private media/credentials are included. No public URL for this local collection is claimed.

From director-studio, with Node.js 22+, tar and source-network access:

```sh
node apps/extension/release/codec-sources/manage-sources.mjs fetch /absolute/path/codec-sources
node apps/extension/release/codec-sources/manage-sources.mjs verify /absolute/path/codec-sources
node apps/extension/release/codec-sources/manage-sources.mjs prepare-recipe /absolute/path/codec-sources
node apps/extension/release/codec-sources/audit-artifacts.mjs /absolute/path/codec-sources
node --test apps/extension/release/codec-sources/manage-sources.test.mjs
```

fetch accepts only fixed GitHub commit archives and the official LAME release, or copies the preserved installed-source archive. Cached/downloaded bytes must match the manifest. verify is offline. prepare-recipe extracts sources and emits extracted/ffmpegwasm-recipe/Dockerfile.pinned plus SOURCE-LOCK.json, with explicit fixed source refs and recursive zimg checkout. It **does not compile** or alter runtime. A future GitHub archival compression change causes an integrity rejection, not silent acceptance.

The artifact audit requires installed dependencies and an already built ../dist/client/runtime/ffmpeg. It decodes literal WASM with Acorn, compares exact upstream bytes and hashes the original MP3 relink archive. It never evaluates encoder JS/WASM. Timestamp metadata is not deterministic output evidence.

| Runtime | Supplied preferred source / relink/build material | Remaining limit |
| --- | --- | --- |
| FFmpeg core 0.12.10, original 32,232,419-byte WASM | FFmpeg 5.1.4 4729204…; recipe71aa99d…; linked sources, zimg submodule, Emscripten 3.1.40 and SDL2 2.24.2 | Historical receipt/image/apt locks absent; x264/LAME branch snapshots are newly fixed references |
| Mediabunny 1.56.1 / encoder wrappers | Complete repository cee57d1… with shared helpers, C bridges, build setup and original embedded WASM | Exact npm gitHead and3 WASM matches verified; underlying codec builds assessed separately |
| Mediabunny 1.61.0 | Complete repository0f91fe7… with shared helpers/build setup | npm gitHead association; two runtime versions are not declared interchangeable |
| AAC 509,386-byte WASM | Original AAC bridge/wrapper/shared/glue/build instructions at cee57d1… | Lavc62.23.103 does not select exact FFmpeg checkout; core's5.1.4 source cannot substitute |
| MP3 223,033-byte WASM | Official LAME 3.100; original build/libmp3lame.a, lib/lame.h and bridge/glue at cee57d1… | Relink object exists; original patchset/full compiler build unrecorded |
| FLAC 166,140-byte WASM | Exact libFLAC3f1ecff843dd1b8c07fbb5f59425a4ec71fe4f6c plus original bridge/glue | Source identifier established; compiler/rebuilt-byte correspondence untested |

The bundle supplies what was obtainable and leaves its limits explicit. It must not be labelled a legally verified complete corresponding-source package. See [../ffmpeg-source.md](../ffmpeg-source.md) and [../../public/licenses/FFMPEG-SOURCE.md](../../public/licenses/FFMPEG-SOURCE.md). A future approved rebuild needs its own hashes/codec output acceptance; none was performed.
