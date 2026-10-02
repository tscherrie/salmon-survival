# V2: optionale Renderer und ein gemeinsamer Animationsworkflow

Stand: 2. Oktober 2026. Diese Notiz ist Recherche und ein Vergleichsvorschlag, keine Implementierung oder Ausführungsabnahme. Sie erweitert den Suno-V2-Umfang nicht um eine verpflichtende Animationsengine. Der bestehende V1-Renderer bleibt bestehen; Dependencies, Renderdienste und Analysemodelle wurden für diese Recherche nicht installiert.

## Was die Primärquellen tatsächlich zeigen

Die folgenden GitHub-Stände wurden gelesen, ihre Renderprogramme jedoch nicht ausgeführt. Die verlinkten Commits machen die Quellenbasis reproduzierbar.

| Projekt und geprüfter Stand | Beobachteter Ansatz | Voraussetzung des vorhandenen Exports | Nutzbare Idee für Director V2 |
| --- | --- | --- | --- |
| [JohnHeibel/PDoomVideo](https://github.com/JohnHeibel/PDoomVideo/tree/fa546a38092e75f2b079e6a86d6abc54dd525d17), Commit vom 25.09.2026 | Kapitelweise Zeichenszenen mit p5.js und p5.brush; gemeinsames Storyboard, Figuren und Timeline. | Node.js, steuerbares Chrome über Puppeteer und natives FFmpeg. | Szenen als Funktionen der Zeit; Stills, Contact Sheets und kurze Clips vor dem Gesamtexport. |
| [JohnHeibel/ClaudeAnimationBase](https://github.com/JohnHeibel/ClaudeAnimationBase/tree/0ac8bf2b31942376cb6b8c4074715595d512acd2), Commit vom 24.09.2026 | Wiederverwendbare p5-/Brush-Figurenbasis mit 31 gespielten Emotionen und einem ausführlichen Animationsleitfaden. | Node.js, Chrome und natives FFmpeg. | Figuren- und Stilbibliothek, konsistente Posen, Prüfung von Bewegung und Kontaktpunkten. |
| [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video/tree/bdbad537a7b7af3213475651774030c47568c181), Commit vom 28.09.2026 | TypeScript/Three.js mit deterministischer Szenentimeline, voranalysierten Lyrics und Audiosignalen. | Bun/Vite, steuerbares Chrome und natives FFmpeg; Python/Modelle für neue Analysen. | Eine gemeinsame Zeitbasis für Szenen, Wörter, Silben, Beats, Onsets und Lautstärke. |

Bei **PDoomVideo** enthalten die geprüften [Dependencies](https://github.com/JohnHeibel/PDoomVideo/blob/fa546a38092e75f2b079e6a86d6abc54dd525d17/package.json) p5, p5.brush und puppeteer-core. [render.mjs](https://github.com/JohnHeibel/PDoomVideo/blob/fa546a38092e75f2b079e6a86d6abc54dd525d17/render.mjs) ruft `renderAt(t, ...)` in Chrome auf, schreibt Frames und startet FFmpeg als Prozess. Es bietet Stills, Contact Sheets, Clips und fortsetzbare Frame-Ausgabe. In diesem geprüften Pfad ist Remotion nicht beteiligt.

Die [ANIMATION_GUIDE.md von ClaudeAnimationBase](https://github.com/JohnHeibel/ClaudeAnimationBase/blob/0ac8bf2b31942376cb6b8c4074715595d512acd2/ANIMATION_GUIDE.md) beschreibt zeitabhängige Zeichnung, feste Seeds, Schlüsselposen, Antizipation, Reaktion und sichtbare Handlung. Ihre fünf Figurenansichten und 31 Emotionen verbinden Gesicht, Farbe und Körperbewegung. Die Papier-/Tintenästhetik und Vorgaben zu Text oder 3D sind Defaults dieses Beispiels; der Guide lässt ausdrücklich andere Nutzervorgaben zu. Das ist keine Stilvorschrift für Director.

Der [ENGINE.md von mexicat](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/docs/ENGINE.md) definiert Szenen mit globaler/lokaler Zeit und Fortschritt. Wörter, Beatphasen, Onsets und Lautstärke sind verfügbare Signale. Zustandslose Szenen sind bevorzugt; zustandsbehaftete Szenen brauchen Reset und reproduzierbares Vorspulen und sind vom adaptiven Motion Blur ausgeschlossen. Canvas-2D-Layer können in den Three.js-Compositor eingehen. Preview und Export nutzen dieselbe Szenenlogik, ihre Sampling-/Qualitätseinstellungen können sich unterscheiden.

Der [Render-CLI von mexicat](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/scripts/render.ts) überträgt Chrome-Frames über WebSocket an natives FFmpeg. Die [Wortausrichtung](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/analysis/align.py) kombiniert CTC, Whisper-Gegenprüfung, Audiosignale und manuelle Korrekturen; sie ist keine garantierte Folge eines Prompts. Laut [README](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/README.md) gehören Demucs und Python-Analyse zum Workflow; bereits vorhandene Analyse-JSONs können ohne erneute Analyse verwendet werden. Auch die geprüften [App-Dependencies](https://github.com/mexicat/pdoom-video/blob/bdbad537a7b7af3213475651774030c47568c181/app/package.json) belegen Three.js, nicht Remotion.

**Die vorhandenen CLI-Exports laufen nicht unverändert im nativen Plugin.** Node-/Bun-Dateizugriff, Subprozesse, Chrome-Steuerung und natives FFmpeg sind Voraussetzungen dieser Programme. Übertragbar sind Zeichencode, Daten und Arbeitsweise; Browser-/Plugin-Ausführung benötigt einen eigenen, überprüften Adapter. Code-, Song-, Figuren-, Font- und Asset-Lizenzen müssen getrennt bewertet werden. Eine Code-Lizenz macht den Song nicht automatisch frei verwendbar.

## Donald Jewkes: berichtete Beobachtung und offene Quellenlage

Die drei genannten Primärposts wurden direkt aufgerufen, waren in dieser Recherche aber nicht lesbar: [Post 2102801469976248500](https://x.com/donaldjewkes/status/2102801469976248500), [Post 2102801906573935057](https://x.com/donaldjewkes/status/2102801906573935057), [Post 2102918438977151317](https://x.com/donaldjewkes/status/2102918438977151317).

Dem ursprünglichen Chat zufolge wurden dort ungefähr **75 USD Fal-Kosten und 80 % eines Claude-Max-Kontingents** berichtet. **2.000 USD waren ein Budget, kein belegter Ist-Verbrauch.** Diese Angaben sind hier zugeschriebene Beobachtungen des Ursprungschats, keine unabhängig geprüften Rechnungen oder neu gelesenen Posts. Ein direkt zuordenbares Donald-Jewkes-Repository wurde nicht gefunden. Remotion oder Motion Canvas sind für diesen konkreten Workflow nicht belegt. Ein gezeigter Prompt belegt eine Anweisung, nicht die anschließend verwendete Engine oder eine erfolgreiche Ausführung.

## Vorschlag: gemeinsamer Vertrag, optionale Adapter

Die Empfehlung aus dieser Recherche ist, Projektzustand, Assets und Zeitdaten unabhängig von der Zeichenbibliothek zu halten. React ist dabei ein Komponentenmodell; Remotion ergänzt unter anderem framebezogene Komposition. Canvas, p5 und Three.js sind mögliche Zeichenschichten, die auch innerhalb einer Komposition verwendet werden können. Es sind keine fünf zwingend getrennten Exportpipelines.

| Option | Sinnvoller Vergleichsfall | Vor einer Plugin-Zusage zu prüfen |
| --- | --- | --- |
| React/Remotion | Bestehende Timeline, Text, Layout und Medienkomposition als Referenz. | Globale gegenüber lokaler Sequence-Zeit, isolierter Komponentenlauf, Export und Dependency-Telemetrie. |
| Canvas 2D | Kleine gezeichnete Figuren, Diagramme, Untertitel und bewusst einfache Effekte. | Font-/Bildbereitschaft, explizite Frame-Steuerung, Auflösung und Alpha. |
| p5.js / p5.brush | Gemalte Konturen, Papier, expressive Figuren und wechselnde Posen. | Browserkompatibilität, Brush-Kosten, Seeds, kontrollierte Zeichenaufrufe und Lizenzumfang. |
| Three.js | Räumliche Szenen, Kamera, Licht, Shader, Partikel und 2D-/3D-Mischung. | WebGL im tatsächlichen Host, GPU-/Texturgrenzen, Farbmanagement und reproduzierbarer Zustand. |

Ein kleiner **vorgeschlagener**, noch nicht implementierter Vertrag könnte so aussehen:

```ts
type FrameContext = {
  frame: number;
  fps: { numerator: number; denominator: number };
  timeSec: number;
  sceneTimeSec: number;
  width: number;
  height: number;
  seed: string;
  timing: ValidatedTiming;
  assets: OwnedAssetResolver;
};

interface SceneRenderer {
  prepare(input: SceneInput, signal: AbortSignal): Promise<void>;
  renderAt(frame: FrameContext): Promise<FrameSurface>;
  dispose(): void;
}
```

`FrameSurface` wäre adapterabhängig eine Canvas-/Bildoberfläche oder die Einbindung in die vorhandene Komposition. Der Vertrag verspricht keine bisher fehlende Implementierung. Fähigkeiten wie WebGL, Alpha, Text, zustandsabhängige Simulation und Exportformate müssten ausdrücklich angegeben werden. `prepare` wartet auf Fonts, Bilder und Shader; Fehler werden sichtbar. Preview und Export bekommen dieselben Assets, Seeds, Versionen und Zeitdaten.

Ein React-/Remotion-Adapter muss globale Zeit explizit weiterreichen, wenn ein Kind innerhalb einer Sequence arbeitet: [`useCurrentFrame()`](https://www.remotion.dev/docs/use-current-frame) liefert dort relative Frames. Ein p5-Adapter darf keinen zweiten, unkontrollierten Takt laufen lassen; [`noLoop()` und `redraw()`](https://p5js.org/reference/p5/noLoop/) bieten dafür einen Einstieg. Das konkrete Adapterverhalten muss anschließend im Plugin getestet werden.

## Eine Zeitbasis für Wörter, Beats und Bewegung

Vorgeschlagen ist eine Audio-Zeitachse in Sekunden, gebunden an die tatsächlich verwendeten Audiobytes und deren Hash. Analyseversion, Herkunft und mögliche Korrekturen gehören dazu. Eine BPM-Zahl allein ersetzt weder eine Beatliste bei Tempowechseln noch überprüfte Wortgrenzen.

- Wörter und optionale Silben erhalten Start, Ende und Qualitäts-/Herkunftsangaben. Lyrics-Text allein enthält noch keine gemessene Ausrichtung. Fehlende oder schwache Ausrichtung bleibt sichtbar und korrigierbar.
- Beats, Downbeats, Onsets und Lautstärke sind getrennte Signale. Ein Wort darf zwischen Beats beginnen; automatische Bewegung kann auf Beats reagieren, ohne jede Wortgrenze auf das Raster zu verschieben.
- Für einen Clip gilt `sourceSec = inSec + (timelineSec - startSec) * speed`. Wort- und Beatanker werden über dieselbe Transformation auf die Projektzeit abgebildet. Schnitt, Offset und Tempoänderung dürfen nicht nur das Audio verändern.
- Die Renderzeit folgt `frame * fps.denominator / fps.numerator`. Zufall bekommt einen stabilen Seed. Suchen und Einzelbilder müssen auch in anderer Reihenfolge funktionieren; Simulationen brauchen reproduzierbaren Reset und Vorspulen.

Das sind Designvorschläge. Demucs-/CTC-/Whisper-Installation, ein neuer Analysedienst und präzise automatische Gesangs-Lippensynchronisation sind damit nicht zugesagt. Für einen ersten Vergleich reichen vorliegende Analyse-JSONs oder wenige manuell geprüfte Anker.

## Figuren, Stil und der Prüfablauf

Eine eigene Figuren-/Stilbeschreibung sollte Identität, Proportionen, Silhouette, Palette, Ansichten, Schlüsselposen und erlaubte Variationen festhalten. Emotion ist eine sichtbare Pose und Handlung, keine bloße Beschriftung. Die Clawd-Bibliothek kann als Strukturvorbild dienen; Director braucht weder diese Figur noch alle 31 Emotionen. Typografie, Material, Kamera und Bewegung werden pro Projekt gewählt. Referenzen brauchen Nutzungsrechte und erhalten Asset-IDs.

Der vorgeschlagene Ablauf ist bewusst vor dem langen Export überprüfbar:

1. **Storyboard:** pro Shot Anlass, Handlung, Reaktion, Ergebnis, Zeitfenster und Audioanker festhalten. Angeben, was Code und was Footage übernimmt.
2. **Stills:** Schlüsselmomente blocken; Bildaufbau, Figur, Lesbarkeit und Stil prüfen.
3. **Contact Sheet:** Anfang, Mitte, Ende sowie beide Seiten eines Schnitts mit Shot-/Asset-ID zeigen. Bei Gesten zusätzlich Kontaktpunkte und Übergänge prüfen.
4. **Motion Test:** zwei bis vier Sekunden einschließlich Ton rendern. Antizipation, Halten, Anschlüsse und Wort-/Beatbezug im tatsächlich abgespielten Clip beurteilen.
5. **Export:** die akzeptierte Version rendern und die fertige Datei auf Bild, Ton, Dauer, Format und Synchronität prüfen.

Ein Contact Sheet kann Bewegung und A/V-Synchronität nicht allein bestätigen. Ein gespeicherter Job kann seine Fortsetzung ermöglichen; er belegt keine weiterlaufende Browserberechnung nach Schließen der Oberfläche.

## Fal-Footage und Code gemeinsam

Für den Vergleich eignet sich ein bereits erfolgreich erzeugter, rechtmäßig verwendbarer Fal-Clip als Hintergrund oder Shot. Code ergänzt beispielsweise Figuren, beatbezogene Akzente oder Text. Beide verwenden dieselbe Projektzeit und die oben beschriebenen Clip-Transformationen. Reale generierte Kamerabewegung und gezeichnete Overlays müssen am Motion Test zusammen beurteilt werden.

Request-/Modellnachweise, Originalbytes und abgeleitete Assets bleiben getrennt nachvollziehbar. Ein Rendererwechsel erzeugt nicht automatisch neue Fal-Aufträge. Zuerst vorhandene Assets wiederverwenden; eine spätere kostenpflichtige Generierung ist ein eigener, ausdrücklich autorisierter Schritt. Fremde berichtete Kosten sind keine Preiszusage für Director oder dieses Projekt.

## Kleiner vorgeschlagener Vergleich im echten Plugin

**Status: nicht durchgeführt.** Ziel ist eine Entscheidung über einen optionalen Adapter, keine neue allgemeine Animationsplattform und keine zusätzliche Suno-Implementierung.

Als gemeinsame Aufgabe dient ein 15-Sekunden-Projekt mit 30 fps und 1280 × 720: derselbe freigegebene Audioclip, wenige manuell bestätigte Wort-/Beatanker, ein vorhandener kurzer Fal-Clip und eine eigene einfache Figur. Zwei Shots prüfen eine reagierende Figur und einen Schnitt mit Footage-/Code-Overlay. Das bestehende React-/Remotion-Verhalten bildet die Referenz. Zunächst höchstens je ein kleiner p5-/Canvas- und Three.js-Prototyp, sofern dessen Adapter bereits auf einem getrennten V2-Stand vorhanden ist. Ein nicht integriertes Repository-CLI ist kein Plugin-Kandidat.

| Prüfung im tatsächlichen ChatGPT-/Codex-Plugin | Konkreter Nachweis |
| --- | --- |
| Start und Assets | Reale Host-Authentifizierung, geladener Editor, Fonts/Bilder, nutzereigene Assets; sichtbare Fehler bei fehlenden Fähigkeiten. Eine simulierte SDK-Elternseite zählt separat als Regression. |
| Reproduzierbare Zeit | Wiederholte und durcheinander abgefragte Frames, identische Seeds/Versionen; keine Abhängigkeit von zuvor abgespielten Frames. Pixelgleichheit im gleichen Lauf prüfen, browserübergreifend Abweichungen messen. |
| Sichtbare Qualität | Stills und Contact Sheet sowie tatsächliches Play/Pause/Seek; Figur bleibt erkennbar, Hand-/Fußkontakte und Schnitte funktionieren. |
| Ton und Export | Fertiger MP4 mit erwarteter Dauer, Auflösung und Ton; beim Kontrollanker A/V-Abweichung höchstens ein Frame. Reimport und Vergleich mit Preview dokumentieren. |
| Persistenz und Wiederaufnahme | Export bindet exakt die akzeptierte Projektversion. Nach Wiederöffnung bleiben Assets und Ergebnisse zugeordnet; Abbruch/Wiederholung erzeugen keine unbeabsichtigten bezahlten Aufträge. |
| Laufzeit und Kosten | Ladezeit, Framezeit und Exportdauer auf demselben Gerät; Speicher/GPU soweit messbar, Abhängigkeiten und Telemetrie. Browserarbeit und belegte Fal-Ausgaben getrennt ausweisen. |

Die Auswertung trennt **Quellcode gelesen**, **Adapter implementiert**, **Browserregression bestanden** und **echter nativer Host bestanden**. Benötigt ein Kandidat weiterhin Node/Bun, extern steuerbares Chrome oder natives FFmpeg, ist dieser Plugin-Vergleich an dieser Stelle blockiert. Er wird nicht durch einen CLI-Erfolg ersetzt.

Erst wenn Referenz und Kandidat dieselbe Aufgabe tatsächlich im Plugin ausführen und exportieren, lässt sich über Qualität und Aufwand entscheiden. Bis dahin bleibt die V2-Empfehlung: gemeinsame Zeit-/Assetdaten vorbereiten, vorhandenen Renderer nutzen und zusätzliche Engines optional halten.
