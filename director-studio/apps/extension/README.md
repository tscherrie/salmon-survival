# AI Director Studio native Extension

This application runs independently of Electron and its backend. The selected ChatGPT Work or Codex host model is the Director. The editor uses MCP Apps with OpenAI Extensions 0.1.0. Projects and media use owner-scoped Sites D1 and R2. The official fal plugin remains a separate connection orchestrated by the host.

From `director-studio`, install with `npm ci`, run `npm run extension:build`, and run `npm run extension:test`. The Worker output is `../dist/server/index.js`; static UI is `../dist/client`. The root `.openai/hosting.json` holds the canonical Site identity and logical DB/MEDIA bindings. Hosted deployment uses the exact pushed source checkpoint and an archive built from it. Do not create a replacement Site/plugin on updates.

The Editor bridge probes host support at connection time. Selection changes attach context without sending a turn. Unsupported native file/context/library features show a browser or copy fallback. Only live host results can establish native feature support.

Generated code runs in an opaque sandbox. Document operations use existing validated core schemas and optimistic version checks. Missing assets must be repaired before export. The service never reads host model or fal credentials.

See `release/acceptance.md` for evidence, `release/license-inventory.md` for licenses and `release/review-cases.json` for public review cases. Development policy pages are drafts; private hosting does not satisfy publicly accessible listing URL requirements. Public submission remains separate from private deployment and from Publisher verification.
