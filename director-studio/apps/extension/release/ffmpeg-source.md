## Current 0.1.4 Core adoption

FFmpeg Core is now selected from `packages/browser-media/vendor/ffmpeg-core/manifest.json`. The executed, pinned source build produced both UMD and ESM JavaScript/WASM. All four files directly equal the accepted `@ffmpeg/core@0.12.10` bytes. The source chain, immutable inputs, compiler image, actual FFmpeg compilation/link/export and browser output acceptance are recorded in `apps/extension/release/codec-rebuild/source-lock.json` and its receipts. Dependency stages reused preserved caches; a second cold rebuild and the historical publisher checkout timeline are not claimed.

The offered H264/AAC, MP4/MOV and audio formats and WebM import passed the owned Core browser acceptance. Auxiliary VP9 encoding crashed, the separate x265 diagnostic timed out, and the pinned ffprobe wrapper returns -1 despite producing validated JSON. These limits are retained in the receipts. The current product does not offer VP9/HEVC exports or call that ffprobe wrapper.

Standalone owned AAC/MP3/FLAC candidates also passed separate source/build/browser tests. The product still embeds the original Mediabunny encoder modules; their historical compiler/source limits remain. A Git application-source ZIP includes the owned Core binaries and recipe records, but the bulk source archives, actual offline build context and raw evidence are supplied in the separate Core source bundle. No legal compliance attestation is made.

The following earlier procurement notes remain historical where they say no rebuild was performed or a historical receipt is absent. They are superseded for the newly executed Core build by the current owned-Core records, and remain applicable to unadopted original encoder binaries.

# Codec source and build evidence

The runtime still contains the original npm codec bytes. No codec was rebuilt or replaced during this audit. Exact package integrities, runtime hashes and decoded encoder WASM hashes are in [codec-sources/artifact-inventory.json](codec-sources/artifact-inventory.json); [the runtime notices](../public/licenses/FFMPEG-SOURCE.md) explain the binary-to-source mapping and remaining limits.

The previously supplied three archives remain in `public/licenses/sources/`. Full upstream Mediabunny repository snapshots, all identified FFmpeg recipe dependencies, SDL2, Emscripten sources, the original MP3 static relink archive, official LAME release and identified libFLAC source are now downloaded and verified. The separate local collection is:

```text
/Users/jeremias/Documents/Codex/2026-10-02/ai-director-studio-codec-sources/
```

It contains **26 archives, 241,265,704 bytes (230.09 MiB compressed)**, plus extracted source/build material, manifest, SHA256SUMS and a prepared Dockerfile.pinned. New large archives remain outside Git and browser boot/static deployment. This local collection is not advertised as a public download. Primary immutable URLs, lengths/hashes and correspondence qualifications are recorded in [the source manifest](codec-sources/manifest.json). [The acquisition instructions](codec-sources/README.md) reproduce the collection.

All three encoder WASM modules are byte-for-byte equal to the modules embedded in the npm registry's exact Mediabunny gitHead `cee57d1cdfd1776d515c081057b50eb337291e32`. This establishes package/source snapshot association, rather than every underlying C-library checkout or reproducible compiler invocation.

Remaining technical provenance limits:

- **FFmpeg core 0.12.10:** FFmpeg 5.1.4 and Emscripten 3.1.40 are identified. Every recipe library is archived at a fixed commit, including the zimg submodule. The npm publication supplies no historical build receipt tying mutable x264/LAME branches, Docker image/frontend digests and apt packages to this exact WASM. Newly fixed snapshots are labelled as such. No bit-identical rebuild was performed.
- **AAC encoder 1.56.1:** the module identifies Lavc62.23.103, but upstream does not record its exact FFmpeg checkout, patches or original compiler. A known version interval does not select a corresponding source revision.
- **MP3 encoder 1.56.1:** LAME 3.100, official release source, original libmp3lame.a and bridge/build files are available. The static archive identifies LLVM revision `7f93487862d98bf1c168babba87daf6224d8a46f`; the original Emscripten/toolchain build and any LAME patchset remain unrecorded.
- **FLAC encoder 1.56.1:** its embedded identifier selects full libFLAC commit `3f1ecff843dd1b8c07fbb5f59425a4ec71fe4f6c`; that source and original notices are archived. Exact compiler/relink reproducibility remains untested.

This is source procurement and provenance evidence, not legal approval of complete distribution/source/relink compliance. An original build/source attestation or a separately approved controlled rebuild with new output hashes would resolve the remaining binary correspondence question. No public codec compliance completion is claimed. Remotion Free License eligibility is separately resolved for the human-confirmed independent operator with at most three people; see [license-inventory.md](license-inventory.md).
