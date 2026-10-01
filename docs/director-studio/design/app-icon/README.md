# App-Icon „Marker“

Das App-Icon zeigt die Kerngeste von Director Studio: einen nummerierten Marker in Daylight-Blau („worauf du
zeigst“) neben dem Abspielkopf in Tungsten („jetzt“) auf einer Timeline-Linie. Grundlage sind die Tokens aus
`director-studio/apps/desktop/DESIGN.md` (§3.1, §6). Ausgewählt wurde es aus drei Entwürfen (Marker, Sucher,
Regiestuhl) von zwei Jurys.

| Datei | Zweck |
|---|---|
| `icon.svg` | Master 1024 × 1024 (Apple-Raster: 824-px-Kachel, 100 px Rand) |
| `svg/` | von Hand abgestimmte Quellen für kleine Größen (macOS 16/32/64/128, Windows 16–64) |
| `layers/` | Ebenen für Icon Composer (macOS 26+), mit Hinweisen in `layers/README.txt` |
| `generator/` | Skripte, die alle Ausgaben erzeugen (`build-all.js`) und prüfen (`readback.js`) |
| `mockups/` | Dock hell/dunkel, Windows-Taskleiste, Kleingrößen-Vergrößerung |

Die fertigen Dateien für die App liegen in `director-studio/apps/desktop/build/` (`icon.icns`, `icon.ico`,
`icon.png`, `icons/` für Linux, `icon.icon` für Icon Composer). Die Generator-Skripte wurden außerhalb des Repos
mit Playwrights Chromium und Python (Pillow, icnsutil) ausgeführt; ihre Ausgabepfade beziehen sich auf den damaligen
Arbeitsordner und müssen bei einer Neuauflage angepasst werden.
