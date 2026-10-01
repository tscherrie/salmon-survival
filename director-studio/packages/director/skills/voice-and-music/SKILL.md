---
name: voice-and-music
description: Stimme (TTS, Voice Design, Klon nur mit Einwilligung), Musik und Sound/SFX generieren – Modellwahl, Prompting, Schnittvorbereitung, Rechte.
---

# Stimme, Musik, Sound

## Stimme (Picker „Stimme“)

- **TTS mit Sprecherauswahl:** für Voice-over, Erklärstimmen, Dialog. Suche
  `search_models({modality:"voice"})`; Kandidaten: ElevenLabs- und MiniMax-Speech-Familien auf fal.
- **Voice Design:** neue Stimme aus Beschreibung („warm, late-30s, slight rasp, calm pace“).
- **Klonen: NUR mit ausdrücklicher Einwilligung der Person.** Ohne Nachweis nicht anbieten. Keine
  Stimmen realer, bekannter Personen nachbauen.
- Skript vorher als Text-Asset (`create_text_asset`, subtype `script`) mit Betonungen und Pausen
  schreiben. Lange Texte in Absätze/Sätze teilen (je Generierung ein Abschnitt) – leichter zu
  korrigieren und zu schneiden.
- Aussprache: Fremdwörter/Namen phonetisch umschreiben oder Modell-spezifische Aussprachehilfen nutzen
  (Schema prüfen). Sprache des Inhalts aus dem Brief.
- Danach `transcribe` für Wortzeiten → Untertitel, Typo-Timing, Schnitt auf Atempausen.

## Musik (Picker „Musik“)

- Prompt wie ein Briefing an einen Komponisten: Genre, Tempo (BPM), Tonart/Stimmung, Instrumentierung,
  Struktur mit Längen („intro 8 bars, build, drop at 0:24, outro“), Ende („hard stop“ oder „fade“).
- Für Schnitt-taugliche Musik: feste BPM nennen; danach `analyze_audio` mit `writeMarkers` für Beats.
- Vocals nur, wenn das Projekt sie braucht; sonst „instrumental“ explizit.
- Bei Nutzer-Songs (Upload) nichts generieren – nur analysieren, schneiden, Stems trennen (Werkzeuge).

## Sound / SFX (Picker „Sound“)

- Text-zu-SFX für Akzente, Ambience, Foley: kurz und physisch beschreiben („wet footsteps on gravel,
  close mic, 2 seconds“).
- Video-zu-Audio-Modelle erzeugen passenden Ton zu einem Clip – gut für Ambience; Akzente (Hits,
  Whooshes auf Schnitten) lieber gezielt einzeln.
- SFX auf Spur A3 (Rolle `sfx`), Ambience auf eigener Spur; Pegel siehe `sound-mix-loudness`.

## Rechte

Fremde Musik oder Stimmen nur mit Rechten des Nutzers. Bei Unklarheit: generiertes Äquivalent
vorschlagen. Lizenzhinweise der Modelle (kommerzielle Nutzung) im Picker beachten.
