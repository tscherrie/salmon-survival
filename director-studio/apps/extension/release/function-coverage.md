# Function coverage against the existing Director

Comparison base: `cfa1ca17dd6e295bba8656b316c94812e3e2aa4b`, including its original dependency lockfile. This inventory compares the original `packages/core/src/api.ts`, `packages/director/src/tools/index.ts` and desktop exporter with the Extension implementation. It records source coverage, not a claim that every function has passed its final integration test or run in a real ChatGPT Work/Codex host.

Status vocabulary:

- **Implemented**: a concrete source path exists. Final integration evidence may still be pending.
- **Checked**: the specified automated or real-browser evidence exists; its scope is stated.
- **Host-owned**: the function is performed by the selected native host or separately installed official Fal plugin, as required by this Extension architecture. Real host execution remains unverified.
- **Pending**: a named test, deployment, external review or unsupported host surface remains open.

## Evidence boundaries

The earlier Extension checkpoint passed 30 tests in three files and workspace/Extension TypeScript checks. Later parity repairs listed below require their own final rerun; those earlier totals do not certify later edits. `evidence/browser-ui.json` records real Chrome UI interactions against the actual built Worker on loopback, with a synthetic owner header confined to the acceptance harness. It covers project persistence, externally initiated document refresh, historical-version viewing, a persisted question, reload and a 420px layout. It is not production authentication or native host proof.

The unchanged application baseline produced the same six failures as the first full Extension workspace run: app-env realpath, backend planning notice, desktop Chromium export executable, journal line number, FFmpeg ebur128 capability and labeled contact sheet. Its independent checkout used the original package/lockfile and application documentation. `evidence/baseline-tests.txt` is the baseline evidence; `evidence/workspace-tests.txt` records the workspace run. No expectation was weakened and no failure was skipped to make the result pass.

Real browser output checks and final parity reruns are recorded by the media/UI executors and must be attached before changing their status to accepted. Native Codex access was unavailable, and the independent origin-chat executor could not obtain a usable ChatGPT Work browser or `mcpapps` surface. Native global/thread opening, fullscreen, file Library, context removal, model switching and actual host Fal orchestration remain unverified. Publisher identity/public-directory review is a separate external gate.

## Original Studio API

Implementation pointers: `ui/BrowserStudioApi.ts`, `ui/hostBridge.ts`, `ui/NativeEditor.tsx`, `server/http.ts`, `server/service.ts`, `server/storage.ts` and `server/transfers.ts` relative to `apps/extension/`.

| Original API | Extension path and behavior | State / acceptance limit |
| --- | --- | --- |
| `getSettings` | Owner-scoped stored settings; native `settings.read` envelope and UI settings | Implemented; earlier backend setting checks passed; real native settings surface pending |
| `updateSettings` | Partial validated owner settings; native `settings.update` | Implemented; earlier backend setting checks passed |
| `setSecret` | Explicitly rejects Director/Fal token configuration; selected host owns model and official Fal plugin owns its credentials | Host-owned by design; no hidden inference backend |
| `getAuthStatus` | Does not impersonate Anthropic/Fal login; native connection and optional file capabilities come from `DirectorHostBridge` | Implemented adaptation; actual connected host pending |
| `listRecentProjects` | Owner-scoped cloud project list with category/checkpoint/budget summary | Implemented; earlier owner-boundary checks passed |
| `createProject` | All five categories or planning-only project; creates initial document/checkpoints when category is known | Implemented; earlier five-kind backend checks and graphic UI creation passed |
| `openProject` | Reads persisted snapshot by project ID, hydrates owned assets and observes later revisions | Checked in loopback UI reopen/reload; real host reopening pending |
| `getSnapshot` | Manifest, document/head, versions, assets, decisions, budgets, generations, jobs and site files | Implemented; earlier backend checks passed; final expanded job checks pending |
| `chooseDirectory` | Cloud projects are selected in the project browser; local folder picker is not used | Implemented adaptation; `.dstudio` folder migration/import is not asserted |
| `chooseFiles` | Real browser file input; optional native Library selection only when host exposes it | Implemented; real host Library selection pending |
| `sendMessage` | No own Director composer/chat; user sends the next turn in the native host | Host-owned by design; no automatic hidden turn |
| `interrupt` | Native host Stop control interrupts the model; browser media jobs have a separate cancellation path | Host-owned model control; media cancellation source implemented, final runtime check pending |
| `answerQuestion` | Validates and saves answers to the current persisted question | Checked in earlier backend and loopback UI; answers remain available after reopening |
| `decideCheckpoint` | Persisted approval/request-changes/skip, approved budget and decision record | Implemented; earlier backend checks passed; full review UI flow pending |
| `decideApproval` | User decision, generation reservation/rejection, immutable decision record | Implemented; earlier backend generation/budget checks passed; real Fal execution pending |
| `setEffort` | Native host model/effort controls; project never starts a second model runtime | Host-owned; actual model-switch continuity pending |
| `listModels` | Bundled Fal model discovery with explicitly unverified seed prices; native model is selected by host | Implemented; current schemas/quotes require official Fal plugin |
| `refreshModels` | Refreshes the discovery list; does not claim live price/schema verification | Implemented adaptation; actual Fal catalog interaction pending |
| `setPicker` | Persisted per-project modality choice; generation preparation enforces picker restriction | Implemented; earlier picker-lock backend check passed |
| `importFiles` | Copies browser/native files into owner/project storage; probes, thumbnails and analysis jobs; bounded chunk transfer in embedded host | Implemented; earlier storage/chunk checks passed; real native import pending |
| `searchAssets` | Shared asset query/filter logic over this project's assets | Implemented; separate from native and Fal Libraries |
| `assetUrl` | Owned originals and permitted variants; embedded host hydrates bytes to local blob URLs | Implemented; earlier binary/range/variant ownership checks passed |
| `revealAsset` | Opens the available owned media URL via host/browser | Implemented; real native external opening pending |
| `getLineage` | Owned parent/child input/derived relationships | Implemented; final derived processing provenance checks pending |
| `relinkAsset` | Replaces missing bytes while retaining asset ID and document uses | Implemented; final UI repair/relink scenario pending |
| `getVersion` | Immutable document snapshot; site versions include their exact file snapshot | Implemented; earlier backend snapshot/site tests and UI viewing passed |
| `restoreVersion` | Adds a new version referencing the old content; retains intervening history and exact old site files | Implemented; earlier immutable restore backend checks passed; final component-version export check pending |
| `transcribe` | Uploads input and returns explicit native Fal schema/quote/approval handoff; host stores transcript/word timing with `record_analysis` | Host-owned; no automatic paid transcription; end-to-end host transcription pending |
| `assetPeaks` | Returns persisted measured waveform min/max pairs | Implemented; final browser analysis output check pending |
| `previewOpen` | Browser builds the actual project source; compiled/site bytes run in isolated frames | Implemented; self-contained local assets and multipage parity repairs awaiting rerun |
| `previewSetBounds` | Browser viewport/layout bounds rather than Electron BrowserView positioning | Implemented adaptation; narrow graphic layout checked |
| `previewSetPickMode` | Isolated website picker emits selected element refs; validated source-bound message handling | Implemented; final website picker/navigation check pending |
| `previewOpenExternal` | Opens self-contained current page | Implemented; final multipage/browser opening check pending |
| `previewNavigate` | Renders selected project page from the self-contained page map | Implemented; final multipage navigation check pending |
| `exportProject` | Persistent version-pinned job, real browser processing, stored derived output, browser download or optional host Library delivery | Implemented; final format/sandbox/cancel/reopen outputs pending; actual Library delivery pending |
| `openExternal` | Uses advertised native operation or supported browser operation | Implemented; actual native operation pending |
| `onEvent` | Polls persisted owner project revision and emits compatible UI events without sending a chat turn | Checked for already-open UI document refresh; two real accounts pending |
| `pathForFile` | Registers actual dropped browser `File`; cloud copy semantics rather than filesystem linking | Implemented adaptation |

## Original Director tools

Original inventory includes optional `delegate`, `web_search` and `web_fetch`. The selected native host owns these capabilities and skill loading. They are not replaced by a second model loop or blanket proxy to external tools. MCP tool argument names are a new host-facing protocol; workflows must use its published schema rather than replay Electron call shapes unchanged.

| Original tool | Native Extension equivalent | State / acceptance limit |
| --- | --- | --- |
| `ask_user` | Persisted `ask_user`; optional native question capability | Implemented; persisted-answer checks passed; real native elicitation pending |
| `propose_checkpoint` | Same named proposal; user approval required | Implemented; decision/budget backend checks passed |
| `merge_checkpoints` | Same named merge preserving core checkpoint structure/provenance | Implemented; final merged review UI scenario pending |
| `post_update` | Persisted project note without automatic chat send | Implemented; not an inference turn |
| `set_brief` | Validated brief/category; creates production document from planning project | Implemented; earlier planning/five-kind checks passed |
| `search_models` | Bundled discovery plus explicit official Fal lookup for current facts | Implemented discovery; current lookup host-owned |
| `get_model_schema` | Explicit official Fal plugin handoff | Host-owned; actual host call pending |
| `estimate_cost` | Explicit official Fal quote handoff; stores neither inferred price nor charge | Host-owned; actual current quote pending |
| `generate` | `prepare_generation` → user approval → official Fal submission → import/`record_generation` | Implemented ledger/approval/receipt bridge; real host submission pending |
| `await_generations` | Reads durable receipts; host polls official Fal status and records actual status | Implemented durable read; actual polling host-owned |
| `cancel_generation` | Returns exact request; host cancels through Fal and records confirmed receipt | Host-owned provider cancellation; does not claim canceled from local intent |
| `search_assets` | Same named owned-project search | Implemented |
| `get_asset` | Same named asset/media provenance read | Implemented; binary access/isolation checks passed |
| `update_asset` | Same named metadata update; storage/Fal provenance fields protected | Implemented; earlier metadata/provenance backend checks passed |
| `reject_asset` | Persistent rejected status, no destructive deletion | Implemented |
| `create_text_asset` | Same named owned text/document/transcript asset creation | Implemented |
| `import_url` | Public HTTPS download into owned content-addressed storage; bounded size and unsafe-address/redirect rejection | Implemented; earlier import/boundary checks passed |
| `frames` | Version-pinned browser frame extraction job; stored image outputs | Implemented; final real output checks pending |
| `contact_sheet` | Browser frame extraction plus labeled contact sheet | Implemented; final real output checks pending |
| `analyze_audio` | Browser PCM → existing spectral DSP for beats/downbeats/sections/confidence; waveform and loudness; beat-map and optional timeline marker ops | Expanded parity source implemented; final PCM/browser/marker tests pending |
| `transcribe` | Official Fal transcription handoff; `record_analysis` stores actual words | Host-owned; final real host flow pending |
| `check_av_sync` | Two-source browser analysis with reference audio and optional ROI; audio comparison and visual correlation explicitly report method/confidence | Expanded parity source implemented; final two-source/ROI test pending; estimate is not semantic lip-sync proof |
| `cut_audio` | Actual browser decoded PCM region and handles, stored derived output/provenance | Implemented; final audio cut/handle output check pending |
| `extract_rotoscope` | Immediate official Fal mask/pose/depth/contour handoff; approved native generation and receipt import | Implemented handoff repair; final handoff test and real host flow pending |
| `get_document` | Same named document/head/summary read | Implemented |
| `apply_document_ops` | Atomic shared core validators and asset-kind checks; observed head required by MCP; CAS revision guard | Checked for invalid batch/stale edit/owner boundaries; final expanded source rerun pending |
| `restore_version` | Immutable earlier content becomes a new document version | Implemented; earlier backend restore checks passed |
| `write_component` | Stores immutable TSX code asset; document operation registers returned asset ID | Implemented; final changed-source and historical-version parity check pending |
| `render_still` | Real same-composition still export job including generated component/word timings | Implemented; final browser sandbox output check pending |
| `write_site_file` | Validated owned path/source; creates exact hashed file snapshot/version | Implemented; earlier path/site snapshot checks passed |
| `read_site_file` | Same named owned source read | Implemented |
| `list_site_files` | Same named owned source list | Implemented |
| `screenshot_site` | Actual compiled self-contained page screenshot inside isolated processing frame | Implemented; final React/local-assets/multipage screenshot checks pending |
| `export_project` | Real version-pinned browser export job and derived receipt | Implemented; final output matrix below pending |
| `load_skill` | Host reads installed Director/Fal skills; MCP initialize instructions include persistent workflow | Host-owned; installed canonical plugin skill availability pending |
| `delegate` | Native host agents/delegation | Host-owned; no own inference loop or generic external proxy |
| `web_search` | Native host search capability | Host-owned; not advertised as an Extension-owned search backend |
| `web_fetch` | Native host browsing capability; owned asset download remains `import_url` | Host-owned |

New Extension bridge functions also include project creation/list/open, native settings, `get_version`, `read_component`, `record_analysis`, `import_fal_result`, `list_jobs`, and the app-only `director_ui_request`. They do not grant a host model access to user-only approval actions. Previously completed Fal imports preserve original request/model/quote, distinguish unknown actual billing and avoid re-generating or charging again; the earlier idempotence backend case passed.

## Five categories and export formats

Shared validated documents remain `timeline` (video/audio), `deck`, `canvas` and `site`. Existing stage editing, selection references and monitors are reused; an empty document alone is not evidence of full category acceptance.

| Category | Formats covered in source | Difficult cases and current evidence |
| --- | --- | --- |
| Video | MP4, MOV, WAV; additional PNG/JPEG stills | Original footage plus generated TSX overlays/transitions, timed words, source offset/speed, gain/fades/ducking, formats and safe areas. Preview/export now load the document's exact code asset. Silent video inputs are excluded from the audio graph. Default video/mix target −14 LUFS, −1 dBTP. Final code-version, silent source, mixed audio and actual file output tests pending. |
| Audio | WAV, MP3, M4A, FLAC | Shared FFmpeg mix graph includes clip/track gain, tempo chains, source in-points, fade curves and clip/signal ducking; default −14 LUFS, explicit podcast −16. Spectral beat/downbeat analysis, confidence and markers restored; sections remain empty because the original detector has no section classifier. Final decoded output/loudness/beat/cancel tests pending. |
| Slides | PDF, PPTX, PNG (ZIP for multiple raster slides) | Notes, editable native text/shapes/charts/media, rich Markdown runs/bullets, fit/crop, colors/transparency and font naming now use shared PPTX mapper. HTML is rasterized. PDF/PNG reuse deck HTML; custom font assets are referenced. Hidden-slide export behavior matches shared renderer. Final PPTX mapping/font/media and multi-page outputs pending; recipient fonts are an explicit portable PowerPoint requirement. |
| Graphic | PNG, JPEG, PDF, SVG | Shared canvas SVG includes nested groups, crop, opacity, masks, blends, gradients, text and effects; image assets are materialized. Graphic persistence/selection/version/narrow layout checked. Complex mask/blend/font raster/SVG output comparison pending. |
| Website | ZIP with production bundle and sources | Real esbuild WASM compilation of HTML/React, exact package versions, bundled dependencies and owned media. Self-contained pages preserve local scripts/CSS/images/fonts/media; multipage mapping and picker/navigation use isolated frames. Preview and screenshot use production build bytes. Final HTML/React/assets/multipage/captured output checks pending. Node-only/server packages are explicitly rejected by the browser compiler; no invented server runtime. |

## Persistence, recovery and safety mechanisms

| Mechanism | Concrete implementation | Acceptance limit |
| --- | --- | --- |
| Owner/project separation | Trusted Sites owner identity, owner-scoped D1 queries, owner/project content-addressed R2 keys; owned variant lookup; authenticated app-only bridge | Earlier automated two-owner tests passed. A second real account/live deployment test remains pending. |
| Atomic editing | Shared document ops plus expected head and D1 revision CAS; guarded version insert in the same transaction | Earlier stale edits/invalid operations passed. Final expanded rerun pending. |
| Immutable restoration | Document and site-file version rows persist; restoring creates a new head | Earlier backend site/document restore and UI version viewing passed. Component source is pinned by asset ID; output check pending. |
| Missing/corrupt assets | Specific media-repair failure, missing-material banner and replacement upload preserving ID | Source implemented; actual missing-byte/relink/export recovery UI check pending. |
| Questions/checkpoints/approval | Pending states and final answers/decisions survive reopens; explicit budget approval/reservation/receipt distinction | Earlier backend cases and persisted question UI passed; host-driven workflow pending. |
| Durable jobs | Queued/running/terminal state, version-pinned input, exclusive executor lease/heartbeat, output/error receipts | Earlier exclusive lease/completion backend case passed; final reopen/resume/receipt check pending. |
| Cancel/retry | AbortController propagated to media operations and sandbox request; separate persisted cancellation; retry creates a new linked attempt | Source implemented after audit; final active cancel and canceled-job reopen tests pending. Fal cancellation stays provider-owned. |
| Browser close | Cloud state persists; browser processing runs while editor is open and an abandoned lease may be resumed | Source implemented; no claim of Worker/background codec processing while closed. |
| Untrusted components/sites | Opaque iframe boundary; source compilation does not run in authenticated Worker; sandbox MessagePort and source-bound picker; private API has no public CORS | Earlier boundary/CSP/backend contracts passed; final real generated-component/site output run pending. |
| Native selection | Host model context updated for next user turn; refs stay scoped to editor/project; context removal respected; no automatic message send | Earlier SDK/mock context tests passed. Real host context attach/remove, model change and two-chat continuity pending. |
| Optional native files | Only advertised file select/upload capability used; fallback browser import/download is explicitly shown | Source implemented; native Library delivery/reopen proof pending. |

## Work that must not be mislabeled as complete

Final source/typecheck/test counts and real output file results must be added after the parity reruns. Private Sites deployment/canonical plugin ID/install URL and live tool response must be recorded after deployment; a local preview does not prove these. Real ChatGPT Work/Codex host acceptance remains open because no usable computer-use surface was obtained. No second real account is assumed. Public promotion, publisher identity, public policy/support pages, reviewer login/demo playback and legal attestations remain separate unverified release work. Root will append final evidence and live links to `acceptance.md`.

## Final evidence addendum

The later39 Extension tests and actual22-output matrix supersede the earlier pending source-repair labels above. See acceptance.md and evidence/browser-outputs.json, browser-perception.json and browser-media-ui.json for precise checks. Embedded audio/reference and silent video/normalized ROI each recovered a known240ms offset; spectral120BPM beats/downbeats/confidence, persistent marker ops and beat-map file, cut handles, active abort/codec recovery, rich PPTX package XML, decoded audio loudness, canvas mask/multiply pixels and reopened React production ZIP with image bytes were verified. Per-instance model context tests remain synthetic host tests. Real native host opening/context/Library/Fal, two real accounts, missing-byte repair UI and public Portal promotion are not claimed by these output checks.

Final integration includes four manifest integrity regressions and one deterministic original desktop shutdown-race regression. Aggregate1,109 passed, six unchanged baseline failures,19 existing skips. The Extension remains39passing tests; latest runtime output checks use the chunked FFmpeg module and reject corrupt served bytes.
