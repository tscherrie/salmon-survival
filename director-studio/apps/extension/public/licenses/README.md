## Current 0.1.4 Core adoption

Public source delivery: [https://ai-director-studio-info.yearemia.chatgpt.site/sources.html](https://ai-director-studio-info.yearemia.chatgpt.site/sources.html) supplies both `ai-director-studio-source.zip` and `ai-director-studio-core-sources.zip` together, through bounded parts with per-part and complete ZIP SHA-256 verification. The generated download manifest identifies the exact source checkpoint and artifact hashes. The Git source ZIP contains the adopted Core runtime and frozen recipe; the separate Core ZIP contains its original archives, complete executed context, build inputs, notices and raw evidence. Supply both. Live delivery status is recorded separately from this source checkpoint.


FFmpeg Core is now selected from `packages/browser-media/vendor/ffmpeg-core/manifest.json`. The executed, pinned source build produced both UMD and ESM JavaScript/WASM. All four files directly equal the accepted `@ffmpeg/core@0.12.10` bytes. The source chain, immutable inputs, compiler image, actual FFmpeg compilation/link/export and browser output acceptance are recorded in `apps/extension/release/codec-rebuild/source-lock.json` and its receipts. Dependency stages reused preserved caches; a second cold rebuild and the historical publisher checkout timeline are not claimed.

The offered H264/AAC, MP4/MOV and audio formats and WebM import passed the owned Core browser acceptance. Auxiliary VP9 encoding crashed, the separate x265 diagnostic timed out, and the pinned ffprobe wrapper returns -1 despite producing validated JSON. These limits are retained in the receipts. The current product does not offer VP9/HEVC exports or call that ffprobe wrapper.

Standalone owned AAC/MP3/FLAC candidates also passed separate source/build/browser tests. This Extension excludes the unused original Mediabunny encoder payloads with importer-scoped, fail-closed Remotion bindings. Audio exports and video audio mux use the own Core. Installed npm reference packages and separate desktop builds retain their historical compiler/source limits; this Extension emission proof does not attest those other scopes. A Git application-source ZIP includes the owned Core binaries and recipe records, but the bulk source archives, actual offline build context and raw evidence are supplied in the separate Core source bundle. No legal compliance attestation is made.

The following earlier procurement notes remain historical where they say no rebuild was performed or a historical receipt is absent. They are superseded for the newly executed Core build by the current owned-Core records, and remain applicable to installed original encoder reference packages and separate desktop builds; those baseline bytes are excluded from this Extension emission.

# Third-party software notices

Director Studio's MIT source license does not replace dependency licenses. Original library/font texts are retained under packages and upstream. The conservative package inventory includes dependency closure even where the production bundler removes a package.

## Exact codecs and actual source procurement

The shipped @ffmpeg/core **0.12.10** declares GPL-2.0-or-later. Its WASM identifies FFmpeg **5.1.4**, Emscripten **3.1.40**, GPL and linked-codec flags. @ffmpeg/ffmpeg **0.12.15** is a separate MIT JavaScript wrapper. Full configuration and binary/source limits are in [FFMPEG-SOURCE.md](FFMPEG-SOURCE.md).

The original three source archives in sources remain unchanged. A separately stored **26-archive / 230.09 MiB** source collection now supplies all identified recipe libraries, toolchain/SDL2 sources, complete Mediabunny repositories, official LAME source and the identified FLAC revision. The [source manifest](CODEC-SOURCE-MANIFEST.json) contains fixed primary download URLs and exact checksums. New large archives are outside static deployment; no hosted download URL for that local collection is asserted. The source-repository acquisition script verifies and reconstructs it.

Mediabunny **1.61.0**, the Remotion renderer's nested **1.56.1**, and AAC/MP3/FLAC encoder **1.56.1** wrappers are MPL-2.0. The earlier npm-source copy is preserved; full upstream snapshots at the exact npm gitHeads supply shared helpers/build setup omitted by those npm source copies. All three encoder WASM modules match their upstream snapshot exactly. [The artifact audit](CODEC-ARTIFACT-INVENTORY.json) records that evidence without executing encoder code.

Underlying optional codecs retain separate terms: AAC uses FFmpeg/libavcodec LGPL, MP3 uses [LAME 3.100](https://lame.sourceforge.io/) LGPL, and FLAC uses libFLAC. The original MP3 static relink archive and exact embedded libFLAC source revision are available in the separate source collection. AAC's exact FFmpeg checkout remains unrecorded upstream. Original codec/toolchain notice files are copied unchanged under upstream and mapped in [UPSTREAM-NOTICES.json](UPSTREAM-NOTICES.json). COPYING.GPL in the FLAC source also covers separate programs; its presence is not a claim that the library itself becomes GPL.

No complete corresponding-source, relink or bit-identical reproduction approval is claimed: historical core build provenance and the optional encoder/compiler gaps remain documented.

## Remotion 4.0.532

Exact Remotion, Player and Web Renderer **4.0.532** license texts are preserved; they are source-available terms, not a blanket MIT or OSI grant. The user confirmed an independent operator of at most three people. This meets the installed Free License size criterion. Eligible Free License SaaS/automation is permitted by the [official FAQ](https://www.remotion.dev/docs/license/faq); a paid plan is not an outstanding requirement for this operator. Original license restrictions/notices remain applicable.

Renderer calls declare free-license. The pinned Web Renderer posts event, apiKey:null, execution origin, success/still/production flags to https://www.remotion.pro/api/track/register-usage-point. No media, project IDs, transcript or generated source occurs in that six-field payload; normal network IP/Origin/User-Agent exposure remains. See release privacy/usage evidence in the source distribution.

## Other libraries and notice exception

MIT/Apache/BSD/Zlib notices for React, React DOM, Zustand, Zod, OpenAI MCP Extensions, MCP Apps/SDK, PDF/PPTX and processing libraries are preserved. Original JSZip dual-license terms are recorded. Instrument Sans and IBM Plex Mono retain SIL OFL notices.

@remotion/licensing@4.0.532 declares MIT but both its npm package and [exact upstream source](https://github.com/remotion-dev/remotion/tree/c320056a980972de109ef27a40bede9660a46931/packages/licensing) omit original MIT copyright/permission text. This genuine notice exception remains recorded without an invented copyright holder/year. The npm https@1.0.0 record is metadata-only and contributes no executable browser bundle code; PptxGenJS uses browser-disabled node:https.

[inventory.json](inventory.json) records actual versions and notice paths. This is a factual inventory, not legal approval.
