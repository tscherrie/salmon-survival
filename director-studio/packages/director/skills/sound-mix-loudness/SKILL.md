---
name: sound-mix-loudness
description: Sounddesign, Mix und Lautheit – Spurrollen, Pegel-Startwerte, Ducking, Fades, Plattformziele (LUFS/True Peak) und Messung.
---

# Sound-Mix & Lautheit

Remotion rendert nur das Bild; den Mix rechnet ffmpeg aus den Audiospuren der Timeline (Rollen, gainDb,
Fades, Ducking). Deshalb muss der Mix im Dokument stimmen.

## Spuren & Startpegel (relativ, dann nach Gehör/Messung)

| Rolle | Startwert | Hinweis |
|---|---|---|
| voice / vocals | 0 dB | Referenz; Verständlichkeit hat Vorrang |
| music | −6 bis −12 dB unter Sprache | mit Ducking `{byTrackId:"A1", db:-8}` |
| sfx | −6 dB | Akzente kurz und gezielt |
| ambience | −18 bis −24 dB | durchgehend, verdeckt Schnitte |

Musikvideos: Song bleibt Master (0 dB), alles andere darunter; den Song nicht neu mastern.

## Technik

- Fades an jedem Clip 5–20 ms (Audio-Timeline: Frames = ms) gegen Klicks; musikalische Fades länger.
- J-/L-Schnitte: Ton 6–12 Frames vor dem Bild beginnen lassen macht Übergänge weich.
- Stille vermeiden: Raumton/Ambience unter Dialogszenen.
- Keine Effekte, die das Modellmaterial „verbessern“ sollen, ohne zu messen.

## Lautheitsziele (integriert, EBU R128 / ITU-R BS.1770)

- Streaming/Social/Musik: −14 LUFS, True Peak ≤ −1 dBTP
- Podcast/sprachlastig: −16 LUFS, True Peak ≤ −1 dBTP
- Broadcast (falls gefordert): −23 LUFS

## Messen

`analyze_audio` auf dem Mix-Export bzw. den Quellen: integrierte Lautheit, True Peak, LRA. Abweichung
> 1 LU → Gesamtgain anpassen (Mastering-Pass beim Export), True Peak über Ziel → Limiter im Export.
Ergebnis im Abschlussbericht nennen.
