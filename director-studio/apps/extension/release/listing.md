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

## Website copy and required URLs

Use the English description above as the product page body, identifying Jeremias Grenzebach as the user-confirmed independent operator, with the approved contact, privacy and terms links. The public support and privacy contact is **l@lll.uno**, expressly confirmed by the operator. The selected audience is **all countries offered by OpenAI**. Additional address/jurisdiction fields are conditional on a concrete applicable requirement, rather than assumed Portal fields. Preserve the canonical private App and MCP connection; a public information page does not require a second plugin wrapper or public access to private projects.

| Required field | Current private destination | Publication state |
| --- | --- | --- |
| `websiteURL` | `https://ai-director-studio.yearemia.chatgpt.site/` | Private; not a public listing URL |
| `supportURL` | `https://ai-director-studio.yearemia.chatgpt.site/support.html` | Private development page; confirmed public contact l@lll.uno |
| `privacyPolicyURL` | `https://ai-director-studio.yearemia.chatgpt.site/privacy.html` | Private development draft |
| `termsOfServiceURL` | `https://ai-director-studio.yearemia.chatgpt.site/terms.html` | Private development draft |

All four destinations return HTTP 401 to an anonymous visitor in the 2 October preparation check. Their URL fields remain absent from `plugin.json`. Publish and inspect approved pages at actual public HTTPS destinations before populating these fields. `extensions.com.openai.publication.countries` is intentionally `[]`: the operator expressly chose all available countries, and the documented empty array removes country restrictions. It does not grant access to the current private Site or create a public directory entry.

The policy texts are [privacy.md](privacy.md), [terms.md](terms.md) and [support.md](support.md). [publisher-approval.md](publisher-approval.md) collects the remaining decisions. Root-owned review cases, demo, evidence and final archives are separate materials; these drafts do not certify them.
