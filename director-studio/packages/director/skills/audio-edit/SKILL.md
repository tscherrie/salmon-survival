---
name: audio-edit
description: Audio-Schnitt (Podcast, Interview, Musikedit) auf der Audio-Timeline – Schnittplan aus Transkript, Füllwörter, Atem, Crossfades, Kapitel, Mastering.
---

# Audio-Schnitt

Die Audio-Timeline rechnet in Millisekunden-Ticks (fps = 1000): Frames = Millisekunden.

## Schnittplan

1. Material analysieren: `transcribe` (Wortzeiten, Sprecher falls verfügbar), `analyze_audio`
   (Lautheit; bei Musik Beats).
2. Schnittplan als Text-Asset: Kapitel, was bleibt/fliegt, Reihenfolge, Ziel-Länge. Dem Nutzer als
   Checkpoint „Konzept & Schnittplan“ vorlegen.
3. Schnitte auf Wortgrenzen und in Atempausen legen (Wortzeiten). Nie mitten in ein Wort.

## Technik

- Jeder Schnitt bekommt kurze Fades (5–20 ms) gegen Klicks: `fadeInFrames`/`fadeOutFrames` in ms.
- Füllwörter („äh“, „ähm“) nur entfernen, wenn der Rhythmus natürlich bleibt; Atem nicht komplett
  löschen (klingt künstlich) – leiser statt weg.
- Gleiches Raumgeräusch über Schnitte: Raumton-Clip unterlegen, wenn Lücken entstehen.
- Musikedit: Schnitt auf Downbeats, Takte zählen (4/8/16), Crossfade 10–50 ms auf Transienten.
- Stimmen-Pegel angleichen (gainDb je Clip), Musik unter Sprache ducken (Spur `duck`).

## Mastering

Ziele: Podcast/Sprache −16 LUFS integriert, Musik/Streaming −14 LUFS, True Peak ≤ −1 dBTP. Messen mit
`analyze_audio` nach dem Export-Mix; siehe `sound-mix-loudness`. Kapitelmarker als `section`-Marker.
