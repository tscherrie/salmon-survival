# Salmon Survival

Live one salmon's whole life in a Nordic river. Hatch in the gravel of the source, grow up in the brook, go down to the sea with the smolts, and fight your way home to spawn where you were born. On the way: storms and flash floods, an angler's fly, otters, gill nets, a fish ladder, sea lice at the salmon farm, the northern lights.

**Play it in the browser:** https://salmon-survival.vercel.app — in English, Deutsch and 中文. It needs a computer with a keyboard and a mouse, and it saves as you play.

Written with Claude Opus 5.5.

## Controls

- Mouse: steer (click the view first)
- `W` swim · `S` brake and hold on to the bottom
- `A` / `D` dodge sideways
- `Space` dash, bite, leap (at the surface: over a waterfall)
- `M` map · `L` logbook · `T` sound · `P` pause

## Contribute, give feedback

Found a bug, have an idea, want to add a fish, a plant or a translation? Open an [issue](https://github.com/tscherrie/salmon-survival/issues) or a pull request. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Run it yourself

It is a static site with no build step. Serve this folder with any static web server and open it:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Useful for trying things: `?new&stage=parr&at=4500` starts a new parr at a place along the river (`at` is the distance from the source in tenths of a metre), `?event=storm|angler|otters|floes|aurora` starts one of the events at once, `?lang=en|de|zh` picks the language.

## What is where

- `index.html`, `style.css` – the page, the HUD, the start card
- `src/main.js` – the game loop: the fish, the camera, what happens
- `src/course.js` – the river from source to sea: its bed, its level, its current
- `src/terrain.js`, `src/features.js` – the ground, the plants, and the special places (caves, the mill, the bridge, the wreck …)
- `src/salmon.js` – the salmon: stages of life, growth, swimming, leaping
- `src/life.js`, `src/predators.js`, `src/rivals.js`, `src/school.js`, `src/brawl.js` – food, shoals, hunters, fights
- `src/events.js` – storms, anglers, otters, ice floes, northern lights
- `src/eddies*.js`, `src/flowfield.js` – the water flowing round stones
- `src/i18n*.js` – the translations (the game is written in German; English and Chinese are laid over it)
- `riverscape/`, `shared/`, `ui/`, `vendor/` – the rendering it builds on, from Desktop Habitats, and three.js

## Credits and license

Salmon Survival grew out of [Desktop Habitats](https://github.com/chaseleantj/desktop-habitats) by Chase Lean, and is MIT licensed like it (see [LICENSE](LICENSE)). three.js is bundled under its MIT license (`vendor/THREE-LICENSE.txt`). The ground and rock textures are from [Poly Haven](https://polyhaven.com), CC0 (`assets/CREDITS.md`); everything else — the fish, the plants, the water, the sounds — is generated in code.
