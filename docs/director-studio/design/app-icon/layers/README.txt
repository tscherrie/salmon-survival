Director Studio app icon: separate layers for Icon Composer (macOS 26+ Liquid Glass)

Canvas: 1024 x 1024, full bleed (Icon Composer's canvas is the icon body; the system adds mask, glass, specular
edge and shadow). Every colour below is a dark-theme token from DESIGN.md 3.1, used verbatim; no baked lip,
shadow or highlight.

  background.svg   the well, --hover #222224 -> --sunken #0B0B0C. In icon.icon the background is a fill instead
                   (automatic gradient from --panel-hi #18181A).
  rule.svg         timeline rule, --text-3 #8C8881, full bleed, split where the playhead crosses it
  marker.svg       marker tag, --ref #9DBDD8, with the IBM Plex Mono "1" knocked out, plus its post
  drop-line.svg    --ref dashes below the rule; used at 50 % layer opacity
  playhead.svg     playhead, --accent #F0A458: shield cap and line as one shape, bleeding off the bottom

No two layers overlap, so stacking order and glass settings cannot change the drawing.
layers-preview.png shows each layer alone and the flat composite next to the legacy icon.png.

The legacy icon (../icon.svg, ../icon.png, ../icon.icns) uses the same tokens. Its only non-token colours are
the shading of the Daylight tag (face #ABC9E1 -> #93B4D0, edge #5F7F9C): light and shade derived from --ref so
the tag reads as a plate.

../icon.icon is a draft Icon Composer package built from these files (groups: Playhead, Marker, Timeline).
Its icon.json follows files saved by Icon Composer, but Apple does not publish the schema and it has not been
opened in Icon Composer or compiled with actool yet.

OPEN CHECK, before the icon task is closed (on the Mac, with the installed app, task 13):
  1. Install the build that uses `mac.icon: build/icon.icns` and look at the app in the Dock, in Finder (icon view
     and list view), in Launchpad/Spotlight and in Cmd-Tab, in light and dark appearance.
  2. The .icns uses the Big Sur template: an 824-px squircle on the 1024 grid with a baked contact shadow and a
     100-px margin. macOS 26 shows such an icon unchanged when it accepts the shape. If it instead shows the icon
     shrunk onto a grey squircle plate, the legacy icon was not accepted.
  3. In that case: open ../icon.icon in Icon Composer (Xcode 26), check the Default, Dark, Clear and Tinted
     previews, save it there, copy it to build/icon.icon and set `mac.icon: build/icon.icon` in
     electron-builder.yml (electron-builder 26.x compiles it to Assets.car with actool, which needs Xcode 26 on the
     build Mac). Then check that the packaged app still carries an .icns as well (Contents/Resources), because
     macOS 15 and earlier ignore Assets.car app icons from Icon Composer.
