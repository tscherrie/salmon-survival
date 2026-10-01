---
name: review-checklist
description: Kritische Abnahme vor jedem Checkpoint und vor dem Export – was mit welchen Tools geprüft wird (Bild, Timing, Sync, Text, Ton, Formate, Kosten).
---

# Review-Checkliste

Du kannst ein Video nicht durch Vorstellen sehen. Jeder Punkt wird mit einem Tool belegt; was nicht
geprüft wurde, wird als „nicht geprüft“ gemeldet.

## Je Generierung

- [ ] `contact_sheet` / `get_asset`: Identität vs. Charakterblatt, Palette vs. Style Bible
- [ ] Anatomie (Hände, Augen, Zähne), Physik, Artefakte, Morphs, ungewollte Schnitte
- [ ] Komposition: Freiraum für Text dort, wo geplant
- [ ] Misslungen → `reject_asset` mit Grund, gelungen → `update_asset` (Titel, Tags)

## Schnitt (Timeline)

- [ ] `get_document` summary: keine Lücken/Überlappungen, Dauer = Plan
- [ ] `frames` an jedem Schnitt ±2 Frames: Anschlüsse, Blitzer, schwarze Frames
- [ ] Schnitte auf Beats/Downbeats (Marker), Phrasenenden atmen
- [ ] Hook: erste 3 s als Frames (0.0 / 1.0 / 2.5 s) – sofort klar und stark?
- [ ] Text: Timing gegen Wortzeiten, Lesbarkeit, Tippfehler, Safe Areas in JEDEM Format (`render_still`
      mit formatId)
- [ ] Lipsync: `check_av_sync` auf jedem Lipsync-Shot, Ergebnis als qa-Marker

## Ton

- [ ] Lautheit des Mixes gemessen (Ziel je Plattform), True Peak ≤ −1 dBTP, kein Clipping
- [ ] Dialog/VO verständlich über Musik (Ducking), keine Klicks an Schnitten

## Slides / Grafik / Web

- [ ] Jede Folie/Seite gerendert angesehen; Überläufe, Kontrast, Ausrichtung am Raster
- [ ] Web: `screenshot_site` mobile + desktop, Konsole fehlerfrei, Alt-Texte, Fokus sichtbar

## Abschlussbericht an den Nutzer

Was geändert wurde (mit klickbaren Zeitstempeln), was geprüft wurde und wie, was nicht geprüft werden
konnte, Kosten (Generierungen + Director), offene Entscheidungen. Ehrlich über Schwächen.

Für umfangreiche Prüfungen kann ein Subagent (`delegate`, claude-sonnet-5-5) die Frame-Durchsicht
übernehmen – gib ihm Kriterien und Zeitpunkte vollständig mit.
