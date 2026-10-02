## Current 0.1.4 Core adoption

FFmpeg Core is now selected from `packages/browser-media/vendor/ffmpeg-core/manifest.json`. The executed, pinned source build produced both UMD and ESM JavaScript/WASM. All four files directly equal the accepted `@ffmpeg/core@0.12.10` bytes. The source chain, immutable inputs, compiler image, actual FFmpeg compilation/link/export and browser output acceptance are recorded in `apps/extension/release/codec-rebuild/source-lock.json` and its receipts. Dependency stages reused preserved caches; a second cold rebuild and the historical publisher checkout timeline are not claimed.

The offered H264/AAC, MP4/MOV and audio formats and WebM import passed the owned Core browser acceptance. Auxiliary VP9 encoding crashed, the separate x265 diagnostic timed out, and the pinned ffprobe wrapper returns -1 despite producing validated JSON. These limits are retained in the receipts. The current product does not offer VP9/HEVC exports or call that ffprobe wrapper.

Standalone owned AAC/MP3/FLAC candidates also passed separate source/build/browser tests. The product still embeds the original Mediabunny encoder modules; their historical compiler/source limits remain. A Git application-source ZIP includes the owned Core binaries and recipe records, but the bulk source archives, actual offline build context and raw evidence are supplied in the separate Core source bundle. No legal compliance attestation is made.

The following earlier procurement notes remain historical where they say no rebuild was performed or a historical receipt is absent. They are superseded for the newly executed Core build by the current owned-Core records, and remain applicable to unadopted original encoder binaries.

# License inventory and release evidence

Director Studio's application source retains the repository MIT license and original Chase Lean/tscherrie notices. That license does not relicense dependencies. Publisher identity and Portal legal attestation are separate publication matters; this document records software evidence.

| Component actually resolved | Original license / evidence |
| --- | --- |
| React, Zustand, Vite, esbuild, PptxGenJS, pdf-lib, fflate, html-to-image | Installed MIT notices retained in public/licenses/packages |
| Mediabunny 1.61.0; Remotion's nested Mediabunny 1.56.1 | MPL-2.0; covered source and immutable complete repository snapshots identified |
| Mediabunny AAC / MP3 / FLAC encoders 1.56.1 | MPL wrappers plus FFmpeg LGPL, LAME LGPL and libFLAC terms; underlying source mapping documented below |
| OpenAI MCP Extensions; MCP Apps / SDK | Installed Apache-2.0 / MIT notices retained |
| Instrument Sans and IBM Plex Mono | Original SIL Open Font License retained |
| Remotion / Player / Web Renderer 4.0.532 | Exact Remotion License retained; ancillary packages declaring MIT recorded individually |
| @ffmpeg/ffmpeg 0.12.15; @ffmpeg/types 0.12.4 | MIT wrappers; no @ffmpeg/util runtime package found |
| @ffmpeg/core 0.12.10 | npm declares GPL-2.0-or-later; FFmpeg 5.1.4 binary enables GPL and linked GPL codecs |
| esbuild-wasm | Installed MIT notice retained |
| Electron / desktop FFmpeg | Reference dependencies, outside the Extension Worker/browser codec runtime |

## Remotion: exact license and confirmed operator criterion

The lockfile resolves Remotion and all related entries to **4.0.532**, not 4.0.491. The copied remotion/LICENSE.md is **2,823 bytes**, SHA-256 `bd65083b940f61904f6ef298aade918a7cad72a3e35bc406e36fab365844b673`. [The machine audit](codec-sources/artifact-inventory.json) records each resolved Remotion entry and exact license bytes.

The human user confirmed an independent project whose operator has at most three people in total. That satisfies the size criterion of the installed Free License; no SkillMeNow affiliation is inferred. The official [license FAQ](https://www.remotion.dev/docs/license/faq) permits eligible Free License SaaS and automated rendering. A paid Remotion plan is **not an open requirement for this confirmed operator**. Original restrictions/notices still apply; Remotion is not sublicensed under Director Studio's MIT license. Reassess eligibility if the relevant operator/organization changes.

All three browser renderer calls explicitly pass `licenseKey: 'free-license'`. The pinned library converts this to apiKey:null; no purchased key is embedded. Current application documents contain authored/generated component assets. No independent importer of another user's complete Remotion project was identified.

## Browser-render usage request and privacy

The installed @remotion/web-renderer@4.0.532 sends a POST to https://www.remotion.pro/api/track/register-usage-point with exactly these fields:

```json
{"event":"web-render","apiKey":null,"host":"<window.location.origin>","succeeded":true,"isStill":false,"isProduction":true}
```

Success/still values vary by render; production is the library default. The host value is the execution frame origin, including the string "null" for the opaque media sandbox. The six fields contain no project IDs, filenames, media bytes, transcript or generated component source. The request may expose browser IP, HTTP Origin and User-Agent to the vendor; this is not complete anonymity. The pinned code uses a 10-second attempt timeout and up to four attempts. Native CSP permits the exact https://www.remotion.pro connection origin. See the [official Web Renderer API](https://www.remotion.dev/docs/web-renderer/render-media-on-web) and release privacy disclosure. Source inspection is separate from actual native-host network acceptance.

## Codec sources and notices

[ffmpeg-source.md](ffmpeg-source.md) and [codec-sources/README.md](codec-sources/README.md) identify the **26 verified archives / 230.09 MiB** stored separately from runtime. Original codec/toolchain notices are retained in public/licenses/upstream and mapped by [notices.json](codec-sources/notices.json). All three encoder WASM modules match their exact upstream source snapshot. Complete Mediabunny snapshots supply shared helpers/root build files absent from the npm source copy.

Remaining technical evidence limits concern the historical FFmpeg-WASM build receipt, AAC's exact FFmpeg checkout and original codec/toolchain patch/rebuild provenance. These are not Remotion plan requirements and copyright notices alone do not resolve them. No complete corresponding-source, relink or bit-identical reproduction assertion is made. Primary [FFmpeg guidance](https://ffmpeg.org/legal.html), installed licenses and fixed source references remain applicable.

The conservative inventory retains one genuine notice exception: @remotion/licensing@4.0.532 declares MIT but its npm package and exact upstream version commit omit an original MIT permission/copyright text. The unrelated https@1.0.0 npm package contains only package.json and contributes no executable browser code; PptxGenJS uses browser-disabled node:https. No original copyright holder/year has been invented.
