# Public Director information site

This ordinary static site publishes product information, support, privacy and service terms. It contains no MCP server, plugins, connectors, project APIs, uploads, D1 or R2 binding. The private Director runtime and its access policy remain separate.

Content is authored in ../release/product.md, support.md, privacy.md and terms.md. Generate the pages with node ../scripts/sync-public-information.mjs from this directory, or from director-studio run node apps/extension/scripts/sync-public-information.mjs. The --check option verifies generated output without changes.

Hosting uses a separate Sites project whose public metadata is recorded in site.json. The deployment checkout uses .openai/hosting.json with static.directory = dist, copying public/ to dist/ before packaging. Credentials are never stored in source. The portable hosting.example.json contains no project identity.

Source download delivery uses `public/sources.html` and generated manifest/parts from `scripts/package-public-sources.mjs`. Large archives/parts stay outside Git. Package both source ZIPs together, preserve policy/demo bytes and verify every part and complete ZIP before deploying the existing ordinary information Site.
