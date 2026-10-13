# Shreyansh Sharan · Console-style portfolio

A game-console-style home screen for the portfolio: career roles are "games", certifications are trophies, and a
Quick View page gives recruiters a plain resume.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Editing content

Everything the site shows lives in [`src/data/content.ts`](src/data/content.ts): profile and contact links, tiles
(roles, product, extras), trophies and the skill tree. To use generated cover art for a tile, put the image in
`public/` and set `cover: 'my-image.webp'` on that tile.

## Controls

| Input | Keyboard | Gamepad |
| --- | --- | --- |
| Navigate | Arrow keys | D-pad / left stick |
| Open | Enter | Bottom face button |
| Back | Esc | Right face button |
| Switch tab | Q / E | Shoulder buttons |

Mouse and touch work too: tap a tile to select it, tap again to open.

## 3D layer

`src/three/Scene3D.tsx` is a React Three Fiber scene behind the UI: the ribbon backdrop, a glowing grid floor,
particles, bloom and a 3D emblem per tile (`src/three/Emblems.tsx`, built from primitives so nothing is downloaded).
The emblem lands on whichever element carries `data-emblem-anchor`. The scene is a separate chunk that loads after
the first paint; it is skipped for `prefers-reduced-motion`, browsers without WebGL2, or `?lite` in the URL, and the
2D shader background is used instead.

## Dunes Arena (Extras)

`src/components/Arena.tsx` is the lobby for the Unity WebGL shooter in `../unity/ArenaShooter`. It loads the build from
`public/games/arena/` in an iframe with launch options in the URL (`?mode=solo|host|join&bots=&diff=&name=&code=`),
listens for `postMessage` events from the game (join code, errors), and turns a join code into an invite link
(`#/arena?join=CODE`). Until a build is published the page says so. See `../unity/ArenaShooter/README.md` to build it.

## Cricket (Extras)

`#/cricket` is a broadcast-style cricket game written for the browser with three.js (the old Unity project in
`../unity/CricketGame` is no longer used). `src/components/Cricket.tsx` is the lobby (CPU match, online 1v1 by code,
team builder); the game itself is a lazily loaded chunk under `src/cricket/`:

- `sim/`: pure TypeScript simulation, a port of the Unity project's calibrated C# (ball physics at 500 Hz with drag,
  swing, seam and Magnus spin, pitch types and wear; the delivery solver; the shot model; LBW tracking and DRS; rules and
  scoring; field presets; the match director with fielding, running, appeals and reviews; the CPU batter and bowler).
- `view/`: procedural stadium and instanced crowd, the rigged cricketer (`public/cricket/cricketer.glb`, CC0) with team
  kits and a procedural IK layer for strokes, bowling actions, keeping and umpire signals (`poses.ts`), ball tracking.
- `game.ts`: renderer, cameras, replays, input and the HUD feed; `ui/`: the React HUD, scorecard and team builder;
  `net.ts`: host-authoritative online play over the shared PeerJS transport.

`npm run test:cricket` runs the offline checks: the physics calibration (seam-up at the crease, bouncer height, spin
turn, carries, bat speeds) and three CPU v CPU T10 matches. In the browser, `?snap` exposes `window.__cricket` without a
live loop (advance it with `simulate()` / `simulateUntil()`), `?autopilot` lets the CPU play both sides, `?seed=` fixes
the match, and `#/cricket?auto` starts a quick match straight away.

## NEON SIEGE (Extras)

`#/siege` is a top-down cyberpunk arena shooter written with three.js; the lobby page is `src/siege/Siege.tsx` and
the game is a lazily loaded chunk under `src/siege/`:

- `engine/sim.ts`: a pure, deterministic simulation on a 2 m grid (movement and grid collision, six weapons, supers,
  deployables, destructible crates, battle-royale grid and loot, Team Takedown / Core Control / Grid Royale rules,
  snapshots for the view and the network). `engine/bots.ts` is the bot brain (targeting, range-keeping, strafing,
  cover when low, chasing, objectives, loot, staying inside the grid, super timing) with a small A* over the grid.
- `engine/heroes.ts` (Rook, Wren, Furnace, Flick, Pike, Salve), `engine/maps.ts` (ASCII layouts mirrored into the
  three arenas and the royale map), `engine/progress.ts` (coins, XP, gear cards that merge up four tiers, palettes,
  daily jobs, all in `localStorage`), `engine/net.ts` (host-authoritative online play on the shared PeerJS transport,
  bots filling the squads), `engine/audio.ts` (synthesised blasters, hits, supers and a synthwave loop),
  `engine/input.ts` (WASD + mouse, gamepad, two virtual sticks on touch), `engine/game.ts` (the match runner).
- `view/`: renderer, follow camera with aim look-ahead and shake, the map builder (instanced walls with neon trims,
  props from the manifest with procedural stand-ins, holo-ads, decals, the shrinking grid), fighter actors on the
  CC0 characters, instanced projectiles, pooled particles, floating damage numbers and bloom on the high tier.
- `public/siege/models/` holds meshopt-compressed GLBs listed in `engine/assets.ts` (drop a file in and add a
  manifest line); sources and licences are in `public/siege/CREDITS.md`.

`node src/siege/engine/sim.test.ts [matches]` runs bot-only matches of every mode on every map plus a 1v1 hero
balance sweep, headless. In the browser, `?snap` exposes `window.__siege` without a live loop (advance it with
`simulate(seconds)`, read `state()`), `?autopilot` lets a bot drive your hero, `?quality=low|medium|high` forces a
tier, `#/siege?auto=tdm|capture|br&map=kessho|helipad|underpass` starts a match straight away, and `?net=local`
plays between tabs of one browser.

## Structure

- `src/components/Background.tsx`: 2D ribbon background (single WebGL fragment shader), used as fallback
- `src/components/Home.tsx`: the home screen (tabs, tile row, hero, activity cards)
- `src/components/GameHub.tsx`: per-role detail page
- `src/lib/input.ts`: unified keyboard + gamepad input
- `src/lib/sound.ts`: synthesised UI sounds (no audio files)

## Deploying

`.github/workflows/deploy-site.yml` builds and publishes to GitHub Pages on pushes to `main`. Enable it once under
**Settings → Pages → Source: GitHub Actions**.
