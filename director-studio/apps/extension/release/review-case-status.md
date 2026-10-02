# Review cases and fixture readiness

Prepared on 2026-10-02. The five positive and three negative cases in [review-cases.json](review-cases.json) are synchronized with `plugin/plugin.json`. These are runnable review instructions and expected oracles, not a record that a reviewer executed the prompts. All five project categories are covered: case P1 covers video and audio; P4 covers slides and graphics; P5 covers websites. P2 checks the actual native selection flow, and P3 checks an existing official Fal receipt without a new paid request.

## Execution status

| Case | Reviewer execution | Existing evidence and exact remaining oracle |
| --- | --- | --- |
| P1 — Four-second video and audio | **Not run** as a reviewer | Production MCP video/audio documents and reopen passed in `evidence/live-native-mcp.json` and `evidence/live-native-categories.json`. Local browser outputs contain measured video/audio files; `evidence/native-auth-iframe.json` contains an actual stored MP4 export through an SDK test host. The new paired four-second prompt, native reviewer uploads, completed MP4/WAV jobs and reviewer playback remain pending. |
| P2 — Native clip selection → marker | **Not run / pending** | Native editor opening is human-confirmed in `evidence/native-start-user-confirmation.json`. That confirmation does not establish model-context attachment. Inspect actual native context before the prompt, verify selection sends no turn, then observe the marker and reopen it. A copied-context fallback is useful but does not pass the native-selection oracle. |
| P3 — Existing Fal receipt imported twice | **Not run / pending** with reviewer fixtures | A prior completed Fal result was actually imported twice in production with the same asset/generation and no new request, approval or charge (`evidence/live-native-mcp.json`). That does not establish a reviewer-owned receipt, reviewer-accessible output URL, a new paid Fal flow or observed billing. Supply the original completed receipt; keep `actualCostUsd` absent when unknown. |
| P4 — Slides and matching graphic exports | **Not run** as a reviewer | Production persisted slide/graphic documents and notes; `evidence/browser-outputs.json` separately measures a two-page PDF, PPTX and graphic output. The new Review Garden/Next Step prompt, the reviewer’s three completed saved outputs, editable PPTX content, notes and preview/output comparison remain pending. |
| P5 — React ZIP and source restore | **Not run** as a reviewer | Production immutable website source restore passed; the production sample used HTML. Local React preview/ZIP evidence is in `evidence/browser-site-ui.json` and `evidence/browser-outputs.json`. Run this concrete React prompt under the reviewer identity and inspect exported files, restored preview and preserved temporary version. |
| N1 — All chat history and hidden memory | **Not run** | Director’s registered tools do not provide that account-wide retrieval. Observe an accurate scope explanation, no invented history and no pretend successful project mutation. |
| N2 — Extract token and buy Fal credits | **Not run** | Director has no credential extractor or payment/credit-purchase tool. Observe no payment, extraction or generation call; the host must explain the account boundary. |
| N3 — Publish and sign legal attestations | **Not run** | Director has no publisher-portal tool. Observe no publication, legal declaration or invented receipt. Verified identity and the operator-size confirmation do not establish these actions. |

The originating chat reports that the native editor now opens, and that a read-only portal view shows Publisher Verified. The independent operator with at most three people is human-confirmed. These facts do not change the case execution statuses above. [acceptance.md](acceptance.md) records the latest overall evidence and distinguishes the SDK host from the actual ChatGPT host.

## Fixture paths

| Path | Intended contents | Preparation status |
| --- | --- | --- |
| `fixtures/review-sample.mp4` | Own procedural `testsrc2`, four seconds, 640×360 at 30 fps, H.264 video plus 440 Hz AAC audio; no third-party footage | Prepared by root; local file existence, 273,517-byte length and SHA256 read back here. Root reports the measured media properties. |
| `fixtures/review-tone.wav` | Own four-second 440 Hz tone, 48 kHz stereo PCM16 WAV; separately upload into the audio project | Prepared by root; local file existence, 768,078-byte length and SHA256 read back here. Root reports the measured media properties. |
| `fixtures/README.md` | Creation commands, media description and local-upload instructions | Prepared and read back. Exact fixture hashes are below. |
| `review-fal-receipt.json` | Private reviewer-supplied actual `url`, `endpointId`, `requestId`, `estimateUsd`; optional `actualCostUsd` only if returned by billing | **Not supplied.** No fake URL, request/account ID, quote or credential is inserted into this package. Provide this receipt securely to the reviewer once access is defined. |

SHA256 of the prepared local release bytes:

```text
1a298ded6b384d7db7cc18a35fc8ad05af2f4bca3310e52634b1ee37f5aeda21  fixtures/review-sample.mp4
ef5864b8a4dd47a66f28b70eea8865bea4556b8e07c9e079fbfcb5e5e93ba781  fixtures/review-tone.wav
```

The demo source path reported by root is `/Users/jeremias/Documents/Codex/2026-10-02/ai-director-studio-release/sdk-review-demo/review-sample.mp4`. This is a local preparation path, not a reviewer URL. Reviewers upload the release files through the editor: `import_url` requires a real public HTTPS media URL and cannot consume a local path. The two procedural fixture URLs are now included in P1 file_attachment_urls. An anonymous HTTP 200 fetch matched the exact released bytes and SHA256 for each (evidence/public-review-materials.json). The MP4 is served as application/octet-stream: download it with its .mp4 filename and use the editor file picker, rather than treating the generic HTTP content type as codec evidence.

The current 76.84-second [supporting SDK recording](https://ai-director-studio-info.yearemia.chatgpt.site/review-demo.mp4) uses the actual built Worker and opaque editor, with a synthetic loopback identity and procedural material. It shows preview play/pause, clip selection/copyable fallback, a marker edit v2→v3, actual stale VERSION_CONFLICT without extra mutation, a completed stored four-second H.264/AAC export and Projects/reopen persistence. [Safe measured evidence](evidence/review-demo-sdk.json) and [public playback receipt](evidence/review-demo-public.json) preserve this exact scope. It does not pass P1/P2 or any complete reviewer case by itself; no host-model response, native context attachment or reviewer sign-in was recorded. The older 30.32-second evidence remains historical.

## Access preparation

Use the existing canonical Sites-backed plugin and reviewer’s own authenticated identity. The current private owner audience does not establish reviewer access. Do not share an owner password, OAuth session or stored owner project IDs. The cases intentionally use their own project titles and return fresh project/asset IDs from actual calls.

The correct publisher/project mapping and canonical app adoption are still to be resolved. The originating chat’s read-only portal inspection found the selected project’s plugin list empty and no canonical Sites selection or reviewer fields in the initial upload modal. That is an observed entry point, not proof that a supported path is impossible. No invitation, sharing grant, audience change, upload, deployment or publication was performed by this preparation.

Resolve the canonical app’s supported review-access method first. Then test sign-in and sample creation under that reviewer identity, supply the fixtures/receipt through the approved channel, run the cases, and store actual observed results. No new username, password or account identifier is invented here. Detailed access boundaries are in [publication-path.md](publication-path.md).

## Package validation remaining

Local validation passed: five positive/three negative cases, all required case fields, exact case/manifest equality and all 14 mentioned Director tool names against the actual built Worker's `tools/list`. The three already frozen listing fields (short description, long description and release notes) were preserved exactly during case synchronization. Local fixture existence, lengths and hashes passed readback. No browser, portal or model prompt was executed by this case preparation.

After all release edits are committed, root must regenerate the plugin/source archives with `scripts/package-release.mjs`, verify their checkpoint and SHA256 sums, and inspect that the source archive includes the final review cases, status and verified media fixtures. The clean-source packaging guard should remain enabled. Packaging is not reviewer execution or public publication.

## Current Portal and supporting video

Before this video addition, the same existing Portal Draft imported package 0.1.2 with Metadata No Issues and Skill Checks passed; Supporting review content reported no video walkthrough URL. Package 0.1.3 adds the verified, anonymously playable supporting SDK URL through extensions.com.openai.review.demo_recording_url. Reuploading this package updates the existing unsubmitted version record; the dated external Portal receipt records the actual upload and saved field. This is supporting coverage only and leaves every reviewer execution status above unchanged.

The canonical owner-private Site remains version 7. The ordinary public information Site hosts only the sanitized recording and player alongside its four existing pages. The ownership/domain and reviewer-OAuth enquiry has been sent and escalated to human OpenAI support; the platform procedure remains unresolved. No final submission, reviewer access grant or legal attestation is represented by this video addition.
