---
name: h3-max
description: Prompting- und Produktionsguide für die Videomodell-Familie h3-max (Default-Videomodell) – Endpunkte, Dauer, Formate, Referenzen, Verlängern, Kosten.
---

# h3-max (MiniMax via fal) – Video-Default

Stand: Recherche 2026-09/10. Die Familie ist neu; prüfe vor dem ersten Einsatz IMMER `get_model_schema`
für den konkreten Endpunkt. Wo dieser Guide und das Schema sich widersprechen, gilt das Schema.

## Familie (der Picker behandelt sie als EIN Modell)

| Endpunkt | Wofür |
|---|---|
| `minimax/h3-max/text-to-video` | Shot aus Text (+ optional Startbild, falls das Schema `image_url` anbietet) |
| `minimax/h3-max/reference-to-video` | Shot mit Referenzbildern für Charakter-/Set-Konsistenz – Standard für alles mit wiederkehrenden Figuren |
| `minimax/h3-max/extend-video` | Verlängert einen bestehenden Clip nahtlos (Fortsetzung der letzten Frames) |
| `minimax/h3-max/director` | Steuerung mit expliziten Kamera-/Bewegungsanweisungen (Schema prüfen) |
| `minimax/h3-max/3d-to-video` | Video aus 3D-/Layout-Vorgabe (Schema prüfen) |
| `…/h3-max-turbo/…` | Schneller/günstiger – für Tests, Animatic-Clips, Varianten |

Ist der Video-Picker auf h3-max festgelegt, sind alle diese Varianten erlaubt (gleiche Familie),
andere Videomodelle nicht.

## Harte Grenzen und Pflichtschritte

- **Dauer 5–15 s je Clip.** Längere Shots: mit `extend-video` verlängern (Kontinuität!) oder als
  Schnittfolge planen. Shotlängen im Storyboard immer an diese Spanne anpassen.
- **Seitenverhältnisse:** 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 – **kein 4:5**. Für 4:5-Lieferungen: in 3:4
  oder 1:1 generieren und per Reframing (Timeline `transform.reframe['4:5']`) zuschneiden oder per
  Outpainting-Modell erweitern. Komposition dafür von Anfang an mittig/sicher planen.
- **Auflösung:** Quellen widersprechen sich (768p vs. 1080p). Schema prüfen. Finals bei Bedarf über ein
  Upscale-Modell (Picker „Werkzeuge“) auf Lieferauflösung bringen; fps an die Timeline konformieren.
- **Kosten:** grob ~$0.16 pro Sekunde bei 1080p (nach Aktionsende 2026-09-30; vor Nutzung mit
  `estimate_cost` prüfen). 5 Minuten Film ≈ 300 s ≈ $48 pro Durchgang – plane 2–3 Takes für Schlüssel-
  momente, nicht für alles.
- **Parallelität:** neue fal-Konten ~2 gleichzeitige Jobs; weitere werden eingereiht. Batches
  trotzdem komplett abschicken (`generate` ohne wait), dann `await_generations`.

## Prompt-Struktur (bewährt für moderne Videomodelle)

Schreibe Prompts auf Englisch, konkret und filmisch, in dieser Reihenfolge:

1. **Shot & Kamera:** Einstellungsgröße, Objektiv-Gefühl, Bewegung mit Richtung und Tempo
   („medium close-up, 35mm, slow dolly-in from left, handheld micro-jitter“).
2. **Subjekt & Handlung:** wer, was, EINE klare Haupthandlung pro Shot; Blickrichtung, Gestik.
3. **Ort & Licht:** Set aus der Style Bible, Lichtquelle(n), Tageszeit, Wetter.
4. **Stil:** Look der Style Bible in 1–2 Sätzen (Material, Körnung, Farbwelt) – immer gleich formuliert,
   damit Shots zusammenpassen.
5. **Zeitlicher Ablauf (bei 8–15 s):** grob in Phasen („first 3 seconds: …; then …; ends on …“) – das
   Ende so beschreiben, dass der Schnitt oder `extend-video` daran anschließen kann.
6. **Freiraum für Text:** „negative space on the left third for typography“, wenn Text geplant ist.

Vermeide: Listen aus Adjektiven, widersprüchliche Bewegungen, mehrere Handlungen, Kameratricks ohne
Motivation, „cinematic, 8k, masterpiece“-Füllwörter.

## Konsistenz

- Für Figuren immer `reference-to-video` mit Charakterblatt(en) aus der Style Bible (`"asset:<id>"` an
  der Stelle der Bild-URL). Gleiche Referenzen + gleiche Stilformulierung in jedem Shot.
- Seed setzen (falls im Schema), in der Asset-Lineage notieren; Varianten nur über Seed/eine Prompt-
  Änderung, damit Unterschiede nachvollziehbar bleiben.
- Startbild-Workflow: erst Storyboard-Frame mit Bildmodell (billig, schnell iterierbar), dann als
  Start-/Referenzbild in h3-max. Spart teure Videotakes.

## Audio

Prüfe im Schema, ob eine eigene Tonspur erzeugt wird (`nativeAudio`). Für Musikvideos meist stumm
nutzen; Sync zur Musik entsteht im Schnitt. Lipsync-Shots: siehe Skill `lipsync-workflow`.

## Typische Fehlerbilder → Gegenmaßnahme

- Gesicht driftet über den Clip → kürzer (5–8 s), stärkere Referenz, weniger Kamerabewegung.
- Hände/Finger deformiert → Hände aus dem Bild komponieren oder Aktion vereinfachen.
- Ungewollte Schnitte/Morphs im Clip → „single continuous shot, no cuts“ und nur eine Handlung.
- Text im Bild unleserlich → niemals Text vom Videomodell rendern lassen; Typografie kommt als
  Komponente auf die Textspur.

## Ablauf je Shot

estimate_cost → generate (Test: turbo/kurz/niedrige Auflösung) → contact_sheet → bewerten gegen Style
Bible → Final generieren → contact_sheet + frames an kritischen Stellen → update_asset (Titel/Tags) oder
reject_asset mit Grund → apply_document_ops (platzieren, reframe je Format).
