---
name: short-film
description: Narrativer Kurzfilm – Logline, Figuren, Szenenplan, Kontinuität, Dialog mit Stimme und Lipsync, Schnittgrammatik, Sounddesign.
---

# Kurzfilm / Narrativ

## Entwicklung

1. Logline (1 Satz: Figur, Ziel, Hindernis, Einsatz) und Ende zuerst. Länge realistisch: 1–3 min
   tragen 3–6 Szenen.
2. Figuren: Wunsch, Angst, sichtbares Merkmal. Für jede Figur ein Charakterblatt (Bildmodell) und eine
   Stimme (Voice Design, keine Klone ohne Einwilligung).
3. Skript als Text-Asset (subtype `script`): Szenenköpfe, Handlung, Dialog. Dialog knapp – Bild erzählt.

## Szenenplan & Kontinuität

- Je Szene: Ort (Set-Plate aus der Style Bible), Tageszeit, Figuren, Achse (180°-Regel), Blickrichtungen.
- Shotfolge klassisch: etablieren → näher → Reaktion; Schuss/Gegenschuss bei Dialog.
- Kontinuität protokollieren (Kleidung, Requisiten, Licht) im Shot-Plan; jede Generierung bekommt
  Charakterblatt + Set-Plate als Referenz.
- Bewegungsrichtung über Schnitte konsistent halten (wer nach links geht, kommt von rechts herein).

## Dialog

1. Stimme generieren (je Zeile oder je kurzer Wechsel), `transcribe` → Wortzeiten.
2. Sprechende Close-ups: `lipsync-workflow`. Totale/Rücken: kein Lipsync nötig – Ton anlegen.
3. J- und L-Schnitte: Ton führt oder folgt dem Bild, das macht Dialog flüssig.

## Ton

Raumton/Ambience je Ort durchgehend, Foley für Handlungen, Musik sparsam und erst im Finishing; Dialog
hat Vorrang (Ducking). Siehe `sound-mix-loudness`.

## Prüfen

Kontaktabzüge jeder Szene auf Identität und Achse; ganze Szene am Stück ansehen (frames an jedem
Schnitt); Untertitel aus den Wortzeiten.
