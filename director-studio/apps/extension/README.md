# AI Director Studio native Extension

This application runs independently of Electron and its backend. The selected ChatGPT Work or Codex host model is the Director. The editor uses MCP Apps with OpenAI Extensions 0.1.0. Projects and media use owner-scoped Sites D1 and R2. The official fal plugin remains a separate connection orchestrated by the host.

From `director-studio`, install with `npm ci`, run `npm run extension:build`, and run `npm run extension:test`. The Worker output is `../dist/server/index.js`; static UI is `../dist/client`. The root `.openai/hosting.json` holds the canonical Site identity and logical DB/MEDIA bindings. Hosted deployment uses the exact pushed source checkpoint and an archive built from it. Do not create a replacement Site/plugin on updates.

The portable source ZIP includes `.openai/hosting.example.json` without a Site identity. Its local build uses that template automatically. To deploy a separate installation, provision a Site and save its actual returned project ID in a local `.openai/hosting.json`; deployment packaging refuses an unbound template. Root `drizzle/` migrations are included in the ZIP and copied into `dist/.openai/drizzle/` by `scripts/package-sites.mjs`. The existing canonical private installation remains [AI Director Studio](https://ai-director-studio.yearemia.chatgpt.site).

The Editor bridge probes host support at connection time. Selection changes attach context without sending a turn. Unsupported native file/context/library features show a browser or copy fallback. Only live host results can establish native feature support.

Generated code runs in an opaque sandbox. Document operations use existing validated core schemas and optimistic version checks. Missing assets must be repaired before export. The service never reads host model or fal credentials.

See `release/acceptance.md` for evidence, `release/license-inventory.md` for licenses and `release/review-cases.json` for public review cases. Development policy pages are drafts; private hosting does not satisfy publicly accessible listing URL requirements. Public submission remains separate from private deployment and from Publisher verification.

Run `node apps/extension/scripts/package-release.mjs` only after committing all source inputs. It produces the portable plugin preparation ZIP, source ZIP and exact dependency inventory. The plugin ZIP connects to the verified private endpoint and preserves MIT notices; it does not install a duplicate app-backed plugin, publish the Site or complete Portal promotion. The source ZIP contains no vendored runtime WASM. Public codec binary distribution still depends on the license gates documented in the release inventory.
