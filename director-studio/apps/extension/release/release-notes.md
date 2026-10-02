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

Application-authored source is MIT-licensed. Dependencies retain their own licenses; binary notices and corresponding-source requirements remain separate in [license-inventory.md](license-inventory.md). The user confirms Jeremias Grenzebach as the independent operator, with at most three people in the entire operating entity, satisfying the Remotion free-license size criterion. Approved public policies/support pages, remaining operator contact details, country targeting, reviewer access and an actual demo recording remain public-review preparation items. No legal attestation has been completed by these notes.
