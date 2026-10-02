# AI Director Studio — listing draft

Status: listing revision 0.1.1 prepared on 2 October 2026 to address the existing Portal draft’s pricing-text and category findings. New scan outcome must be recorded separately. This is unpublished copy, not a directory listing or approval. The private native editor starts successfully in the user's current host after source checkpoint `cf761052228feedde11a590739cbf5d54767562e`; this does not establish every host interaction or export format as production-tested.

## English listing

| Field | Prepared value |
| --- | --- |
| Display name | AI Director Studio |
| Subtitle | Edit video, audio and graphics |
| Developer label | Jeremias Grenzebach, preserving existing metadata and the user-confirmed independent operator; verify the final Portal publisher label/assignment separately |
| Category | Creativity, supported by the current official submission error reference; read back after upload |
| Logo | `assets/logo.png` |
| Composer icon | `assets/composer.png` |

### Description

AI Director Studio is a creative media editor for making video and audio projects, presentations, graphics and small websites inside ChatGPT Work or Codex. Use your selected host model to plan changes and the native editor to inspect and refine the result.

Import your own media, arrange clips on a timeline, adjust clip timing and audio levels, and preview the result. Create editable slide text and shapes with speaker notes, work on a graphics canvas, or inspect website files in an isolated preview.

Keep the project brief, source material, document versions, checkpoints and processing receipts together. Reopen stored projects, inspect earlier versions and restore them while retaining history. Projects and uploaded files are stored privately for the authenticated owner. Completed media results from the separately installed official Fal plugin can be imported with their original request provenance.

Selected clips, assets, markers and elements can provide precise project references for the next chat turn when the host supports context updates. Selection alone sends no message and starts no generation. A copyable context fallback is available.

Exports are saved in the project and offered as downloads. Available formats include video MP4/MOV, audio WAV/MP3/M4A/FLAC, slides PDF/PPTX/PNG, graphics PNG/JPEG/PDF/SVG and website ZIP. Format support and capacity depend on the browser, source media and host. Keep the editor open during browser processing; stored job records let you inspect failed or interrupted work and retry it. Direct opening of .dstudio files through a native file entrypoint is not implemented.

Commercial disclosures remain in [support.md](support.md), [terms.md](terms.md) and `extensions.com.openai.review.commerce_description`. This function-focused listing contains no pricing or subscription copy. The public information pages are unchanged.

### Starter prompts

The package preserves its existing first prompt. The other two are optional prepared alternatives, not automatically imported metadata.

1. Open AI Director Studio and help me plan and edit a media project.
2. Create two slides with speaker notes and a matching title graphic, then help me export them.
3. Import an existing Fal media result with its original request provenance.

## German listing translation draft

Subtitle: **Video, Audio und Grafik ändern**

Plane und bearbeite Video, Audio, Präsentationen, Grafiken und Websites mit deinem gewählten Modell in ChatGPT Work oder Codex. AI Director Studio speichert Briefing, Material, Dokumentversionen, Checkpoints und Auftragsbelege im Projekt.

Importiere eigene Medien, prüfe Timeline, Folien oder Grafik und öffne Websites in einer isolierten Vorschau. Ausgewählte Clips, Assets, Marker und Elemente liefern genaue Projektreferenzen für deinen nächsten Chatturn, sofern der Host Kontextupdates unterstützt. Die Auswahl sendet keine Nachricht und startet keine Generierung; ein kopierbarer Kontext ist als Alternative verfügbar.

Öffne gespeicherte Projekte erneut, prüfe ältere Versionen und stelle sie wieder her. Exporte werden im Projekt gespeichert und zum Download angeboten. Formate und Kapazität hängen von Browser, Ausgangsmaterial und Host ab. Für Browserverarbeitung muss der Editor geöffnet bleiben; gespeicherte Auftragsbelege dokumentieren Status und Fehler.

AI Director Studio ist ein kreativer Medieneditor für Video, Audio, Folien, Grafiken und kleine Websites. Importiere abgeschlossene Ergebnisse des separat installierten offiziellen Fal-Plugins mit ihrer ursprünglichen Auftragsherkunft. Projekte und Dateien liegen in privatem Speicher des authentifizierten Eigentümers. Angaben zu Nutzung und externen Kosten stehen auf den veröffentlichten Support- und Nutzungsseiten.

This translation is a draft for a possible `de-DE` publication entry. It is not yet written into publication metadata or represented as Portal-verified.

## Published information pages and required URLs

The independent operator is Jeremias Grenzebach. Public support and privacy contact: **l@lll.uno**. Availability is selected for **all countries offered by OpenAI**. A separate ordinary static information Site publishes these pages without a Director MCP server or private project/file storage.

| Required field | Published destination | Verified state |
| --- | --- | --- |
| `websiteURL` | `https://ai-director-studio-info.yearemia.chatgpt.site/` | Anonymous HTTP 200, product content matches source |
| `supportURL` | `https://ai-director-studio-info.yearemia.chatgpt.site/support.html` | Anonymous HTTP 200, contact and recovery content verified |
| `privacyPolicyURL` | `https://ai-director-studio-info.yearemia.chatgpt.site/privacy.html` | Anonymous HTTP 200, current storage/network/deletion limits stated |
| `termsOfServiceURL` | `https://ai-director-studio-info.yearemia.chatgpt.site/terms.html` | Anonymous HTTP 200, free service and external costs stated |

All four fields are written into `extensions.com.openai.interface` in `plugin.json`. [Public-page evidence](evidence/public-information-pages.json) records actual anonymous status and exact main-content comparison. Sites adds a platform script, so complete HTTP response bytes are not represented as identical to the authored HTML. The private runtime retains its existing access policy and canonical App/plugin identity.

`extensions.com.openai.publication.countries` is intentionally `[]`: the operator expressly chose all available countries, and the documented empty array removes country restrictions. It does not change the runtime audience or create a directory listing.

Sources are [product.md](product.md), [privacy.md](privacy.md), [terms.md](terms.md) and [support.md](support.md). The static source and reproducible generator are in `../info-site` and `../scripts/sync-public-information.mjs`. Public pages are not directory approval, a native reviewer walkthrough, complete deletion implementation or a Portal legal attestation. [publisher-approval.md](publisher-approval.md) records remaining work.
