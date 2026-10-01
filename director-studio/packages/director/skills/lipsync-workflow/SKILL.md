---
name: lipsync-workflow
description: Lippensynchrone Gesangs- und Dialogshots planen, generieren und messen – Phrasen, Audiosegment mit Handles, Modelle mit Audio-Eingang, check_av_sync, Korrektur.
---

# Lipsync-Workflow

Ziel: Mund und Stimme sitzen auf ±1 Frame. Das gelingt nur mit exaktem Audiosegment und Messung.

## 1. Phrasen und Shotlänge planen

1. Wortzeiten: `transcribe` auf Vocal-Stem (vorher Stems trennen, falls Musik stört) → word-timings.
2. Phrasen bilden (zusammenhängende Wörter bis zur Atempause). Shot = Phrase + Handles.
3. Shotlänge an Modellgrenzen anpassen (z. B. 5–15 s); zu lange Phrasen teilen, Schnitt auf Atempause.

## 2. Exaktes Audiosegment

`cut_audio(assetId=Vocal-Stem oder Mix, fromSec, toSec, handlesSec=0.25)` → Segment-Asset.
- Vocal-Stem für Modelle, die nur Stimme sehen sollen; Mix, wenn das Modell Rhythmus aus der Musik
  braucht (Schema/Skill prüfen).
- Merke: der Inhalt beginnt im Segment bei `handlesSec`. Auf der Timeline: Clip-Start =
  Phrasenbeginn − handlesSec, damit die Mundbewegung trifft.

## 3. Modellwahl

- **Audio-getriebene Videomodelle / Avatar-Modelle** (Picker „Lipsync“; `audioInput` in den
  Fähigkeiten): Bild/Charakterblatt + Audiosegment → Performance. Beste Mimik.
- **Lipsync-Nachbearbeitung** (Video + Audio → neuer Mund): wenn der Shot schon existiert (z. B. aus
  h3-max) und nur der Mund angepasst werden soll.
- Audiosegment als `"asset:<segmentId>"` an das Audio-Feld des Schemas, Bild/Video ebenso.

## 4. Messen – Pflicht

`check_av_sync(videoAssetId, referenceAudioAssetId=Segment)`:
- |Versatz| ≤ 1 Frame → platzieren.
- ≤ 6 Frames → Clip-Versatz korrigieren (`in` bzw. `start` um den Versatz verschieben).
- darüber oder Konfidenz niedrig → neu generieren (anderer Seed, kürzeres Segment), max. 2 Versuche im
  Budget, dann Nutzer fragen.
Ergebnis als `qa`-Marker am Clip notieren (apply_document_ops add_marker kind "qa", label „sync +12 ms“).

## 5. Im Schnitt

- Original-Audio des Songs bleibt auf der Musikspur; Clip-Audio des Lipsync-Shots stumm (gainDb sehr
  niedrig bzw. Spur muted) – sonst Phasing.
- Frames an Konsonanten (B/M/P geschlossen) mit `frames` prüfen.
- Nicht jeden Gesangsteil lippensynchron zeigen: Inserts, Abstraktes und andere Handlungen mischen.
