---
name: social-ads
description: Social Shorts und Ads (9:16 ≤ 90 s, 1:1, 4:5) – Hook in 1–3 s, Plattformregeln, Safe Areas, Untertitel ohne Ton, Varianten und Tests.
---

# Social Shorts & Ads

## Grundsätze

- **Hook in den ersten 1–3 Sekunden:** Bewegung + großes, lesbares Versprechen (Text) + Gesicht oder
  überraschendes Objekt. Kein Logo-Intro, kein langsames Fade-in.
- **Ohne Ton verständlich:** große Untertitel/Typo immer an (aus Wortzeiten), Ton ist Bonus.
- **Ein Gedanke pro Video.** Struktur: Hook → Problem/Spannung → Beweis/Demo → Payoff → CTA (letzte
  2–3 s, konkret).
- Tempo: Schnitte alle 1–2 s im Hook, danach Rhythmus der Musik/Stimme.

## Formate & Safe Areas

- 9:16 (1080×1920): Plattform-UI verdeckt unten ~20 % (Caption, Buttons) und rechts einen Streifen
  (Like/Share), oben ~10 %. Text und Gesichter in die Mitte, unteres Drittel frei halten.
- 1:1 und 4:5 für Feeds: 4:5 nutzt mehr Höhe; h3-max hat kein 4:5 → in 3:4 generieren und reframen.
- Je Format eigenes Reframing pro Clip (`transform.reframe`); Text-Komponenten lesen `width/height`
  und setzen Positionen relativ.

## Ads

- Marke früh, aber nicht als Intro: Produkt im ersten Shot, Logo dezent ab Sekunde 2–3 oder am Ende.
- Behauptungen nur, wenn der Nutzer sie belegen kann; keine erfundenen Testimonials/Reviews, keine
  realen Personen ohne Einwilligung.
- Varianten für Tests: 2–3 Hooks × gleicher Körper. Kosten klein halten (Körper einmal generieren).

## Prüfen

render_still im Zielformat an Hook, Mitte, CTA; Safe Areas prüfen; Lesbarkeit auf Handy-Größe
(Schrift ≥ ~5 % der Bildhöhe für Schlüsselwörter); Länge gegen Plattformlimit.
