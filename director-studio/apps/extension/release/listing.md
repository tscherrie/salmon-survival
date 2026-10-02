# AI Director Studio — listing draft

Status: prepared for publisher review on 2 October 2026. This is unpublished copy, not a directory listing or approval. The private native editor starts successfully in the user's current host after source checkpoint `cf761052228feedde11a590739cbf5d54767562e`; this does not establish every host interaction or export format as production-tested.

## English listing

| Field | Prepared value |
| --- | --- |
| Display name | AI Director Studio |
| Subtitle | Plan, edit and export media |
| Developer label | Jeremias Grenzebach, preserving existing metadata and the user-confirmed independent operator; verify the final Portal publisher label/assignment separately |
| Category | Productivity, preserving the current package value; confirm the target Portal category on import |
| Logo | `assets/logo.png` |
| Composer icon | `assets/composer.png` |

### Description

Plan and edit video, audio, presentations, graphics and websites with your selected ChatGPT Work or Codex model. AI Director Studio keeps the project brief, material, document versions, checkpoints and job receipts together in an interactive editor.

Import your own media, preview a timeline, work with slides or a canvas, and inspect a website in an isolated preview. Selected clips, assets, markers and elements can supply precise project references for your next chat turn when the host supports context updates. Selecting material does not send a message or start a generation. A copyable context fallback is available.

Return to stored projects, inspect earlier versions and restore them. Exports are stored in the project and offered as downloads. Available formats include video MP4/MOV, audio WAV/MP3/M4A/FLAC, slides PDF/PPTX/PNG, graphics PNG/JPEG/PDF/SVG and website ZIP. Format support and capacity depend on the browser, source media and host. The editor must remain open for browser processing; saved job records allow failed or interrupted work to be inspected and retried.

Director Studio is free and does not accept payments. Your ChatGPT or Codex access remains subject to that host's plan and limits. New AI media generation and transcription use the separately installed official Fal plugin and your connected Fal account. These requests may cost money: obtain a current quote and approve the job before submission. Director records the request and receipts; quoted estimates are distinct from confirmed billing. No separate model-provider API key is required by Director.

Projects and uploaded files persist in private storage associated with the authenticated owner. Source code is MIT-licensed; dependencies, codecs and fonts retain their own licenses. Direct opening of `.dstudio` files through a native file entrypoint is not implemented.

### Starter prompts

The package preserves its existing first prompt. The other two are optional prepared alternatives, not automatically imported metadata.

1. Open AI Director Studio and help me plan and edit a media project.
2. Create two slides with speaker notes and a matching title graphic, then help me export them.
3. Help me edit my imported video and explain any Fal cost before requesting new media.

## German listing translation draft

Subtitle: **Medien planen und bearbeiten**

Plane und bearbeite Video, Audio, Präsentationen, Grafiken und Websites mit deinem gewählten Modell in ChatGPT Work oder Codex. AI Director Studio speichert Briefing, Material, Dokumentversionen, Checkpoints und Auftragsbelege im Projekt.

Importiere eigene Medien, prüfe Timeline, Folien oder Grafik und öffne Websites in einer isolierten Vorschau. Ausgewählte Clips, Assets, Marker und Elemente liefern genaue Projektreferenzen für deinen nächsten Chatturn, sofern der Host Kontextupdates unterstützt. Die Auswahl sendet keine Nachricht und startet keine Generierung; ein kopierbarer Kontext ist als Alternative verfügbar.

Öffne gespeicherte Projekte erneut, prüfe ältere Versionen und stelle sie wieder her. Exporte werden im Projekt gespeichert und zum Download angeboten. Formate und Kapazität hängen von Browser, Ausgangsmaterial und Host ab. Für Browserverarbeitung muss der Editor geöffnet bleiben; gespeicherte Auftragsbelege dokumentieren Status und Fehler.

Director Studio ist kostenlos und nimmt keine Zahlungen entgegen. Für ChatGPT oder Codex gelten deren Tarife und Nutzungslimits. Neue KI-Medien und Transkriptionen laufen über das separat installierte offizielle Fal-Plugin und dein verbundenes Fal-Konto. Sie können kostenpflichtig sein; aktuelle Kostenschätzung und Freigabe gehören vor den Auftrag. Director benötigt keinen eigenen Modellanbieter-API-Key. Projekte und Dateien liegen in privatem, dem authentifizierten Eigentümer zugeordnetem Speicher. Der Quellcode steht unter MIT; Abhängigkeiten behalten ihre eigenen Lizenzen.

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
