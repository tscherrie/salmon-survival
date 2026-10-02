## 0.1.5 MCP review corrections

- Correct legacy initialize negotiation and validate modern per-request protocol metadata with the specified HTTP/JSON-RPC errors. The observed managed Sites/native path omits Mcp-Method and Mcp-Name; validate these headers whenever supplied while tolerating their absence at the Worker boundary. Strict external HTTP header conformance is not claimed. Version, capability and trusted user authorization checks remain.
- Mark operations that replace or remove existing project data as destructive in MCP tool annotations, even when project versions allow recovery.
- The public Portal draft 0.1.4 was uploaded and its domain is verified. Its Connect action fails before a Worker request with "OAuth client ID is required when using pre-defined OAuth client credentials." The visible OAuth selector is disabled and the supported Portal/Sites surfaces do not expose the required public-draft client configuration. These protocol corrections are independent of that configuration failure; no successful connection, scan or review submission is claimed.

## 0.1.4 prepared source

- Exclude unused original Remotion AAC/MP3/FLAC fallback payloads from Extension builds with importer-scoped fail-closed bindings. Eight affected outputs decode successfully, including native sandbox and Vite video, cancellation and recovery; all export formats remain. Separate desktop builds retain distinct provenance scope.
- Deliver both source ZIPs through the existing public information Site using bounded parts, complete ZIP SHA256 and a generated exact-checkpoint download manifest.

- Adopt the source-built, hash-verified FFmpeg Core UMD/ESM artifacts; retain explicit provenance and runtime limits. Embedded Mediabunny encoder modules remain the original baseline.
- Add functional SRT export with timeline/trim/speed timing and clear missing-data errors.
- Provide an isolated native project-file adapter and migration plan. The adapter is not wired into the current editor; cross-chat file continuity and backend TTL/deletion remain to be proven and implemented.
- Publish the exact domain verification route using a runtime secret. Portal 0.1.3 now shows Domain verified on the same canonical Site, OAuth client and MCP resource. Its scan/Connect still fails; no submission or publication is claimed.

# AI Director Studio 0.1.0 — release notes draft

Status: prepared for the first public-review package, 2 October 2026. The current deployment remains private. No directory submission or public publication is claimed.

AI Director Studio brings saved video, audio, presentation, graphic and website projects into a native editor driven by the user's selected ChatGPT Work or Codex model. It keeps briefs, material, document versions, decisions, checkpoints and job receipts together without a separate Director chat or inference key.

- Add timeline, slide, canvas and isolated website previews, material import and project/version reopening.
- Attach precise selection references to the next host turn when supported, with a copy fallback; selection itself sends no message.
- Save browser analysis/render jobs, support local cancellation and retries pinned to their historical project version, and return stored export files plus downloads.
- Preserve asset identity and provenance during missing-file repair, invalidate replaced cached bytes, and use a video icon when no image thumbnail exists.
- Hand new AI generation/transcription to the separately installed official Fal plugin with a current quote and approval. Retain original request and receipt information, including idempotent import of already completed Fal output. Keep estimates separate from confirmed billing.
- Deliver the native editor as self-contained HTML and load codec/compiler bytes through authenticated bounded requests. Correct MCP resource/discovery cache fields required by the actual host. Declare inline/fullscreen support and let project loading proceed while a fullscreen request is pending.

The user confirmed that the real native editor now opens after deployment checkpoint `cf761052228feedde11a590739cbf5d54767562e`. Broader local browser and SDK regression evidence covers editing, outputs and repair; it is not a claim that every operation has been tested visually in every production host. Root-owned acceptance reports record those boundaries.

Director is free; host plans, approved Fal jobs and hosting/device resource scopes remain separate. Formats depend on the browser and source material. Browser jobs need an open executor. Native Library helpers depend on host support, and direct `.dstudio` file entry is not implemented.

Application-authored source is MIT-licensed. Dependencies retain their own licenses; binary notices and corresponding-source requirements remain separate in [license-inventory.md](license-inventory.md). The user confirms Jeremias Grenzebach as the independent operator, with at most three people in the entire operating entity, satisfying the Remotion free-license size criterion. The confirmed public support/privacy contact is l@lll.uno; country targeting intentionally covers all countries offered by OpenAI. Four factual product/support/privacy/terms pages are published on the separate no-MCP information Site, anonymously checked with HTTP 200 and linked from package metadata. Canonical submission mapping, reviewer access and an actual native demo recording remain public-review preparation items. No legal attestation has been completed by these notes.
