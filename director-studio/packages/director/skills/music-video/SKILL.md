---
name: music-video
description: Musikvideo von Song zu Final – Songanalyse, Treatment, Struktur, Performance vs. Inserts, Lyrics-Typo, Schnitt auf Beats, Formate.
---

# Musikvideo

## Vorbereitung (vor dem Treatment)

1. Song importiert? `analyze_audio(assetId, writeMarkers=true)` → BPM, Beats, Downbeats, Abschnitte
   als Marker. Abschnitte (Intro/Verse/Pre/Chorus/Bridge/Outro) prüfen und ggf. als section-Marker
   korrigieren.
2. Lyrics: `transcribe` auf Vocal-Stem (Stems zuerst, wenn die Musik dicht ist) → word-timings-Asset.
   Vom Nutzer gelieferte Lyrics haben Vorrang vor der Erkennung.
3. Den Song wirklich verstehen: Worum geht es? Welche Stimmung je Abschnitt? Wo ist der emotionale
   Höhepunkt? Was ist der Hook (musikalisch und textlich)?

## Treatment (Checkpoint 1)

- Idee in einem Satz + Welt in drei Sätzen. Visuelle Grammatik (wie bewegt sich die Kamera, wie lebt
  Text im Bild, welche Farben/Texturen).
- Struktur-Tabelle Abschnitt → Bildidee → Register (Performance / Story / Abstrakt / Typo).
- Hook in den ersten 1–3 s: großes Bild oder große Typo auf dem ersten Downbeat.
- Erste Kostenschätzung: Anzahl Shots × Ø-Dauer × Preis/s + Takes-Puffer (~1.5×) + Bilder + Stems/STT.

## Register mischen

- Performance (Lipsync) nur dort, wo sie trägt: Chorus, Schlüsselzeilen. Siehe `lipsync-workflow`.
- Inserts ohne Figur (Objekte, Orte, Details aus dem Text), Figuren, die etwas völlig anderes tun,
  abstrakte Passagen (Code-Komponenten, Texturen), Welt-Aufbau.
- Struktur nutzen: Verse ruhiger, Build verdichten (kürzere Schnitte), Payoff im Chorus, Kontrast in der
  Bridge (Farbe/Format/Tempo bricht).

## Storyboard & Animatic (Checkpoint 3)

- Shotliste als JSON-Asset: id, Abschnitt, Start/Ende (auf Beats/Downbeats), Bildidee, Komposition (wo
  steht die Figur, wo landet Text), Modell, Dauer, Kosten.
- Storyboard-Frames mit dem Bildmodell (billig), auf die Timeline legen + Temp-Typo → Animatic.
  `frames` an Abschnittsgrenzen prüfen, dann zur Freigabe vorlegen.

## Schnitt

- Schnitte auf Downbeats/Beats, harte Akzente auf Snare/Kick; Phrasenenden atmen lassen.
- Shotlängen variieren (nicht alles 2 Takte). Bewegungsrichtung und Einstellungsgröße abwechseln.
- Lyrics-Typo: Betonte Silben auf Beats setzen (Wortzeiten + Beat-Marker), siehe `kinetic-typography`.
- Pro Format reframen (9:16 Shorts: Gesicht/Text in Safe Area); Hook für Shorts ggf. eigener Schnitt.

## Finishing

Farbe/Textur vereinheitlichen (Overlay-Komponente: Korn, Papier), Übergänge sparsam, Lautheit des Songs
nicht verändern (nur Clipping prüfen), Review mit `review-checklist`.
