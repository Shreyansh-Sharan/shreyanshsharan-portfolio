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

## Structure

- `src/components/Background.tsx`: 2D ribbon background (single WebGL fragment shader), used as fallback
- `src/components/Home.tsx`: the home screen (tabs, tile row, hero, activity cards)
- `src/components/GameHub.tsx`: per-role detail page
- `src/lib/input.ts`: unified keyboard + gamepad input
- `src/lib/sound.ts`: synthesised UI sounds (no audio files)

## Deploying

`.github/workflows/deploy-site.yml` builds and publishes to GitHub Pages on pushes to `main`. Enable it once under
**Settings → Pages → Source: GitHub Actions**.
