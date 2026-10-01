---
name: web-design
description: Webdesign von Sitemap über Mockups zur lauffähigen Site (Vite + React + Tailwind) – data-sid, Responsiveness, a11y, Performance, Screenshot-QA.
---

# Webdesign (Site-Dokument + site/)

## Phasen

1. **Sitemap & Inhalte** (Checkpoint): Seiten (`add_page`), Ziele je Seite, echte Inhalte vom Nutzer
   (keine Lorem-Ipsum-Endprodukte), Tonalität.
2. **Mockups & Style Bible** (Checkpoint): je Seite Desktop + Mobile als Bild (Bildmodell oder
   gerenderte Komponenten), Typo-Skala, Farben, Abstände, Komponentenliste. Mockup-Assets an Seiten
   hängen (`update_page` `mockups`). Site-Stage bleibt `mockup`.
3. **Implementierung** (`update_site` stage `code`): Dateien mit `write_site_file` schreiben.
4. **QA & Export**: Viewports, Konsole, a11y, Performance, dann `export_project("zip")`.

## Code-Konventionen

- Standard: Vite + React + Tailwind (`framework: vite-react`); schlichtes HTML wenn ausreichend.
- Kleine, benannte Komponenten; Inhalte in Datenobjekten statt hart im JSX verstreut.
- `data-sid="<stabile-id>"` an Sektionen, Karten, Hero, Navigation – der Nutzer zeigt darauf, IDs
  überleben Umbauten.
- Keine Schlüssel, Tokens oder `.env` im Projekt; keine externen Tracker; Assets lokal einbinden.
- Semantisches HTML (header/nav/main/section/footer, eine h1), Alt-Texte, Fokus-Stile, Kontrast ≥ 4.5:1.
- Responsiv mobile-first; Typo mit clamp(); Bilder mit width/height und `loading="lazy"` unter dem Fold.

## Gestaltung (gegen Standard-Optik)

Benenne konkret, was du vermeidest: z. B. kein Creme-Hintergrund mit kursiven Akzentwörtern, keine
„01/02/03“-Sektionsnummern, keine Pill-Buttons und Monospace-Labels als Deko, keine Gradient-Blobs.
Leite das Design aus Marke und Inhalt ab (siehe `anti-slop`).

## QA

Nach jeder größeren Änderung `screenshot_site` (desktop + mobile, ggf. tablet): Layoutbrüche, Überläufe,
Konsolenfehler = Pflicht beheben. Element-Referenzen des Nutzers kommen mit Selektor und Quelle
(Datei:Zeile) – erst `read_site_file`, dann gezielt ändern.
