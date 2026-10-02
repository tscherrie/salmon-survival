# Isolated, source-pinned codec rebuild

This branch contains new build recipes and observed results. It does not replace the private runtime, deploy a Site, attest the upstream publisher's historical checkout, or attest legal completeness. The observed Core build does reproduce all four published Core files exactly. The base is `cf761052228feedde11a590739cbf5d54767562e`; the separate V1 release advanced independently.

## Observed results

| Target | Actual execution | Remaining before runtime replacement |
| --- | --- | --- |
| FLAC | libFLAC `3f1ecff843dd1b8c07fbb5f59425a4ec71fe4f6c` and Mediabunny bridge `cee57d1cdfd1776d515c081057b50eb337291e32` compiled from source. ESM and classic glue contain the same validated 110,933-byte WASM, SHA256 `da529aafa20610371e8c2206ce04e5734918d173e171048a0c6b35e3fbe4b549`. | Integrate the candidate into the existing chunk/authenticated native runtime and run the actual SDK acceptance before replacement. |
| FLAC output | Real Chrome, opaque iframe and classic Blob worker, CSP without `unsafe-eval`: 96,000 stereo frames / 2s / 48kHz / 24bit. Output 193,688 bytes, SHA256 `5ee0c46787bd0e7301d0055f37b53ccafccdc863ffa70e9de464b9bf77aa8497`. FFmpeg decoding exactly matches the input PCM. Abort after one encoded chunk, then a fresh worker produces 24 chunks. | This is a local browser codec acceptance, not a real native-host SDK claim. ESM worker startup in the opaque fixture failed; classic glue was separately linked and accepted there. The exact ESM glue/WASM subsequently passed in a same-origin module Blob worker, including actual-output cancellation and fresh-worker recovery. |
| AAC | Own FFmpeg source `499b5f5f92f73e5b0e6108242983695fcb6409e2`, original Mediabunny bridge, no library patches, digest-pinned Emscripten 6.0.3: ESM and classic compiled. Both contain validated WASM 505,574 bytes, SHA256 `e6d2b9b24766e52a95ff9ed9b5ffe725eec6c7adf579b708b62b64facc637a28`. Actual opaque classic-worker output/decode/abort/recovery passed. | Actual native SDK integration remains. The exact ESM variant also passes same-origin module-Blob output/decode/abort/recovery. This is a deliberate new source pin, not a recovered historical npm AAC checkout. |
| MP3 | Official LAME 3.100 plus original bridge compiled from source in the pinned native image. Actual opaque classic-worker 192kbps stereo output/decode/abort/recovery passed. Classic WASM 220,016 bytes, SHA256 `e4e57fc0405d4f67bc9e44020246432dc04b78b0c9a518ebb38f355feadd158d`. | Actual native SDK integration remains. The different ESM WASM now passes actual module-Blob output/decode/abort/recovery; its filesystem/memory/longjmp settings remain recorded. The optional old-static-archive relink recipe has not run and supplies no missing provenance. |
| FFmpeg Core | Full offline source build completed at 10:16:41 UTC (exit0): all libraries retained, FFmpeg make/install3892.3s, UMD link815.6s, ESM link2963.3s, followed by scratch-stage export. Four exported files directly equal installed `@ffmpeg/core@0.12.10`: UMD JS112,059B /ESM JS111,804B; both WASM32,232,419B, SHA256 `9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7`. Actual UMD offered-function suite and ESM module-worker FLAC roundtrip pass. | Native SDK integration remains separate. Auxiliary VP9 encoding crashes and x265 encoding times out; required WebM/VP9 import decoding passes. See the preserved diagnostic receipts. No library or source was removed. |

Exact output sizes/hashes, source pins, image/config digests, script hashes and package locks are in [source-lock.json](source-lock.json). Small build/configuration text copies and raw-file hashes are in [receipts](receipts/); tracked text copies normalize only trailing whitespace. Complete untouched raw logs/configuration files remain with the external build outputs, including the 539 KB AAC configure log. Compiler-generated glue, static libraries, WASM and synthetic output remain outside Git under the source collection's `rebuild/` directory.

Successful encoder builds ran with Docker networking disabled and read-only public source/recipe mounts. FLAC/AAC used two compile jobs and MP3 used one; `SOURCE_DATE_EPOCH=1772582400`, `LC_ALL=C` and `TZ=UTC` were set. Library sources have no patches. FLAC/AAC use `-Oz -flto -msimd128`, no threads/filesystem and `DYNAMIC_EXECUTION=0`. Classic FLAC differs only in `EXPORT_ES6=0`; AAC additionally specifies its classic module name. MP3 ESM preserves its prepared upstream link defaults, while classic explicitly disables filesystem/longjmp and selects emmalloc. This is one observed compilation per variant, not a two-build bit-reproducibility claim. Core does not set the encoder `SOURCE_DATE_EPOCH`; its exact execution context is recorded separately.

AAC's 2s fixture decodes to 97,280 frames at 48kHz, with measured 1,024-frame delay and 256-frame padding. Channel SNR is 27.61/30.76dB and p99 absolute error 0.0562/0.0292. A startup peak error of 0.4602 at 11.52ms is preserved, including the failed initial peak criterion; final lossy acceptance uses SNR, p99 error, no clipping and packet/sample timing. MP3's raw MPEG stream has no gapless metadata: 97,920 decoded frames include measured combined encoder/decoder delay 1,105 and padding 815; SNR is 30.46dB on both channels. Neither receipt hides codec delay behind estimated container duration.

## Source acquisition and verification

The existing collection contains 26 preserved archives (241,265,704 bytes). Three additional exact-commit archives contain the new AAC FFmpeg pin and Emscripten/emsdk 6.0.3 sources. Together: 29 archives, 290,949,537 bytes (277.47 MiB), excluding container images and build outputs. No large archive is added to Git or static deployment.

Existing collection on the development machine:
`/Users/jeremias/Documents/Codex/2026-10-02/ai-director-studio-codec-sources/`.

From `director-studio/`, choose an owned collection/output directory:

```sh
SOURCE_COLLECTION=/absolute/path/to/codec-sources
node apps/extension/release/codec-sources/manage-sources.mjs fetch "$SOURCE_COLLECTION"
node apps/extension/release/codec-rebuild/fetch-new-sources.mjs "$SOURCE_COLLECTION"
node apps/extension/release/codec-sources/manage-sources.mjs verify "$SOURCE_COLLECTION"
node apps/extension/release/codec-rebuild/verify.mjs "$SOURCE_COLLECTION"
```

The original acquisition manifest includes one previously supplied installed-source archive; retain that collection file or supply it from the V1 source bundle. The new build recipes require only the 25 pinned upstream archives selected in this source-lock plus the new AAC source; the installed-source archive is not a compiler input. `verify.mjs` additionally verifies the recorded local successful outputs, so on a fresh machine it runs after those builds or after copying the external receipt artifacts. Fetch scripts reject unexpected existing bytes instead of replacing them.

The exact source URLs and SHA256 values are in the lock. They refer to primary upstream commit archives or the official LAME 3.100 release. New AAC source selection closes correspondence for the **new candidate's** own bytes; it supplies no evidence about the old published AAC binary.

## Encoder build commands

A Docker daemon with the stated image platform is required. No global emsdk install or apt install occurs on the host. Pull the exact encoder image once:

```sh
docker --context colima pull --platform linux/arm64 emscripten/emsdk@sha256:ddfb30ef76e97bb9a231af1fb262f0a4f2f6aa726778572a028e215922afac40
node apps/extension/release/codec-rebuild/run-build.mjs flac "$SOURCE_COLLECTION" "$SOURCE_COLLECTION/rebuild/flac-owned"
node apps/extension/release/codec-rebuild/run-build.mjs flac-classic "$SOURCE_COLLECTION" "$SOURCE_COLLECTION/rebuild/flac-owned"
node apps/extension/release/codec-rebuild/run-build.mjs aac "$SOURCE_COLLECTION" "$SOURCE_COLLECTION/rebuild/aac-owned"
node apps/extension/release/codec-rebuild/run-build.mjs mp3 "$SOURCE_COLLECTION" "$SOURCE_COLLECTION/rebuild/mp3-owned"
```

The runner validates input bytes, pins the image, prevents container network access, and writes `run-receipt.json`. The classic link preflight requires the recorded owned `libFLAC.a` hash; it never takes the old npm binary. If a later controlled rebuild differs, inspect/record that result instead of silently changing the approved hash.

The actual FLAC browser acceptance can be repeated with installed Playwright, Chrome, ffmpeg and ffprobe. `DEPENDENCY_ROOT` is a checkout containing those npm dependencies; dependencies are loaded read-only:

```sh
DEPENDENCY_ROOT=/absolute/path/to/director-studio
node apps/extension/release/codec-rebuild/accept-flac.mjs "$SOURCE_COLLECTION/rebuild/flac-owned" "$DEPENDENCY_ROOT"
```

## Core offline execution

The first FLAC attempt under the legacy amd64 image was bounded/stopped during expensive initial libc/LTO cache creation on the ARM64 development machine; no complete artifact was produced by that attempt. Successful standalone encoders used the separate native ARM64 6.0.3 image. The full Core pipeline now runs under AMD64 emulation with all original codec libraries retained.

The Core base image is:
`emscripten/emsdk@sha256:c1e807a6e03ac5bd5b37bae2ace3c46c08579e2ddeb951037a3b8dac7067f2cc` (`linux/amd64`). Its OCI/config hashes and full base package lock are recorded. Extra packages are autoconf 2.71-2, automake 1:1.16.5-1.3, libtool 2.4.6-15build2, ragel 6.10-1build1 and pkg-config 0.29.2-1ubuntu3 plus six recorded dependencies.

The 11 actual `.deb` files were acquired and installed only inside a disposable container from the signed Ubuntu snapshot `20250301T000000Z`. [Ubuntu's snapshot service](https://snapshot.ubuntu.com/) documents fixed timestamp package views; its retention guarantee is finite, so preserve the actual hashed offline `.deb` collection. `lock-build-packages.sh` is the acquisition record, and `core-build-package-requests.lock`, `core-build-container-packages.lock` and `apt-build-files.sha256` record what was actually obtained.

To reacquire those packages in an owned directory before offline context generation, run the acquisition script with the immutable Core image and a writable `/out` mount at `$SOURCE_COLLECTION/rebuild/core-toolchain-lock`; only this acquisition uses networking. Its output must match every `.deb` row in the source lock. The actual offline generator refuses different bytes.

```sh
python3 apps/extension/release/codec-rebuild/prepare-core.py "$SOURCE_COLLECTION" "$SOURCE_COLLECTION/rebuild/core-offline-context"
```

The generator retains upstream source/configuration flags, replaces mutable source fetches with verified local trees, installs only locked local `.deb` files, and supplies the fixed SDL2 tree via Emscripten 3.1.40's local-port mechanism. It copies the zimg test submodule at its fixed revision and emits an offline build command. No remaining Dockerfile git clone, remote ADD or apt install is accepted. The Docker frontend is the existing Docker engine's builtin frontend; the engine/client versions used for preparation are Docker 29.5.2/29.1.5. Its mutable external syntax directive is removed.

The HarfBuzz failure repair is [harfbuzz-library-install.patch](harfbuzz-library-install.patch): build the upstream `src libs` target, then install all configured libraries, public/generated headers, pkg-config and CMake metadata. It leaves library sources and configure flags unchanged while avoiding unshipped `noinst` programs. Static review checked the target names against the pinned Automake 1.16.5 templates and HarfBuzz `Makefile.am`. The actual retry completed the full main/subset library and install stage in 1,095.3s; its subsequent VM interruption occurred during FFmpeg configure. The inherited upstream recipe also modifies HarfBuzz's pthread configure detection for single-thread Core and removes Vorbis's `-mno-ieee-fp` configure option. These transforms are explicitly recorded; Core is not labelled as having untouched configure sources.

The generator bounds copied recipe make invocations to two jobs, permits only one BuildKit stage at a time and warms the compiler's libc cache with a disposable test program. It does not change codec library source. The actual runner is:

```sh
node apps/extension/release/codec-rebuild/run-core.mjs "$SOURCE_COLLECTION/rebuild/core-offline-context" "$SOURCE_COLLECTION/rebuild/core-build" director-codec-core-20261002
node apps/extension/release/codec-rebuild/accept-core.mjs "$SOURCE_COLLECTION/rebuild/core-build" "$DEPENDENCY_ROOT"
node apps/extension/release/codec-rebuild/accept-core-esm.mjs "$SOURCE_COLLECTION/rebuild/core-build" "$DEPENDENCY_ROOT"
node apps/extension/release/codec-rebuild/record-core.mjs "$SOURCE_COLLECTION" "$SOURCE_COLLECTION/rebuild/core-build"
```

The separate BuildKit builder uses image `moby/buildkit@sha256:0168606be2315b7c807a03b3d8aa79beefdb31c98740cebdffdfeebf31190c9f` and [buildkitd.toml](buildkitd.toml). The compile receipt records the generated Dockerfile and frozen input-lock hashes, argv, actual process IDs and timestamps. The resource adjustment has its own receipt. Do not change the active context while compilation runs. All Docker `RUN` steps have network disabled. Feature acceptance and final candidate packaging remain separate from compilation. General compiler source correspondence beyond the retained exact Emscripten sources/container package image is not attested here.

Create a fresh owned builder before that runner, with the initial limits recorded by this run:

```sh
docker --context colima buildx create --name director-codec-core-20261002 --driver docker-container --driver-opt image=moby/buildkit@sha256:0168606be2315b7c807a03b3d8aa79beefdb31c98740cebdffdfeebf31190c9f --driver-opt memory=2g --driver-opt cpu-period=100000 --driver-opt cpu-quota=150000 --buildkitd-config apps/extension/release/codec-rebuild/buildkitd.toml --bootstrap
```

The current live adjustment was applied with `docker update`, not by rebuilding or changing the VM. The finaliser retains that separate measured receipt. Stop only the owned builder after acceptance, and stop an owned Colima session only after verifying no foreign container needs it; preserve images and volumes.

The previous ten-output baseline remains unchanged. The actual exported own bytes now pass sixteen media checks: H264/AAC MP4/MOV, PCM WAV, MP3/M4A/FLAC, VP9/Opus WebM input imported to H264/AAC, PNG/image2 input to H264, source-audio inpoint/speed/gain/fades, signal ducking, two-pass loudness normalization, silent-video fallback, forced MP3/M4A/FLAC decoding and abort after actual encoding progress followed by fresh-worker FLAC recovery. The measured mix is -16.02LUFS; signal duck is -14.31dB. Lossless PCM is exactly96,000 stereo frames. Six complete runtime inventories and actual WASM ffprobe JSON are retained. The known WebM source was encoded locally from synthetic testsrc2/sine by native FFmpeg; it is explicitly not an own-Core VP9 export. No external or generated private media was used.

## Focused checks and remaining historical evidence

```sh
node --test apps/extension/release/codec-rebuild/recipe.test.mjs
node apps/extension/release/codec-rebuild/verify.mjs "$SOURCE_COLLECTION"
```

The separate ESM fixture instantiates the compiled ESM glue/WASM in a module Blob worker under CSP without `unsafe-eval`, encodes two seconds of stereo FLAC and checks a bit-exact external PCM decode. Its baseline passed using the unchanged published Core and is explicitly labelled fixture validation. Candidate acceptance must pass separately for both variants before `record-core.mjs` records a completed Core build.

After Core and standalone ESM completion the source/output verifier checks all recorded sources, outputs and receipts, including all four Core outputs, exact executed fixture, source audit, raw logs and failed/interrupted attempts. Focused recipe checks additionally validate the actual Core acceptance receipts; the original26 archives retain their separate manifest verification. No broad product suite or live host claim is made by these recipe tests. Colima was stopped after the initial preparation phase, then started again for the explicitly authorized full Core build. Its observed SIGTERM shutdown and normal existing-profile recovery are recorded separately. Only the owned builder is running. No VM settings, images or volumes were deleted or reset.

The independent source audit verifies18 complete source trees /18,020 regular files /10 symlinks plus18 recipe binding files against their pinned archives. The18340-file frozen context contains no `.a`, `.wasm`, `dist` or `node_modules` seeds. The retained compiler-base workspace listing is empty; no exit status lost during session recovery is invented. Build logs show source→static archives→actual UMD/ESM `emcc` links→scratch export. Exported files are ordinary separate files, not links to npm. All four outputs directly reproduce the published Core bytes; this provides concrete byte/source correspondence for the selected recipe and pins. It does not prove the publisher's original historical checkout/environment or a second cold rebuild. Dependency stages reused the preserved prior attempts' cache.

```sh
node apps/extension/release/codec-rebuild/audit-core-source.mjs "$SOURCE_COLLECTION" "$SOURCE_COLLECTION/rebuild/core-build" "$DEPENDENCY_ROOT"
```

The audit writes its report with exclusive creation to preserve evidence. Keep each execution in a separately named evidence directory; do not overwrite an accepted report. [receipts/core-source-audit.json](receipts/core-source-audit.json) is the small retained copy. Complete evidence remains in `rebuild/core-build-resume-20261002/`.

Known runtime limitations are recorded rather than hidden: the pinned ffprobe binding ignores its C function return and reports `Module.ret=-1` even after producing correct validated JSON. Auxiliary libvpx-vp9 encoding fails with a WASM memory access error across default and bounded single-thread option sets. Auxiliary libx265 encoding times out at60s, also observed on the unchanged published baseline. These encoders remain compiled; neither is an offered Studio export. H264 exports and VP9/Opus WebM import pass. Inventory presence does not establish universal runtime support for every listed codec or every possible input.

The original published AAC checkout/patchset still lacks historical upstream evidence. The own AAC candidate has a direct source/build/output chain; adopting its accepted bytes avoids relying on that unknown old association. Standalone classic AAC/MP3/FLAC output, decoding, abort and recovery pass. All three exact standalone ESM variants now pass a separate same-origin module-Blob gate, with zero CSP violations or runtime HTTP requests. Cancellation occurred after actual FLAC8,106B, AAC461B and MP31,612B, followed by fresh-worker recovery. Their source-lock snapshot and separate receipts are preserved; MP3 ESM has different WASM and is independently accepted. Core, AAC, MP3 and FLAC runtime adoption and authenticated native SDK regression remain the parent's separate integration work. This branch supplies no legal completeness attestation.
