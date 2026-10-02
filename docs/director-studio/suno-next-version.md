# Suno music integration for the next version

This work is isolated on `codex/suno-next-version`, starting at `cf761052228feedde11a590739cbf5d54767562e`. It is independent of the v1 publication branch and has not been deployed to the canonical Sites app. Fal stays the default media provider. The native host remains the Director; this change adds no model loop or composer.

## Current official evidence

Checked 2026-10-02 using primary sources:

- [Suno Platform](https://platform.suno.com/) explicitly advertises its own REST API for songs, covers and mashups. The public page asks users to sign in to manage an API account. **The official API exists.** Public endpoint reference, app OAuth authorization, available API models, pricing, quotas and API-specific rights were not exposed by this unauthenticated page. `/docs` and `/documentation` did not yield public documentation. This does not prove that documentation or eligible account access is unavailable after sign-in.
- [Suno Studio 2.0](https://help.suno.com/en/articles/13670529), edited 2026-08-13, documents complete-song, selected-range and multitrack export in 32-bit WAV or MP3, plus individual WAV stems. It describes aligned stem tracks and says there is no direct DAW sync or plugin-host integration. Export availability remains governed by the user's Suno account and current plan.
- [v6 FAQ](https://help.suno.com/en/articles/13924481), edited 2026-09-09, describes v6, v6-wild and v6-mini and retirement of earlier models for new generations. The implementation deliberately does not hardcode these as a permanent model catalog: the user chooses a currently available model in Suno, and an optional original-model field preserves historical provenance.
- [Suno distribution guidance](https://help.suno.com/en/articles/2410177) ties commercial use to a Pro/Premier plan at creation and explicitly says a later subscription does not retroactively license Free creations. Other material in the song still needs appropriate rights. The stored declaration therefore records the original plan, intended use and optional evidence, rather than automatically asserting a license.
- [Current Suno terms](https://suno.com/terms), revised 2026-08-10 and effective 2026-09-03, restrict scraping, access through means not intentionally provided, and bypassing protections. Director uses the official website and the user's downloaded files/direct audio links. It does not extract browser cookies, scrape song pages or call undocumented consumer endpoints.

Third-party services using “Suno API” in their names are not used as evidence of first-party access and are not configured as default providers. No account login, partner application, purchase, paid generation or external message was performed for this work.

## Working workflow

1. The native Director prepares a title, music description, optional style/lyrics and instrumental preference with `prepare_suno_music`. The project retains this prompt across reopening. The returned text is copyable; its destination is the fixed official `https://suno.com/create` URL. Prompt content and credentials are never embedded in a URL query.
2. The Suno dialog loads the latest host-prepared prompt. **Copy prompt** persists/copies it; **Open Suno** opens the official site. The user controls Suno login, model selection, generation and charges there. Director does not claim a generation has started or provide a fake cancellation button.
3. The user imports an exported song, a set of up to 24 audio stems, or a direct public HTTPS audio download. An ordinary Suno song webpage is provenance only and is rejected as an audio download. Redirects, private addresses and oversized downloads follow the existing import boundary.
4. `record_suno_import` stores a user-declared provider group, source song link, optional original model/date, creation plan, intended use, acknowledgment and evidence note. It explicitly retains `generationVerified:false`, `rightsVerified:false` and `billingKnown:false`; it creates no generation or payment entry.
5. Optional timeline placement adds distinct audio tracks with a common start and source offset zero. It preserves original file durations and existing tracks. The user chooses aligned stems from the same export, excluding the full mix. A stale `expectedHead` rejects the placement atomically. Projects without a timeline can still retain audio assets.
6. Audio is copied into the user's owned project storage and survives reopening. A byte-identical pair of stems still keeps distinct asset records, including the chunked native upload path. Provider provenance cannot be overwritten via the generic asset metadata editor.

The workflow records a declaration; it does not certify that an uploaded file originated from Suno or that every stem's alignment was correct. The user's source exports remain the evidence. Existing browser analysis, preview, mixing and export processing continues to apply to imported audio.

## Host tools and provider contract

The additional host tools are `get_music_providers`, `prepare_suno_music`, `list_suno_handoffs`, `import_suno_audio_url` and `record_suno_import`. The last two are deliberately separate: an imported direct download gets its actual duration probed before optional timeline placement and provider declaration.

`shared/suno.ts` exposes the exact current capabilities: website handoff, file/direct audio import and aligned stem placement, with native generation and account linking disabled. It also defines a future **server-only** adapter contract for capability/model discovery, expiring quote, user-approved capped/idempotent submission, asynchronous status/output/error and confirmed cancellation. There is no endpoint or credential transport implementation behind this contract.

For direct API generation, the next concrete step is to obtain the official accessible API documentation and intended account authorization. Confirm the endpoint and authentication contract, whether credentials are per user or an approved partner account, quote/billing/rights semantics and cancellation support. Then implement that contract server-side, preserve actual request/output/billing provenance and import verified outputs through owned R2 storage. Do not assume consumer Pro/Premier credits fund API usage or that consumer login is a Director OAuth grant. No paid smoke test is required for adapter tests; a real generation remains a separate explicitly authorized acceptance check.

## Validation and limits

Run from the repository root after installing dependencies in `director-studio`:

```sh
npm --prefix director-studio run extension:test
npm --prefix director-studio run -w @studio/extension typecheck
npm --prefix director-studio run extension:build
DIRECTOR_ACCEPTANCE_PORT=5202 DIRECTOR_ACCEPTANCE_DIR=/tmp/director-suno-store node director-studio/apps/extension/scripts/acceptance-server.mjs
# In another terminal, with Chrome, ffmpeg and ffprobe installed:
node director-studio/apps/extension/scripts/suno-acceptance.mjs /tmp/director-suno-proof
```

The added tests cover native MCP prompt preparation, account/project isolation, persistence, no hidden network/generation/charge, rights acknowledgment and immutable provenance, exact audio MIME rejection, stale-head atomicity, synchronized stem tracks, same-byte chunked uploads, clipboard handoff and recoverable dialog errors.

Validation completed: **67/67 extension tests**, extension typecheck and build passed. The [sanitized receipt](evidence/suno-next-version.json) includes source hashes and the native UI build identity. The supporting browser run also verifies a real two-second WAV export whose decoded samples contain both input tone frequencies, and a 420px layout without horizontal page overflow.

The supporting browser run uses the actual built editor/Worker and loopback D1/R2 emulators, a synthetic owner and two locally generated tones. It verifies real file upload, saved bytes, durations, synchronized tracks and reopening. These fixtures are explicitly labeled as local tones, not actual Suno outputs. This is supporting browser evidence, not proof of native ChatGPT display or a real Suno account generation.

The separate [renderer research](v2-renderer-research.md) is planning only. It introduces no renderer dependency or runtime change in this Suno implementation. Integrate this next-version branch with the finalized v1 source only when starting v2; it is not part of the current release package or live Sites deployment.
