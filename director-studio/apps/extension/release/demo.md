# Supporting SDK demo and native review walkthrough

Recorded and playback-checked 2026-10-02. [sdk-review-demo.mp4](evidence/sdk-review-demo.mp4) is an actual **30.32-second**, 1280×960 H.264 recording. Its visible banner says SDK-Browsertest throughout. The source is the actual built Worker plus real MCP Client/AppBridge, with a synthetic owner confined to a loopback Node proxy and its own restrictive host CSP. It records no actual ChatGPT app, model response or paid Fal generation.

## What the recording demonstrates

A stored procedural four-second video opens with material, preview and timeline. Authored TSX appears inside the isolated child, Play advances the clock, and Pause stops it. A real MCP export job runs in the open editor and persists a four-second H.264/AAC MP4 with its output receipt; FFprobe and decoded pixels verify the file and overlay. The normal hashed resource URI comes from tools/list, and resources/read uses private, immediately stale cache hints. No ordinary private HTTP download was used. Page and SDK errors are absent. The constrained fixture still blocks dependency usage telemetry and retains those console messages; the actual declared resource policy permits the exact Remotion licensing origin.

Recording SHA256: `74e6cf4e33e117a0d14114ce8936d43419b67a8459c279d1e9a7525512c4f0d4` (861,545 bytes). [Playback verification](evidence/playback-verification.json) confirms real Chrome time advancement, seek/readable snapshots and complete FFmpeg decode of both the recording and exported MP4. This executor inspected the 10- and 22-second snapshots for readable editor controls/captions. [Execution report](evidence/sdk-review-demo.json) preserves the scope, output properties and measured checks. A public recording URL is accepted only after its exact bytes are fetched and compared; see the final external release receipt for that check.

## Reproduce the supporting demo

From director-studio after `npm ci` and `npm run extension:build`, start `node apps/extension/scripts/acceptance-server.mjs` on loopback port 5201, optionally with a separate `DIRECTOR_ACCEPTANCE_DIR`. The recorder requires installed Chrome, system ffmpeg/ffprobe and Playwright's video helper (`node node_modules/playwright/cli.js install ffmpeg`). Run `node apps/extension/scripts/record-review-demo.mjs /absolute/path/demo-output`. It creates only procedural sample material, makes no external generation and exports through the actual SDK bridge. An output folder is supporting test evidence, not a host review login.

## Native walkthrough still required

The user confirmed the real native start after cf761; that is documented separately. A final native reviewer recording must use the canonical app under the review identity, not an owner session or this SDK harness. Run the five positive/three negative cases from [review-cases.json](review-cases.json), show the native selection context without an automatic chat turn, the resulting model/tool action, reopen persistence, actual saved/downloaded outputs and the supplied original completed Fal receipt. Explain estimates separately from returned billing. Include the two negative permission/account boundaries and do not claim a public promotion or attestation result without its actual receipt.

Review access, a reviewer-owned completed Fal receipt and the native recording URL are not supplied by this supporting video. All reviewer cases remain Not run in [review-case-status.md](review-case-status.md). The secure canonical review-access path must be resolved before requesting an arbitrary reviewer password.
