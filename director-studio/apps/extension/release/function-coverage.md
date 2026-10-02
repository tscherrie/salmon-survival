# Function coverage against the existing Director

Comparison base: `cfa1ca17dd6e295bba8656b316c94812e3e2aa4b`, including its original dependency lockfile. This inventory compares the original `packages/core/src/api.ts`, `packages/director/src/tools/index.ts` and desktop exporter with the Extension implementation. It records source coverage, not a claim that every function has passed its final integration test or run in a real ChatGPT Work/Codex host.

Status vocabulary:

- **Implemented**: a concrete source path exists. Final integration evidence may still be pending.
- **Checked**: the specified automated or real-browser evidence exists; its scope is stated.
- **Host-owned**: the selected native host or separately installed official Fal plugin owns the function. Execution evidence is specified per row.
- **Pending**: a named test, deployment, external review or unsupported host surface remains open.
- **Not implemented**: the requested optional feature has no implementation; this is distinct from an unverified implementation.

## Evidence boundaries

The final source checkpoint passes 51 Extension tests in four files and both workspace/Extension TypeScript checks. The workspace result is 1,127 passed tests, six independently reproduced unchanged baseline failures and 19 existing skips across 93 files. `evidence/extension-tests.txt`, `evidence/workspace-tests.txt`, `evidence/workspace-types.txt`, `evidence/extension-types.txt` and [acceptance.md](acceptance.md) record these results, including runtime integrity, media recovery, cache invalidation and sandbox regressions; earlier checkpoint totals are superseded.

The unchanged application baseline produced the same six failures as the first full Extension workspace run: app-env realpath, backend planning notice, desktop Chromium export executable, journal line number, FFmpeg ebur128 capability and labeled contact sheet. Its independent checkout used the original package/lockfile and application documentation. `evidence/baseline-tests.txt` is the baseline evidence; `evidence/workspace-tests.txt` records the workspace run. No expectation was weakened and no failure was skipped to make the result pass.

Real Chrome interactions against the built Worker use a synthetic owner confined to the loopback harness. `evidence/browser-ui.json` covers persistence, document refresh, version viewing, a persisted question, reload and 420px layout. `browser-outputs.json` covers 22 actual files; `browser-perception.json`, `browser-media-ui.json` and `browser-site-ui.json` cover measured media, playback/cancellation and website navigation/picking/export. `browser-media-repair.json` additionally proves physical missing-byte failure, visible relink, preserved ID/provenance/reference, cleared alerts and a stored/downloaded 640×360 PNG. These are real browser/Worker results, not production OAuth or real native host UI proof.

The installed canonical private plugin uses actual host OAuth. `evidence/live-native-mcp.json` and `live-native-categories.json` together verify production create/edit/fresh-read/reopen across video, audio, slides, graphic and website, exact owned code reads, immutable website source restoration, rejected stale/invalid edits, completed Fal-result reuse and persistent queued-job cancellation/retry. No synthetic owner or Sites dispatch-token identity is used for those calls. Production codec completion and new paid Fal orchestration are not asserted.

The user's real ChatGPT screenshot at 1:19 AM shows a fullscreen request followed by **“Studio Editor konnte nicht angezeigt werden”**. This is an observed host error, not merely an unavailable test surface. The current fix packages standalone editor HTML and obtains private runtime bytes through authenticated MCP. `evidence/native-runtime.json` verifies compiler, WAV and component output with denied direct HTTP and an opaque child frame, using a simulated parent capability.

After the explicit media-role fix, `evidence/native-auth-iframe.json` passes with the actual SDK Client, AppBridge and PostMessageTransport against the built Worker, using synthetic loopback authentication. Its deliberately constrained opaque main/child frames omit `unsafe-eval`: packaged editor/fonts, decoded video/exact TSX overlay, pointer playback and a stored 1.000 s MP4 passed. The boundary sentinel remained confined to the child, ordinary widget HTTP GETs were zero and all six deliberate direct-access probes returned 401. The report retains console warnings and blocked CSP feature/telemetry probes, with no page or SDK-host errors. This successful fixture does not establish real ChatGPT rendering. The user's next morning-session UI recheck remains pending, including fullscreen, context removal, model switching and Library delivery. Codex and independent `mcpapps` inspection were unavailable.

## Original Studio API

Implementation pointers: `ui/BrowserStudioApi.ts`, `ui/hostBridge.ts`, `ui/NativeEditor.tsx`, `server/http.ts`, `server/service.ts`, `server/storage.ts` and `server/transfers.ts` relative to `apps/extension/`.

| Original API | Extension path and behavior | State / acceptance limit |
| --- | --- | --- |
| `getSettings` | Owner-scoped stored settings; native `settings.read` envelope and UI settings | Implemented; earlier backend setting checks passed; real native settings surface pending |
| `updateSettings` | Partial validated owner settings; native `settings.update` | Implemented; earlier backend setting checks passed |
| `setSecret` | Explicitly rejects Director/Fal token configuration; selected host owns model and official Fal plugin owns its credentials | Host-owned by design; no hidden inference backend |
| `getAuthStatus` | Does not impersonate Anthropic/Fal login; native connection and optional file capabilities come from `DirectorHostBridge` | Actual installed native OAuth/MCP connection checked; visual editor connection/capability negotiation unverified |
| `listRecentProjects` | Owner-scoped cloud project list with category/checkpoint/budget summary | Implemented; earlier owner-boundary checks passed |
| `createProject` | All five categories or planning-only project; creates initial document/checkpoints when category is known | Checked in backend/loopback UI and production OAuth MCP across all five categories |
| `openProject` | Reads persisted snapshot by project ID, hydrates owned assets and observes later revisions | Checked in loopback UI reopen/reload and actual native MCP project reopening; visual native reopening unverified |
| `getSnapshot` | Manifest, document/head, versions, assets, decisions, budgets, generations, jobs and site files | Checked by final backend cases and native MCP snapshots; cancellation/retry version persistence verified |
| `chooseDirectory` | Cloud projects are selected in the project browser; local folder picker is not used | Implemented cloud adaptation; optional direct native `.dstudio` File entry is not implemented |
| `chooseFiles` | Real browser file input; optional native Library selection only when host exposes it | Implemented; real host Library selection pending |
| `sendMessage` | No own Director composer/chat; user sends the next turn in the native host | Host-owned by design; no automatic hidden turn |
| `interrupt` | Native host Stop control interrupts the model; browser media jobs have a separate cancellation path | Host-owned model control; active codec abort/recovery and built-editor cancellation passed; native MCP cancel/retry persists |
| `answerQuestion` | Validates and saves answers to the current persisted question | Checked in earlier backend and loopback UI; answers remain available after reopening |
| `decideCheckpoint` | Persisted approval/request-changes/skip, approved budget and decision record | Implemented; earlier backend checks passed; full review UI flow pending |
| `decideApproval` | User decision, generation reservation/rejection, immutable decision record | Implemented; earlier backend generation/budget checks passed; real Fal execution pending |
| `setEffort` | Native host model/effort controls; project never starts a second model runtime | Host-owned; actual model-switch continuity pending |
| `listModels` | Bundled Fal model discovery with explicitly unverified seed prices; native model is selected by host | Implemented; current schemas/quotes require official Fal plugin |
| `refreshModels` | Refreshes the discovery list; does not claim live price/schema verification | Implemented adaptation; actual Fal catalog interaction pending |
| `setPicker` | Persisted per-project modality choice; generation preparation enforces picker restriction | Implemented; earlier picker-lock backend check passed |
| `importFiles` | Copies browser/native files into owner/project storage; probes, thumbnails and analysis jobs; bounded chunk transfer in embedded host | Actual video file-picker import, storage/chunk and analysis checks passed in built-editor Chrome; real native file-picker/Library import pending |
| `searchAssets` | Shared asset query/filter logic over this project's assets | Implemented; separate from native and Fal Libraries |
| `assetUrl` | Owned originals and permitted variants; embedded host hydrates bytes to local blob URLs | Implemented; earlier binary/range/variant ownership checks passed |
| `revealAsset` | Opens the available owned media URL via host/browser | Implemented; real native external opening pending |
| `getLineage` | Owned parent/child input/derived relationships | Checked by final owner-validated derived-lineage cases and stored browser output receipts |
| `relinkAsset` | Replaces missing bytes while retaining asset ID/provenance/document uses; clears local repair state and refreshes changed source cache | Actual built-editor missing-byte/relink/recovered PNG passed; focused tests cover native transport and remote same-ID cache invalidation |
| `getVersion` | Immutable document snapshot; site versions include their exact file snapshot | Backend, UI viewing and production native website original/temporary source snapshots checked |
| `restoreVersion` | Adds a new version referencing the old content; retains intervening history and exact old site files | Production native website restored v6 as head 8 while retaining v7; source exactness and component asset regressions passed; real native visual restore pending |
| `transcribe` | Uploads input and returns explicit native Fal schema/quote/approval handoff; host stores transcript/word timing with `record_analysis` | Host-owned; no automatic paid transcription; end-to-end host transcription pending |
| `assetPeaks` | Returns persisted measured waveform min/max pairs | Actual browser waveform/analysis output and persisted peaks verified |
| `previewOpen` | Browser builds the actual project source; compiled/site bytes run in isolated frames loaded through authenticated runtime transport when embedded | Local/site outputs and constrained SDK opaque video/TSX preview/playback passed; real ChatGPT fullscreen opening failed in the observed screenshot and awaits recheck |
| `previewSetBounds` | Browser viewport/layout bounds rather than Electron BrowserView positioning | Implemented adaptation; narrow graphic layout checked |
| `previewSetPickMode` | Isolated website picker emits selected element refs; validated source-bound message handling | Actual visible local navigation and selector/bounds picking passed in built-editor Chrome |
| `previewOpenExternal` | Opens self-contained current page | Self-contained page output verified; actual native external-window operation unverified |
| `previewNavigate` | Renders selected project page from the self-contained page map | Real mouse navigation to About passed in built-editor Chrome |
| `exportProject` | Persistent version-pinned job, real browser processing, stored derived output, browser download or optional host Library delivery | 22 actual outputs, repair recovery and built-editor cancel/reload passed; constrained SDK opaque export stored a valid MP4; production MCP queued cancel/retry verified. Real ChatGPT codec output and Library delivery remain unverified |
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
| `get_asset` | Same named asset/media provenance read | Binary/isolation cases and fresh production native metadata/hash reads passed |
| `update_asset` | Same named metadata update; storage/Fal provenance fields protected | Implemented; earlier metadata/provenance backend checks passed |
| `reject_asset` | Persistent rejected status, no destructive deletion | Implemented |
| `create_text_asset` | Same named owned text/document/transcript asset creation | Implemented |
| `import_url` | Public HTTPS download into owned content-addressed storage; bounded size and unsafe-address/redirect rejection | Implemented; earlier import/boundary checks passed |
| `frames` | Version-pinned browser frame extraction job; stored image outputs | Actual browser-generated files and stored processing receipts verified |
| `contact_sheet` | Browser frame extraction plus labeled contact sheet | Actual browser-generated files and stored processing receipts verified |
| `analyze_audio` | Browser PCM → existing spectral DSP for beats/downbeats/confidence; waveform and loudness; beat-map and optional timeline marker ops; sections explicitly empty | Synthetic 120 BPM audio: 23 beats, six downbeats, 24 onsets, .945 confidence; actual beat-map and deduplicated marker ops passed |
| `transcribe` | Official Fal transcription handoff; `record_analysis` stores actual words | Host-owned; final real host flow pending |
| `check_av_sync` | Two-source browser analysis with reference audio and optional ROI; audio comparison and visual correlation explicitly report method/confidence | Known +240 ms recovered from embedded/reference audio and silent-video/reference ROI motion; method/confidence recorded; not semantic lip-sync proof |
| `cut_audio` | Actual browser decoded PCM region and handles, stored derived output/provenance | Actual 1.5 s PCM cut for 1..2 s plus .25 s handles verified; records .75..2.25 s source bounds |
| `extract_rotoscope` | Immediate official Fal mask/pose/depth/contour handoff; approved native generation and receipt import | Immediate handoff backend case passed; actual approved provider job remains host-owned/unverified |
| `get_document` | Same named document/head/summary read | Checked through fresh production native reads across all five categories |
| `apply_document_ops` | Atomic shared core validators and asset-kind checks; observed head required by MCP; CAS revision guard | Final atomic/stale/owner checks passed; actual native MCP stale and invalid batch rejected without document/budget mutation |
| `restore_version` | Immutable earlier content becomes a new document version | Backend checks and production native website exact restore/new head/history retention passed |
| `write_component` | Stores immutable TSX code asset; document operation registers returned asset ID | Exact code-asset references and equal-byte component records checked; actual native R2 write/read succeeded; visual native historical export unverified |
| `render_still` | Real same-composition still export job including generated component/word timings | Actual isolated generated TSX/timed-word PNG and MP4 outputs verified |
| `write_site_file` | Validated owned path/source; creates exact hashed file snapshot/version | Backend checks and four production native source-file roundtrips plus immutable restore passed |
| `read_site_file` | Same named owned source read | Production native reads match all four authored files and restored/historical source exactly |
| `list_site_files` | Same named owned source list | Production native list contains four files totaling 922 bytes |
| `screenshot_site` | Actual compiled self-contained page screenshot inside isolated processing frame | Actual isolated screenshot and reopened production React ZIP/local assets/multipage checks passed |
| `export_project` | Real version-pinned browser export job and derived receipt | Actual 22-output matrix and constrained SDK opaque MP4/persisted receipt passed; production native version-pinned queued cancel/retry checked. Completed production codec output still requires the real editor recheck |
| `load_skill` | Host reads installed Director/Fal skills; MCP initialize instructions include persistent workflow | Canonical plugin installed/OAuth verified and MCP instructions returned; host skill-loading behavior unverified |
| `delegate` | Native host agents/delegation | Host-owned; no own inference loop or generic external proxy |
| `web_search` | Native host search capability | Host-owned; not advertised as an Extension-owned search backend |
| `web_fetch` | Native host browsing capability; owned asset download remains `import_url` | Host-owned |

New Extension bridge functions also include project creation/list/open, native settings, `get_version`, `read_component`, `record_analysis`, `import_fal_result`, `list_jobs`, and the app-only `director_ui_request`. They do not grant a host model access to user-only approval actions. Previously completed Fal imports preserve original request/model/quote, distinguish unknown actual billing and avoid re-generating or charging again; the earlier idempotence backend case passed.

## Five categories and export formats

Shared validated documents remain `timeline` (video/audio), `deck`, `canvas` and `site`. Existing stage editing, selection references and monitors are reused; an empty document alone is not evidence of full category acceptance.

| Category | Formats covered in source | Difficult cases and current evidence |
| --- | --- | --- |
| Video | MP4, MOV, WAV; additional PNG/JPEG stills | Original footage plus generated TSX overlays/transitions, timed words, source offset/speed, gain/fades/ducking, formats and safe areas. Preview/export now load the document's exact code asset. Silent video inputs are excluded from the audio graph. Default video/mix target −14 LUFS, −1 dBTP. Actual generated component/timed-word PNG/MP4, silent-source video and original-audio mix outputs passed. Native MCP persisted a 155-frame, 30 fps V1 clip at head 2 from the completed Fal result; actual production codec output still requires an open editor. |
| Audio | WAV, MP3, M4A, FLAC | Shared FFmpeg gain, tempo, in-points, fade curves and clip/signal ducking; default −14 LUFS, explicit podcast −16. Actual decoded outputs, measured loudness, spectral beats/downbeats/confidence, marker deduplication and codec abort/recovery passed; sections remain empty because no section classifier exists. Production native MCP created/edited/reopened a three-track, two-marker timeline with persisted gains/ducking, exact code asset readback and stale-head rejection. That native sequence did not assert playable audio or codec output. |
| Slides | PDF, PPTX, PNG (ZIP for multiple raster slides) | Shared PPTX mapper preserves editable text/shapes/charts/media, rich Markdown/bullets, fit/crop, colors/transparency, font naming and notes; HTML is rasterized and PDF/PNG reuse deck HTML. Actual two-page PDF, multi-slide PNG ZIP and editable PPTX package checks passed. Production native MCP reopened two slides with five editable elements, theme and two speaker-note entries; an invalid batch left the document unchanged. Native presentation export/opening is unverified; recipient fonts remain a portable PowerPoint requirement. |
| Graphic | PNG, JPEG, PDF, SVG | Shared canvas handles nested groups, crop, opacity, masks, blends, gradients, text and effects; image assets are materialized. All four format outputs, expected mask/multiply pixels, persistence/selection/version/narrow layout and physical missing-byte recovery to PNG passed in real Chrome. Production native MCP graphic create/edit/reopen and owned code storage passed. Real ChatGPT visual opening awaits recheck after the observed fullscreen error. |
| Website | ZIP with production bundle and sources | Esbuild WASM compiles HTML/React with exact packages and owned media. Self-contained pages preserve local scripts/CSS/images/fonts/media; multipage preview, picker and navigation use isolated frames. Actual HTML/React ZIPs, reopened production React with image bytes, screenshots, real mouse navigation/picking and historical ZIP passed. Production native MCP persisted two pages/four files (922 bytes), read exact sources, and restored v6 as head 8 while retaining original/temporary history. Native visual preview/ZIP output is unverified. Node-only/server packages are explicitly rejected. |

## Persistence, recovery and safety mechanisms

| Mechanism | Concrete implementation | Acceptance limit |
| --- | --- | --- |
| Owner/project separation | Trusted native OAuth owner identity, owner-scoped D1 queries, owner/project content-addressed R2 keys; owned variant lookup; authenticated app-only bridge | Automated two-owner cases and actual production native OAuth access passed. A Sites dispatch token establishes neither owner identity nor authenticated MCP proof; anonymous live probes return 401. No second real account available. |
| Atomic editing | Shared document ops plus expected head and D1 revision CAS; guarded version insert in the same transaction | Final automated cases and actual native MCP stale/atomic invalid rejections passed; rejected calls preserved document and budget. |
| Immutable restoration | Document and site-file version rows persist; restoring creates a new head | Backend restore, UI viewing, historical site ZIP and production native exact website restoration passed. Components use the pinned asset ID; native R2 code readback passed. Real host visual restore remains pending. |
| Missing/corrupt assets | Confirmed read failure becomes local missing metadata/banner; replacement preserves ID/provenance/uses, clears alerts and invalidates changed-source cache | Physical absent-byte 409, visible relink picker, same ID/provenance/reference, cleared alerts and stored/downloaded 640×360 PNG passed in built-editor Chrome. Focused API cases cover native failures and same-ID remote replacement; no real host relink claim. |
| Questions/checkpoints/approval | Pending states and final answers/decisions survive reopens; explicit budget approval/reservation/receipt distinction | Earlier backend cases and persisted question UI passed; host-driven workflow pending. |
| Durable jobs | Queued/running/terminal state, version-pinned input, exclusive executor lease/heartbeat, output/error receipts | Final lease/terminal/receipt cases and actual built-editor automatic execution passed. Native queued-export cancellation persisted; retry creates a new attempt pinned to version 2 after head 3. Production completed codec receipt unverified. |
| Cancel/retry | AbortController propagated to media operations and sandbox request; separate persisted cancellation; retry creates a new linked attempt | Actual active codec abort/recovery, visible export Cancel and canceled-job reload passed. Native MCP queued cancellation/retry persisted. Fal provider cancellation remains unverified. |
| Browser close | Cloud state persists; browser processing runs while editor is open and an abandoned lease may be resumed | Source implemented; no claim of Worker/background codec processing while closed. |
| Untrusted components/sites | Opaque child media frame with explicit execution role; source compilation does not run in authenticated Worker; sandbox MessagePort/source-bound picker; private API has no public CORS | Opaque outputs and authenticated runtime checks passed. Actual SDK opaque/no-unsafe-eval rerun confirms generated-code sentinel only in child, successful playback/export and denied direct HTTP. Real ChatGPT CSP/permission behavior remains unverified. |
| Native selection | Host model context updated for next user turn; refs stay scoped to editor/project; context removal respected; no automatic message send | Earlier SDK/mock context tests passed. Real host context attach/remove, model change and two-chat continuity pending. |
| Optional native files | Only advertised file select/upload capability used; fallback browser import/download is explicitly shown | Source implemented; native Library delivery/reopen proof pending. |
| Direct native `.dstudio` File entry | Optional host File entrypoint for project files | **Not implemented.** Cloud project opening and ordinary file import do not constitute this feature. |

## Remaining host and public release checks

Production native MCP backend coverage spans all five categories, as detailed above and in [acceptance.md](acceptance.md). The completed Fal result was imported idempotently without a new provider submission, approval/reservation or charge assertion; actual billing remains unknown. Production export retry remains queued and pinned to v2 after head 3. It is not a completed production codec receipt.

The user confirmed the real native start after the cf761 resource-contract repair: “jetzt geht’s!” (evidence/native-start-user-confirmation.json). This human confirmation applies to that start, not every entry point or workflow. Native context attach/remove, model changes, Library delivery/reopening, full category export flows and new Fal generation/quote/provider cancellation still need their own checks. Constrained iframe/SDK results and loopback outputs remain separate evidence. Direct native `.dstudio` File entry is not implemented, and a second real account was not available.

Individual Verified identity is both human-confirmed and reported visible in a read-only Portal inspection. The four separate public information/support/privacy/terms pages are published and anonymously verified with HTTP 200 (evidence/public-information-pages.json), with their URLs present in metadata. Canonical Sites-app/submission-project mapping and promotion, reviewer access/native walkthrough, precise codec build-provenance gaps and legal attestations remain separate public-release gates. The operator with at most three people meets the Remotion Free criterion; no paid plan is pending. The supporting SDK demo has actual playback evidence (demo.md), but no reviewer prompt is marked passed by that recording. The clean-source packager and preserved MIT notice support reviewable private artifacts; they do not establish public-directory approval or legal clearance.
