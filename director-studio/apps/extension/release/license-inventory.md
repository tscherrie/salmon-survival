# License inventory and release decision

The application-authored extension changes are offered under the same MIT source license used by the repository, with original notices preserved. This is a source license choice, not a legal assertion that dependencies can be relicensed. The extension-specific copyright holder and final publisher identity must be confirmed for public publication. No Portal legal attestation has been completed by this implementation.

| Component | Observed license / requirement |
| --- | --- |
| Existing repository source | MIT; retain Chase Lean and tscherrie notices from director-studio/LICENSE, also included in the plugin preparation ZIP |
| React, Zustand, Vite, esbuild, PptxGenJS, pdf-lib, fflate, html-to-image | MIT declarations in installed packages; full machine inventory generated alongside package |
| Mediabunny | MPL-2.0; preserve notices and make the covered source available. Optional AAC, MP3 and FLAC encoders have additional codec/source requirements documented with the runtime notices. |
| OpenAI MCP Extensions | Apache-2.0; retain NOTICE/license |
| MCP Apps / MCP SDK | MIT declarations in installed packages |
| Instrument Sans and IBM Plex Mono | SIL Open Font License; include existing OFL files |
| Remotion 4.0.532 and related packages | Remotion License; source available, not OSI open source. Free license eligibility depends on entity and use; hosted public-service eligibility must be confirmed before public operation. Do not sublicense Remotion under MIT. |
| @ffmpeg/ffmpeg and @ffmpeg/util | MIT wrapper declarations |
| @ffmpeg/core 0.12.10 WASM binary | GPL-2.0-or-later. Distribution requires corresponding source/build information and GPL notices. The archive must not be described as wholly MIT. |
| esbuild-wasm | MIT |
| Electron / desktop-only FFmpeg binaries | Remain reference implementation. They are not required by the Extension Worker or browser. Local FFmpeg license depends on actual build flags. |

The private acceptance build bundles the exact npm WASM runtime for reproducibility. Public binary distribution is gated until its corresponding-source obligations are fulfilled and Remotion eligibility is resolved. Source-only release preparation contains the lockfile and source references, not vendored third-party binary code. These concrete gates are independent of Publisher verification. See the bundled runtime notices in `public/licenses/` and `ffmpeg-source.md` for the exact known upstream revisions and remaining reproducibility limitations; a source URL alone is not presented as verified complete corresponding source.

Primary license sources: installed `node_modules/remotion/LICENSE.md`, `node_modules/@ffmpeg/core/package.json`, each package's license file, and `director-studio/LICENSE`. See https://github.com/ffmpegwasm/ffmpeg.wasm and https://www.remotion.dev/docs/license for the dependency owners' current terms.
