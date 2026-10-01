# Third-party software notices

Director Studio's own source license does not replace the licenses of its dependencies. Original license and copyright texts are preserved under `packages/`. The inventory records the actual installed package versions; it conservatively includes their dependency closure, so some entries may be removed by the production bundler.

## FFmpeg WebAssembly

The shipped `@ffmpeg/core` package is **0.12.10**, single-thread ESM. Its npm declaration is **GPL-2.0-or-later**. The binary identifies FFmpeg **5.1.4** and contains `--enable-gpl`, `--enable-libx264`, `--enable-libx265` and the other configure flags documented in `FFMPEG-SOURCE.md`. This core is separate from the MIT-licensed `@ffmpeg/ffmpeg` JavaScript wrapper. The GPL and LGPL texts are included here.

The upstream release associated with this core is **v12.15**, commit `71aa99d37c02a7b4c435275ca9ef50e612f6efa1`. Repository tag `v0.12.10` is a different release whose core was 0.12.6; it must not be cited as the source of core 0.12.10. Downloadable pinned build-recipe and FFmpeg-source archives are provided under `sources/`, with SHA-256 checksums. These two archives are **not represented as complete corresponding source**: the recipe links other libraries, and some upstream source references are mutable. Resolve every linked source revision, provide the complete source/build set, and establish correspondence to the distributed binary before claiming the public GPL distribution requirement is fulfilled. See `FFMPEG-SOURCE.md` for the precise gap.

## Mediabunny and additional encoders

The installed Mediabunny packages are **MPL-2.0**, not MIT. Preferred TypeScript/C source files from the exact installed packages are made available in `sources/mpl/` and its tar archive. Both Mediabunny 1.61.0 and the Remotion renderer's nested Mediabunny 1.56.1 are included. Their original README build instructions and MPL notices are preserved.

The separately bundled encoder extensions also contain third-party compiled libraries: MP3 uses LAME 3.100 under LGPL; AAC uses FFmpeg/libavcodec under LGPL; FLAC uses libFLAC. Copying the MPL wrappers alone does not fulfill any underlying codec source/relink requirements. The installed AAC and FLAC build instructions do not identify an exact upstream source revision. These underlying binary/source and required third-party notice details remain a public-distribution verification gate; no complete-source claim is made for them.

LAME attribution: this software uses the [LAME MP3 Encoder](https://lame.sourceforge.io/) and preserves its upstream package attribution in the copied encoder README.

## Remotion

The exact **4.0.532** license texts for Remotion, Player and Web Renderer are preserved. They are source-available license terms with eligibility restrictions, not an OSI open-source or blanket MIT grant. The installed license allows individual use and specified eligible organizations, including for-profit organizations with up to three employees; other organizations require a company license. This notice does not assert the publisher's legal entity, employee count, public-service eligibility, or sublicense rights. Confirm the applicable permission for the actual public distribution and hosted use before release.

## Other software and fonts

MIT/Apache/BSD/Zlib notices for React, React DOM, Zustand, Zod, OpenAI MCP Extensions, MCP Apps/SDK, PDF/PPTX and browser processing libraries are preserved from the installed packages. Dual-license JSZip is recorded with its original terms; no automatic GPL choice is asserted. Instrument Sans and IBM Plex Mono retain their original SIL Open Font License notices. No font ownership is claimed.

`inventory.json` identifies package versions, upstream repositories, notice paths, source archives and the exact shipped FFmpeg file checksums. It is a factual inventory, not legal approval.

Conservative inventory notice exceptions: the installed `@remotion/licensing@4.0.532` package declares MIT but omits a standalone original license text; that original copyright/permission notice still needs to be obtained. The `https@1.0.0` metadata-only package is present in the conservative dependency closure, with ISC declared and no original notice file; establish whether it contributes any distributed runtime code before requiring or removing that notice record. These exceptions are recorded without invented copyright holders.
