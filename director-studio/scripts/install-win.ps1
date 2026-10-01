<#
.SYNOPSIS
  Director Studio unter Windows bauen und installieren. Idempotent: erneut ausführen = aktualisieren.

.DESCRIPTION
  Ablauf: Voraussetzungen prüfen (git, Node.js >= 22.13, ffmpeg) -> npm ci -> npm run build -> App für die
  Architektur dieses Rechners paketieren -> installieren:
    Standard:    entpackte App nach %LOCALAPPDATA%\Programs\Director Studio kopieren, Startmenü-Verknüpfung anlegen
    -Installer:  NSIS-Installer bauen (apps\desktop\release\Director-Studio-Setup-*.exe) und für den aktuellen
                 Benutzer still ausführen
  winget/Homebrew-artige Werkzeuge werden nicht installiert; fehlende Programme nennt das Skript mit dem passenden
  winget-Befehl. API-Keys fragt das Skript nie ab: Die App fragt in ihren Einstellungen danach und speichert sie
  verschlüsselt (Windows-DPAPI) im Datenordner.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File director-studio\scripts\install-win.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File director-studio\scripts\install-win.ps1 -Update -DesktopShortcut
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File director-studio\scripts\install-win.ps1 -Uninstall
#>
# Datei ist UTF-8 mit BOM gespeichert, damit Windows PowerShell 5.1 die Umlaute richtig liest.
[CmdletBinding()]
param(
  # Vorher „git pull --ff-only“ ausführen.
  [switch]$Update,
  # NSIS-Installer bauen und ausführen statt die entpackte App zu kopieren.
  [switch]$Installer,
  # Zusätzlich eine Desktop-Verknüpfung anlegen (nur ohne -Installer; der Installer legt selbst eine an).
  [switch]$DesktopShortcut,
  # Kopierte App und Verknüpfungen entfernen (Datenordner und Projekte bleiben).
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$AppName = 'Director Studio'
$Root = Split-Path -Parent $PSScriptRoot           # director-studio
$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\$AppName"
$StartMenuLink = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$AppName.lnk"
$DesktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk"

function Step([string]$Text) { Write-Host ""; Write-Host "> $Text" -ForegroundColor Cyan }
function Warn([string]$Text) { Write-Host "! $Text" -ForegroundColor Yellow }
function Fail([string]$Text) { Write-Host "x $Text" -ForegroundColor Red; exit 1 }
function Invoke-Native([string]$Exe, [string[]]$Arguments) {
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) { Fail "$Exe $($Arguments -join ' ') ist fehlgeschlagen (Exit $LASTEXITCODE)." }
}
function Stop-RunningApp {
  $running = Get-Process -Name $AppName -ErrorAction SilentlyContinue
  if (-not $running) { return }
  Write-Host "  $AppName läuft - wird beendet ..."
  foreach ($p in $running) { [void]$p.CloseMainWindow() }
  Start-Sleep -Seconds 3
  Get-Process -Name $AppName -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 1
}
function New-Shortcut([string]$Path, [string]$Target) {
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($Path)
  $link.TargetPath = $Target
  $link.WorkingDirectory = Split-Path -Parent $Target
  $link.IconLocation = "$Target,0"
  $link.Description = $AppName
  $link.Save()
}

if ($Uninstall) {
  Step "$AppName entfernen"
  Stop-RunningApp
  foreach ($item in @($InstallDir, $StartMenuLink, $DesktopLink)) {
    if (Test-Path $item) { Remove-Item -Recurse -Force $item; Write-Host "  entfernt: $item" }
  }
  Write-Host "  Datenordner ($env:APPDATA\$AppName) und Projekte bleiben erhalten."
  Write-Host "  Per Installer installiert? Dann über Einstellungen > Apps deinstallieren."
  exit 0
}

# ───────────── 1. Voraussetzungen ─────────────
Step 'Voraussetzungen prüfen'
$missing = @()
if (Get-Command git -ErrorAction SilentlyContinue) {
  Write-Host "  git:     $((git --version) -replace 'git version ', '')"
} else {
  $missing += 'git fehlt:      winget install Git.Git'
}
if ((Get-Command node -ErrorAction SilentlyContinue) -and (Get-Command npm -ErrorAction SilentlyContinue)) {
  $nodeVersion = (node -p 'process.versions.node').Trim()
  if ([version]$nodeVersion -ge [version]'22.13.0') {
    Write-Host "  Node.js: $nodeVersion"
  } else {
    $missing += "Node.js $nodeVersion ist zu alt (nötig >= 22.13):   winget upgrade OpenJS.NodeJS.LTS"
  }
} else {
  $missing += 'Node.js fehlt:  winget install OpenJS.NodeJS.LTS   (Version >= 22.13)'
}

# ffmpeg: PATH und die Orte, die auch die App durchsucht (winget, Chocolatey, Scoop).
$ffmpeg = $null
$cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($cmd -and (Get-Command ffprobe -ErrorAction SilentlyContinue)) { $ffmpeg = $cmd.Source }
if (-not $ffmpeg) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links'),
    (Join-Path $env:ProgramFiles 'WinGet\Links'),
    (Join-Path $env:ProgramData 'chocolatey\bin'),
    (Join-Path $env:USERPROFILE 'scoop\shims')
  )
  $wingetPackages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
  if (Test-Path $wingetPackages) {
    $candidates += Get-ChildItem -Path $wingetPackages -Directory -Filter '*FFmpeg*' -ErrorAction SilentlyContinue |
      ForEach-Object { Get-ChildItem -Path $_.FullName -Directory -ErrorAction SilentlyContinue } |
      ForEach-Object { Join-Path $_.FullName 'bin' }
  }
  foreach ($dir in $candidates) {
    if ((Test-Path (Join-Path $dir 'ffmpeg.exe')) -and (Test-Path (Join-Path $dir 'ffprobe.exe'))) { $ffmpeg = Join-Path $dir 'ffmpeg.exe'; break }
  }
}
if ($ffmpeg) {
  Write-Host "  ffmpeg:  $ffmpeg"
} else {
  Warn 'ffmpeg/ffprobe fehlen - Vorschaubilder, Ton und Video-Export brauchen sie. Installieren mit:'
  Write-Host '      winget install Gyan.FFmpeg'
  Write-Host '    Der Build läuft trotzdem weiter; die App zeigt den Hinweis ebenfalls.'
}

if ($missing.Count -gt 0) {
  foreach ($line in $missing) { Warn $line }
  Fail 'Bitte die fehlenden Voraussetzungen installieren (danach ein neues Terminal öffnen) und das Skript erneut starten.'
}

# Architektur: npm installiert die nativen Pakete (Remotion, esbuild, Claude-Code-Binary) für die Architektur von Node.
# Für Windows gibt es Remotions Compositor und die Chromium-Headless-Shell nur für x64 – ein ARM64-Node würde erst
# nach npm ci und Build scheitern. Ein x64-Node läuft auf Windows-ARM-Rechnern in der Emulation (die App dann auch).
$arch = (node -p 'process.arch').Trim()
if ($arch -eq 'arm64') {
  Fail ('Windows auf ARM64 wird nicht unterstützt (kein Remotion-Compositor und keine Chromium-Headless-Shell für ARM64). ' +
    'Bitte die x64-Version von Node.js installieren (läuft in der x64-Emulation), z. B. winget install OpenJS.NodeJS.LTS --architecture x64, und das Skript erneut starten.')
}
if ($arch -ne 'x64') { Fail "Nicht unterstützte Architektur: $arch" }
Write-Host "  Architektur: $arch"

# ───────────── 2. Quelltext aktualisieren (optional) ─────────────
if ($Update) {
  Step 'Quelltext aktualisieren (git pull --ff-only)'
  Invoke-Native 'git' @('-C', $Root, 'pull', '--ff-only')
}

# ───────────── 3. Abhängigkeiten und Build ─────────────
Push-Location $Root
try {
  Step 'Abhängigkeiten installieren (npm ci)'
  Invoke-Native 'npm' @('ci', '--no-audit', '--no-fund')

  Step 'Oberfläche und Hauptprozess bauen (npm run build)'
  Invoke-Native 'npm' @('run', 'build')

  Stop-RunningApp
  if ($Installer) {
    Step "NSIS-Installer bauen ($arch)"
    Invoke-Native 'node' @('apps/desktop/scripts/dist.mjs', '--win', '--skip-build')
  } else {
    Step "App paketieren ($arch, entpackt)"
    Invoke-Native 'node' @('apps/desktop/scripts/dist.mjs', '--win', '--dir', '--skip-build')
  }
} finally {
  Pop-Location
}

$release = Join-Path $Root 'apps\desktop\release'
if ($Installer) {
  # ───────────── 4a. Installer ausführen ─────────────
  $setup = Get-ChildItem -Path $release -Filter "Director-Studio-Setup-*-$arch.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $setup) { Fail "Installer nicht gefunden in $release" }
  Step "Installer ausführen: $($setup.Name)"
  $proc = Start-Process -FilePath $setup.FullName -ArgumentList '/S', '/currentuser' -Wait -PassThru
  if ($proc.ExitCode -ne 0) { Fail "Installer meldet Exit $($proc.ExitCode)." }
  Write-Host "  Installiert (Startmenü und Desktop-Verknüpfung legt der Installer an)."
  Write-Host "  Den Installer kannst du auch weitergeben: $($setup.FullName)"
  Write-Host '  Unsigniert: Auf anderen Rechnern warnt SmartScreen - "Weitere Informationen" > "Trotzdem ausführen".'
} else {
  # ───────────── 4b. Entpackte App kopieren ─────────────
  $unpacked = Join-Path $release ($(if ($arch -eq 'x64') { 'win-unpacked' } else { "win-$arch-unpacked" }))
  $exe = Join-Path $unpacked "$AppName.exe"
  if (-not (Test-Path $exe)) { Fail "Gebaute App nicht gefunden: $exe" }
  Step "Installieren nach $InstallDir"
  $staging = "$InstallDir.installing"
  if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $InstallDir) | Out-Null
  # robocopy: schnell bei vielen Dateien; Exit < 8 bedeutet Erfolg.
  robocopy $unpacked $staging /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Fail "Kopieren fehlgeschlagen (robocopy Exit $LASTEXITCODE)." }
  if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
  Move-Item -Path $staging -Destination $InstallDir
  $installedExe = Join-Path $InstallDir "$AppName.exe"
  New-Shortcut -Path $StartMenuLink -Target $installedExe
  Write-Host "  Startmenü: $StartMenuLink"
  if ($DesktopShortcut) { New-Shortcut -Path $DesktopLink -Target $installedExe; Write-Host "  Desktop:   $DesktopLink" }
}

# ───────────── 5. Fertig ─────────────
Step 'Fertig'
Write-Host "  Starten: Startmenü > $AppName"
Write-Host "  Aktualisieren: powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Update"
Write-Host ''
Write-Host '  Beim ersten Start unter Einstellungen (Zahnrad) den Anthropic-API-Key und den fal-Key eintragen.'
Write-Host '  Die App speichert sie verschlüsselt (Windows-DPAPI) - nie in Umgebungsvariablen oder Dateien im Projekt.'
Write-Host ''
Write-Host "  Datenordner: $env:APPDATA\$AppName  (Einstellungen, verschlüsselte Keys, Caches, runtime\ mit Chromium)"
Write-Host "  Projekte:    $([Environment]::GetFolderPath('MyDocuments'))\$AppName  (änderbar in den Einstellungen)"
if (-not $ffmpeg) {
  Write-Host ''
  Warn "ffmpeg fehlt noch: winget install Gyan.FFmpeg - danach $AppName neu starten."
}
